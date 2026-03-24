import { App } from '../app.js';
import { TaskSchedulerFlow } from './taskScheduler/flow.js';
import { FillTemplateFlow } from './fillTemplate/flow.js';
import { ExploreFlow } from './explore/flow.js';
import { AgenticLoopFlow, type AgentFlowParameters } from './agentictLoop/flow.js';
import { AgentBuilderFlow } from './agentBuilder/flow.js';
import { OrchestratorFlow } from './orchestrator/flow.js';
import { User } from '../data/userRepository/types.js';
import { Session } from '../services/sessionService/index.js';
import type { StoredAgenticLoopSchema } from '../data/agenticLoopSchemaRepository/types.js';
import type { Flow } from '../utils/agent/flow.js';
import type { FlowHandle } from './types.js';

/**
 * Common context passed to all flow run functions
 */
export type FlowContext = {
  user: User;
  parent?: Session;
};

type AnyFlowClass = new () => Flow<App, any, any, any>;

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Flows manager. All flow execution is centralized here.
 */
export class Flows {
  private registry = new Map<string, AnyFlowClass>([
    [new TaskSchedulerFlow().name, TaskSchedulerFlow],
    [new FillTemplateFlow().name, FillTemplateFlow],
    [new ExploreFlow().name, ExploreFlow],
    [new AgenticLoopFlow().name, AgenticLoopFlow],
    [new AgentBuilderFlow().name, AgentBuilderFlow],
    [new OrchestratorFlow().name, OrchestratorFlow],
  ]);

  app: App;
  private agenticLoopSchemas: Map<string, StoredAgenticLoopSchema> = new Map();
  private activeFlows: Map<string, FlowHandle> = new Map();

  constructor(app: App) {
    this.app = app;
  }

  async start(): Promise<void> {
    const schemas = await this.app.data.agenticLoopSchemaRepository.getAllSchemas();
    schemas.forEach((schema) => {
      this.agenticLoopSchemas.set(schema.flowName, schema);
    });
    console.log(`[Flows] Loaded ${schemas.length} agentic loop schemas from database`);

    this.app.data.agenticLoopSchemaRepository.registerHooks({
      onInsert: (schema) => {
        this.agenticLoopSchemas.set(schema.flowName, schema);
        console.log(`[Flows] Schema inserted: ${schema.flowName}`);
      },
      onUpdate: (schema) => {
        this.agenticLoopSchemas.set(schema.flowName, schema);
        console.log(`[Flows] Schema updated: ${schema.flowName}`);
      },
      onDelete: (flowName) => {
        this.agenticLoopSchemas.delete(flowName);
        console.log(`[Flows] Schema deleted: ${flowName}`);
      },
    });
  }

  getAgenticLoopSchemas(): StoredAgenticLoopSchema[] {
    return Array.from(this.agenticLoopSchemas.values());
  }

  getFlowClass(name: string): AnyFlowClass | undefined {
    return this.registry.get(name);
  }

  getFlowClasses(): AnyFlowClass[] {
    return Array.from(this.registry.values());
  }

  getSchemaAgent(flowName: string): StoredAgenticLoopSchema | undefined {
    return this.agenticLoopSchemas.get(flowName);
  }

  getFlowsAsXml(flowNames?: string[]): string {
    const classes = flowNames
      ? flowNames.flatMap((n) => { const c = this.registry.get(n); return c ? [c] : []; })
      : this.getFlowClasses();

    const lines = ['<available_agents>'];

    for (const FlowClass of classes) {
      const instance = new FlowClass();
      lines.push('  <agent>');
      lines.push(`    <name>${escapeXml(instance.name)}</name>`);
      lines.push(`    <description>${escapeXml(instance.description)}</description>`);
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

  /**
   * Run a flow by name. Looks up built-in flows first, then schema-based agents.
   */
  async runFlow(name: string, context: FlowContext, parameters: { message: string }): Promise<FlowHandle> {
    const FlowClass = this.registry.get(name);
    if (FlowClass) {
      return this._run(FlowClass, name, context, parameters);
    }

    const schema = this.agenticLoopSchemas.get(name);
    if (schema) {
      return this.runSchemaFlow(schema, context, parameters);
    }

    const available = [...this.registry.keys(), ...this.agenticLoopSchemas.keys()].join(', ');
    throw new Error(`Flow '${name}' not found. Available: ${available || 'none'}`);
  }

  /**
   * Run a schema-based agentic loop flow.
   */
  async runSchemaFlow(
    schema: StoredAgenticLoopSchema,
    context: FlowContext,
    parameters: { message: string },
  ): Promise<FlowHandle> {
    const params: AgentFlowParameters = { schema: schema as any, message: parameters.message };
    return this._run(AgenticLoopFlow as AnyFlowClass, schema.flowName, context, params);
  }

  private async _run(FlowClass: AnyFlowClass, name: string, context: FlowContext, parameters: unknown): Promise<FlowHandle> {
    const flow = new FlowClass();
    const session = await flow.createSession(this.app, context.user, context.parent, parameters) as Session;

    const { bus } = this.app.infra;

    (session as any).hooks.onStatusChange = async (s: Session, from: string, to: string) => {
      bus.emit('session:statusChange', { sessionId: s.id, flowName: name, userId: s.userId, from, to });
    };
    (session as any).hooks.onMessage = async (s: Session) => {
      bus.emit('session:message:update', { sessionId: s.id, flowName: name, userId: s.userId });
    };

    const ctx = { user: context.user, parent: context.parent, session };
    const promise = flow.run({ deps: this.app, context: ctx, data: parameters });

    const trackedPromise = promise.finally(() => {
      this.activeFlows.delete(session.id);
    });

    const handle: FlowHandle = { flow, session, promise: trackedPromise };
    this.activeFlows.set(session.id, handle);
    return handle;
  }

  // ─── Observable queries ──────────────────────────────────────────────────

  getActiveFlows(): Map<string, FlowHandle> {
    return this.activeFlows;
  }

  getFlowHandle(sessionId: string): FlowHandle | undefined {
    return this.activeFlows.get(sessionId);
  }

}
