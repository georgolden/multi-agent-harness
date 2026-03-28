import { App } from '../app.js';
import { TaskSchedulerAgent } from './taskScheduler/index.js';
import { FillTemplateAgent } from './fillTemplate/index.js';
import { ExploreAgent } from './explore/index.js';
import { AgenticLoopAgent } from './agentictLoop/index.js';
import { AgentBuilderAgent } from './agentBuilder/index.js';
import { OrchestratorAgent } from './orchestrator/index.js';
import { type AgentFlowParameters } from './agentictLoop/flow.js';
import { User } from '../data/userRepository/types.js';
import { Session } from '../services/sessionService/session.js';
import type { StoredAgenticLoopSchema } from '../data/agenticLoopSchemaRepository/types.js';
import { Agent, type AgentSchema } from '../utils/agent/agent.js';

export type AgentContext = {
  user: User;
  parent?: Session;
};

type AnyAgentClass = new (
  app: App,
  user: User,
  parent?: Session,
  schemaOverride?: AgentSchema,
) => Agent<App, User, Session>;

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export class Agents {
  private agentRegistry: Map<string, AnyAgentClass>;

  app: App;
  private agenticLoopSchemas: Map<string, StoredAgenticLoopSchema> = new Map();
  private activeAgents: Set<Agent<App, User, Session>> = new Set();

  constructor(app: App) {
    this.app = app;
    const agentClasses: AnyAgentClass[] = [
      TaskSchedulerAgent,
      FillTemplateAgent,
      ExploreAgent,
      AgenticLoopAgent,
      AgentBuilderAgent,
      OrchestratorAgent,
    ];
    this.agentRegistry = new Map();
    for (const AgentClass of agentClasses) {
      const instance = new AgentClass(app, null as unknown as User);
      this.agentRegistry.set(instance.name, AgentClass);
    }
  }

  async start(): Promise<void> {
    const schemas = await this.app.data.agenticLoopSchemaRepository.getAllSchemas();
    schemas.forEach((schema) => {
      this.agenticLoopSchemas.set(schema.flowName, schema);
    });
    console.log(`[Agents] Loaded ${schemas.length} agentic loop schemas from database`);

    this.app.data.agenticLoopSchemaRepository.registerHooks({
      onInsert: (schema) => {
        this.agenticLoopSchemas.set(schema.flowName, schema);
        console.log(`[Agents] Schema inserted: ${schema.flowName}`);
      },
      onUpdate: (schema) => {
        this.agenticLoopSchemas.set(schema.flowName, schema);
        console.log(`[Agents] Schema updated: ${schema.flowName}`);
      },
      onDelete: (agentName) => {
        this.agenticLoopSchemas.delete(agentName);
        console.log(`[Agents] Schema deleted: ${agentName}`);
      },
    });

    await this._recoverAgents();
  }

  private async _recoverAgents(): Promise<void> {
    const incomplete = await this.app.data.agentSessionRepository.getIncomplete();
    if (incomplete.length === 0) return;
    console.log(`[Agents] Recovering ${incomplete.length} incomplete agent session(s)`);
    await Promise.allSettled(
      incomplete.map(async (agentSession) => {
        const AgentClass = this.agentRegistry.get(agentSession.agentName);
        if (!AgentClass) {
          console.warn(`[Agents] Cannot restore '${agentSession.agentName}': no registered class`);
          await this.app.data.agentSessionRepository.updateStatus(agentSession.id, 'failed');
          return;
        }
        const user = await this.app.data.userRepository.getUser(agentSession.userId);
        if (!user) {
          console.warn(`[Agents] Cannot restore agent session '${agentSession.id}': user not found`);
          await this.app.data.agentSessionRepository.updateStatus(agentSession.id, 'failed');
          return;
        }
        if (!agentSession.currentFlowName) {
          console.warn(`[Agents] Agent session '${agentSession.id}' has no checkpoint — marking failed`);
          await this.app.data.agentSessionRepository.updateStatus(agentSession.id, 'failed');
          return;
        }
        const flowSessionData = await this.app.data.flowSessionRepository.getByAgentSessionId(agentSession.id);
        console.log(`[Agents._recoverAgents] agentSession='${agentSession.id}' currentFlowName='${agentSession.currentFlowName}' flowSessionData:`, flowSessionData.map(d => ({ id: d.id, flowName: d.flowName, status: d.status, currentNodeName: d.currentNodeName })));
        const flowSessions = flowSessionData.map((data) => new Session(data, this.app));
        const { bus } = this.app.infra;
        const { agentSessionRepository, flowSessionRepository } = this.app.data;
        const agent = new AgentClass(this.app, user, undefined, agentSession.agentSchema as AgentSchema);
        agent.agentSessionId = agentSession.id;
        agent.checkpointer = {
          createAgentSession: async (_agentName, agentSchema, userId) => {
            const record = await agentSessionRepository.create({ agentName: agent.name, agentSchema, userId });
            return record.id;
          },
          checkpointFlow: async (agentSessionId, flowName, flowInput) => {
            await agentSessionRepository.updateCurrent(agentSessionId, flowName, flowInput);
          },
          finalizeAgentSession: async (agentSessionId, status) => {
            console.log(`[Agents.checkpointer.finalizeAgentSession] id='${agentSessionId}' status='${status}'`, new Error('stack').stack);
            await agentSessionRepository.updateStatus(agentSessionId, status);
          },
          linkFlowSession: async (flowSessionId, agentSessionId) => {
            await flowSessionRepository.linkToAgentSession(flowSessionId, agentSessionId);
          },
        };
        agent.sessionHooks = {
          onStatusChange: async (s: Session, from: string, to: string) => {
            bus.emit('session:statusChange', { sessionId: s.id, flowName: s.flowName, userId: s.userId, from, to });
          },
          onMessage: async (s: Session) => {
            bus.emit('session:message:update', { sessionId: s.id, flowName: s.flowName, userId: s.userId });
          },
        };
        const promise = agent.restore(agentSession, flowSessions);
        this._wire(agent, promise);
        console.log(`[Agents] Restored agent '${agentSession.agentName}' session '${agentSession.id}'`);
      }),
    );
  }

  getAgenticLoopSchemas(): StoredAgenticLoopSchema[] {
    return Array.from(this.agenticLoopSchemas.values());
  }

  getAgents(): Agent<App, User, Session>[] {
    return Array.from(this.agentRegistry.values()).map(
      (AgentClass) => new AgentClass(this.app, null as unknown as User),
    );
  }

  getSchemaAgent(agentName: string): StoredAgenticLoopSchema | undefined {
    return this.agenticLoopSchemas.get(agentName);
  }

  getAgentsAsXml(agentNames?: string[]): string {
    const agents = agentNames
      ? agentNames.flatMap((n) => {
          const C = this.agentRegistry.get(n);
          return C ? [new C(this.app, null as unknown as User)] : [];
        })
      : this.getAgents();

    const lines = ['<available_agents>'];
    for (const agent of agents) {
      lines.push('  <agent>');
      lines.push(`    <name>${escapeXml(agent.name)}</name>`);
      lines.push(`    <description>${escapeXml(agent.description)}</description>`);
      lines.push('  </agent>');
    }
    const schemas = this.getAgenticLoopSchemas();
    if (schemas.length > 0) {
      lines.push('  <schema_agents>');
      for (const schema of schemas) {
        lines.push('    <schema_agent>');
        lines.push(`      <name>${escapeXml(schema.flowName)}</name>`);
        lines.push(`      <description>${escapeXml(schema.description)}</description>`);
        lines.push('    </schema_agent>');
      }
      lines.push('  </schema_agents>');
    }
    lines.push('</available_agents>');
    return lines.join('\n');
  }

  async runAgent(
    agentName: string,
    context: AgentContext,
    parameters: { message: string },
  ): Promise<Agent<App, User, Session>> {
    const AgentClass = this.agentRegistry.get(agentName);
    if (AgentClass) {
      return this._run(AgentClass, context, parameters);
    }
    const schema = this.agenticLoopSchemas.get(agentName);
    if (schema) {
      return this.runSchemaAgent(schema, context, parameters);
    }
    const available = [...this.agentRegistry.keys(), ...this.agenticLoopSchemas.keys()].join(', ');
    throw new Error(`Agent '${agentName}' not found. Available: ${available || 'none'}`);
  }

  async runSchemaAgent(
    schema: StoredAgenticLoopSchema,
    context: AgentContext,
    parameters: { message: string },
  ): Promise<Agent<App, User, Session>> {
    const params: AgentFlowParameters = {
      schema: schema as AgentFlowParameters['schema'],
      message: parameters.message,
    };
    return this._run(AgenticLoopAgent, context, params);
  }

  private async _run(
    AgentClass: AnyAgentClass,
    context: AgentContext,
    parameters: unknown,
  ): Promise<Agent<App, User, Session>> {
    const agent = new AgentClass(this.app, context.user, context.parent);

    let resolveFirstSession: () => void;
    const firstSessionReady = new Promise<void>((resolve) => {
      resolveFirstSession = resolve;
    });

    const { bus } = this.app.infra;
    const { agentSessionRepository, flowSessionRepository } = this.app.data;

    agent.checkpointer = {
      createAgentSession: async (_agentName, agentSchema, userId) => {
        const record = await agentSessionRepository.create({ agentName: agent.name, agentSchema, userId });
        return record.id;
      },
      checkpointFlow: async (agentSessionId, flowName, flowInput) => {
        await agentSessionRepository.updateCurrent(agentSessionId, flowName, flowInput);
      },
      finalizeAgentSession: async (agentSessionId, status) => {
        await agentSessionRepository.updateStatus(agentSessionId, status);
      },
      linkFlowSession: async (flowSessionId, agentSessionId) => {
        await flowSessionRepository.linkToAgentSession(flowSessionId, agentSessionId);
      },
    };

    agent.sessionHooks = {
      onRunning: async () => {
        resolveFirstSession();
      },
      onStatusChange: async (s: Session, from: string, to: string) => {
        bus.emit('session:statusChange', { sessionId: s.id, flowName: s.flowName, userId: s.userId, from, to });
      },
      onMessage: async (s: Session) => {
        bus.emit('session:message:update', { sessionId: s.id, flowName: s.flowName, userId: s.userId });
      },
    };

    const promise = agent.run(parameters);
    await firstSessionReady;
    this._wire(agent, promise);
    return agent;
  }

  private _wire(agent: Agent<App, User, Session>, promise: Promise<unknown>): void {
    this.activeAgents.add(agent);
    promise.finally(() => this.activeAgents.delete(agent));
  }

  getActiveAgents(): Set<Agent<App, User, Session>> {
    return this.activeAgents;
  }
}
