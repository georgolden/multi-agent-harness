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
      this.agenticLoopSchemas.set(schema.name, schema);
    });
    console.log(`[Agents] Loaded ${schemas.length} agentic loop schemas from database`);

    this.app.data.agenticLoopSchemaRepository.registerHooks({
      onInsert: (schema) => {
        this.agenticLoopSchemas.set(schema.name, schema);
        console.log(`[Agents] Schema inserted: ${schema.name}`);
      },
      onUpdate: (schema) => {
        this.agenticLoopSchemas.set(schema.name, schema);
        console.log(`[Agents] Schema updated: ${schema.name}`);
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
        if (!agentSession.currentStep) {
          console.warn(`[Agents] Agent session '${agentSession.id}' has no checkpoint — marking failed`);
          await this.app.data.agentSessionRepository.updateStatus(agentSession.id, 'failed');
          return;
        }
        const flowSessionData = await this.app.data.flowSessionRepository.getByAgentSessionId(agentSession.id);
        console.log(`[Agents._recoverAgents] agentSession='${agentSession.id}' currentStep=`, agentSession.currentStep, `flowSessionData:`, flowSessionData.map(d => ({ id: d.id, flowName: d.flowName, status: d.status, currentNodeName: d.currentNodeName })));
        const flowSessions = flowSessionData.map((data) => new Session(data, this.app));
        const { bus } = this.app.infra;
        const { agentSessionRepository } = this.app.data;
        const agent = new AgentClass(this.app, user, undefined, agentSession.agentSchema as AgentSchema);
        agent.agentSessionId = agentSession.id;
        agent.checkpointer = {
          createAgentSession: async (_agentName, agentSchema, userId) => {
            const record = await agentSessionRepository.create({ agentName: agent.name, agentSchema, userId });
            return record.id;
          },
          beginStepTransaction: async (agentSessionId) => {
            await agentSessionRepository.beginTransaction(agentSessionId);
          },
          commitStepTransaction: async (agentSessionId, step, flowSessionId) => {
            await agentSessionRepository.commitTransaction(agentSessionId, step, flowSessionId);
          },
          rollbackStepTransaction: async (agentSessionId) => {
            await agentSessionRepository.rollbackTransaction(agentSessionId);
          },
          checkpointParallelStep: async (agentSessionId, step) => {
            await agentSessionRepository.updateCurrent(agentSessionId, step);
          },
          updateStepItem: async (agentSessionId, index, update) => {
            const record = await agentSessionRepository.getById(agentSessionId);
            if (!record?.currentStep) return;
            const items = [...record.currentStep.items];
            items[index] = { ...items[index], ...update };
            await agentSessionRepository.updateCurrent(agentSessionId, { ...record.currentStep, items });
          },
          finalizeAgentSession: async (agentSessionId, status) => {
            console.log(`[Agents.checkpointer.finalizeAgentSession] id='${agentSessionId}' status='${status}'`, new Error('stack').stack);
            await agentSessionRepository.updateStatus(agentSessionId, status);
          },
          markContinuing: async (agentSessionId, step) => {
            await agentSessionRepository.markContinuing(agentSessionId, step);
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
        const isContinuing = agentSession.status === 'continuing';
        const continueInput = agentSession.currentStep!.items[0].input;
        console.log(`[Agents._recoverAgents] session='${agentSession.id}' isContinuing=${isContinuing} continueInput=`, JSON.stringify(continueInput));
        const promise = isContinuing
          ? agent.continue(continueInput)
          : agent.restore(agentSession, flowSessions);
        this._wire(agent, promise);
        console.log(`[Agents] ${isContinuing ? 'Continuing' : 'Restored'} agent '${agentSession.agentName}' session '${agentSession.id}'`);
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
        lines.push(`      <name>${escapeXml(schema.name)}</name>`);
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
      return this.runSchemaAgent(agentName, context, parameters);
    }
    const available = [...this.agentRegistry.keys(), ...this.agenticLoopSchemas.keys()].join(', ');
    throw new Error(`Agent '${agentName}' not found. Available: ${available || 'none'}`);
  }

  async runSchemaAgent(
    schemaName: string,
    context: AgentContext,
    parameters: { message: string },
  ): Promise<Agent<App, User, Session>> {
    const params: AgentFlowParameters = { name: schemaName, message: parameters.message };
    console.log(`[Agents.runSchemaAgent] name='${schemaName}'`);
    return this._run(AgenticLoopAgent, context, params);
  }

  private async _run(
    AgentClass: AnyAgentClass,
    context: AgentContext,
    parameters: unknown,
  ): Promise<Agent<App, User, Session>> {
    const agent = new AgentClass(this.app, context.user, context.parent);

    const { bus } = this.app.infra;
    const { agentSessionRepository } = this.app.data;

    agent.checkpointer = {
      createAgentSession: async (_agentName, agentSchema, userId) => {
        const record = await agentSessionRepository.create({ agentName: agent.name, agentSchema, userId });
        return record.id;
      },
      beginStepTransaction: async (agentSessionId) => {
        await agentSessionRepository.beginTransaction(agentSessionId);
      },
      commitStepTransaction: async (agentSessionId, step, flowSessionId) => {
        await agentSessionRepository.commitTransaction(agentSessionId, step, flowSessionId);
      },
      rollbackStepTransaction: async (agentSessionId) => {
        await agentSessionRepository.rollbackTransaction(agentSessionId);
      },
      checkpointParallelStep: async (agentSessionId, step) => {
        await agentSessionRepository.updateCurrent(agentSessionId, step);
      },
      updateStepItem: async (agentSessionId, index, update) => {
        const record = await agentSessionRepository.getById(agentSessionId);
        if (!record?.currentStep) return;
        const items = [...record.currentStep.items];
        items[index] = { ...items[index], ...update };
        await agentSessionRepository.updateCurrent(agentSessionId, { ...record.currentStep, items });
      },
      finalizeAgentSession: async (agentSessionId, status) => {
        await agentSessionRepository.updateStatus(agentSessionId, status);
      },
      markContinuing: async (agentSessionId, step) => {
        await agentSessionRepository.markContinuing(agentSessionId, step);
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

    const promise = agent.run(parameters);
    this._wire(agent, promise);
    return agent;
  }

  async continueAgent(
    agentName: string,
    context: AgentContext,
    input: Record<string, unknown>,
  ): Promise<Agent<App, User, Session>> {
    console.log(`[Agents.continueAgent] agentName='${agentName}' input=`, JSON.stringify(input));
    const { agentSessionRepository } = this.app.data;
    const sessions = await agentSessionRepository.getByUserId(context.user.id);
    const last = sessions.find((s) => s.agentName === agentName && (s.status === 'completed' || s.status === 'failed'));
    console.log(`[Agents.continueAgent] last session=`, last ? `id='${last.id}' status='${last.status}' input=` + JSON.stringify(last.currentStep?.items[0]?.input) : 'none');
    const AgentClass = this.agentRegistry.get(agentName) ?? AgenticLoopAgent;
    if (!last) return this._run(AgentClass, context, input);
    return this._continueWith(AgentClass, context, input, last.id);
  }

  private async _continueWith(
    AgentClass: AnyAgentClass,
    context: AgentContext,
    input: unknown,
    agentSessionId: string,
  ): Promise<Agent<App, User, Session>> {
    const { bus } = this.app.infra;
    const { agentSessionRepository, flowSessionRepository } = this.app.data;
    const agent = new AgentClass(this.app, context.user, context.parent);
    agent.agentSessionId = agentSessionId;

    const prevFlowSessionData = await flowSessionRepository.getByAgentSessionId(agentSessionId);
    agent.allSessions = prevFlowSessionData.map((data) => new Session(data, this.app)) as Session[];

    agent.checkpointer = {
      createAgentSession: async (_agentName, agentSchema, userId) => {
        const record = await agentSessionRepository.create({ agentName: agent.name, agentSchema, userId });
        return record.id;
      },
      beginStepTransaction: async (id) => { await agentSessionRepository.beginTransaction(id); },
      commitStepTransaction: async (id, step, flowSessionId) => { await agentSessionRepository.commitTransaction(id, step, flowSessionId); },
      rollbackStepTransaction: async (id) => { await agentSessionRepository.rollbackTransaction(id); },
      checkpointParallelStep: async (id, step) => { await agentSessionRepository.updateCurrent(id, step); },
      updateStepItem: async (id, index, update) => {
        const record = await agentSessionRepository.getById(id);
        if (!record?.currentStep) return;
        const items = [...record.currentStep.items];
        items[index] = { ...items[index], ...update };
        await agentSessionRepository.updateCurrent(id, { ...record.currentStep, items });
      },
      finalizeAgentSession: async (id, status) => { await agentSessionRepository.updateStatus(id, status); },
      markContinuing: async (id, step) => { await agentSessionRepository.markContinuing(id, step); },
    };

    agent.sessionHooks = {
      onStatusChange: async (s: Session, from: string, to: string) => {
        bus.emit('session:statusChange', { sessionId: s.id, flowName: s.flowName, userId: s.userId, from, to });
      },
      onMessage: async (s: Session) => {
        bus.emit('session:message:update', { sessionId: s.id, flowName: s.flowName, userId: s.userId });
      },
    };

    const promise = agent.continue(input);
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
