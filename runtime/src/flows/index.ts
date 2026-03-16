import { App } from '../app.js';
import { taskSchedulerFlow } from './taskScheduler/flow.js';
import { fillTemplateFlow } from './fillTemplate/flow.js';
import { exploreFlow } from './explore/flow.js';
import { agenticLoopFlow } from './agentictLoop/flow.js';
import { agentBuilderFlow } from './agentBuilder/flow.js';
import { orchestratorFlow } from './orchestrator/flow.js';
import { User } from '../data/userRepository/types.js';
import { Session } from '../services/sessionService/index.js';
import type { StoredAgenticLoopSchema } from '../data/agenticLoopSchemaRepository/types.js';
import type { TObject, Static } from '@sinclair/typebox';
import type { FlowDef, FlowHandle, FlowRunRecord } from './types.js';

/**
 * Common context passed to all flow run functions
 */
export type FlowContext = {
  user: User;
  parent?: Session;
};

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
 *
 * runFlow(name, context, { message }) looks up the flow by name — checking
 * built-in flows first, then schema-based agents — and runs it with full
 * observability (DB record, bus events, activeFlows tracking).
 */
export class Flows {
  private registry = new Map<string, FlowDef<any>>([
    [taskSchedulerFlow.name, taskSchedulerFlow],
    [fillTemplateFlow.name, fillTemplateFlow],
    [exploreFlow.name, exploreFlow],
    [agenticLoopFlow.name, agenticLoopFlow],
    [agentBuilderFlow.name, agentBuilderFlow],
    [orchestratorFlow.name, orchestratorFlow],
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

  getFlow(name: string): FlowDef<any> | undefined {
    return this.registry.get(name);
  }

  getFlows(): FlowDef<any>[] {
    return Array.from(this.registry.values());
  }

  getSlice(names: string[]): FlowDef<any>[] {
    return names.flatMap((name) => {
      const def = this.registry.get(name);
      return def ? [def] : [];
    });
  }

  getSchemaAgent(flowName: string): StoredAgenticLoopSchema | undefined {
    return this.agenticLoopSchemas.get(flowName);
  }

  getFlowsAsXml(flowNames?: string[]): string {
    const defs = flowNames ? this.getSlice(flowNames) : this.getFlows();
    const lines = ['<available_agents>'];

    for (const def of defs) {
      lines.push('  <agent>');
      lines.push(`    <name>${escapeXml(def.name)}</name>`);
      lines.push(`    <description>${escapeXml(def.description)}</description>`);
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
   * Use when you only have the name as a string (e.g. scheduled tasks, LLM-driven calls).
   */
  async runFlow(name: string, context: FlowContext, parameters: { message: string }): Promise<FlowHandle> {
    const builtin = this.registry.get(name);
    if (builtin) {
      return this._run(builtin, name, context, parameters);
    }

    const schema = this.agenticLoopSchemas.get(name);
    if (schema) {
      return this.runSchemaFlow(schema, context, parameters);
    }

    const available = [...this.registry.keys(), ...this.agenticLoopSchemas.keys()].join(', ');
    throw new Error(`Flow '${name}' not found. Available: ${available || 'none'}`);
  }

  /**
   * Type-safe run for built-in flows. Parameters are inferred from the def's schema.
   * Use when you have the FlowDef in hand (e.g. inside tools).
   *
   * @example
   *   const handle = await flows.runBuiltinFlow(fillTemplateFlow, ctx, { message, template });
   */
  async runBuiltinFlow<TSchema extends TObject>(
    def: FlowDef<TSchema>,
    context: FlowContext,
    parameters: Static<TSchema>,
  ): Promise<FlowHandle> {
    return this._run(def, def.name, context, parameters);
  }

  /**
   * Run a schema-based agentic loop flow.
   *
   * @example
   *   const handle = await flows.runSchemaFlow(schema, ctx, { message });
   */
  async runSchemaFlow(
    schema: StoredAgenticLoopSchema,
    context: FlowContext,
    parameters: { message: string },
  ): Promise<FlowHandle> {
    return this._run(agenticLoopFlow, schema.flowName, context, { schema, message: parameters.message });
  }

  private async _run(def: FlowDef<any>, name: string, context: FlowContext, parameters: unknown): Promise<FlowHandle> {
    const { flow, session, promise } = await def.run(this.app, context, parameters);

    const run = await this.app.data.flowRunRepository.createRun({
      flowName: name,
      sessionId: session.id,
      userId: context.user.id,
      parentSessionId: context.parent?.id,
    });

    const { bus } = this.app.infra;

    session.hooks.onStatusChange = async (s, from, to) => {
      bus.emit('session:statusChange', { sessionId: s.id, flowName: name, userId: s.userId, from, to });
    };
    session.hooks.onMessage = async (s) => {
      bus.emit('session:message:update', { sessionId: s.id, flowName: name, userId: s.userId });
    };

    flow.onPause = async () => {
      await this.app.data.flowRunRepository.updateStatus(run.id, 'paused');
      bus.emit('flow:pause', { runId: run.id, sessionId: session.id, flowName: name });
    };
    flow.onResume = async () => {
      await this.app.data.flowRunRepository.updateStatus(run.id, 'running');
      bus.emit('flow:resume', { runId: run.id, sessionId: session.id, flowName: name });
    };
    flow.onExit = async () => {
      await this.app.data.flowRunRepository.updateStatus(run.id, 'completed');
      bus.emit('flow:exit', { runId: run.id, sessionId: session.id, flowName: name });
    };
    flow.onError = async () => {
      await this.app.data.flowRunRepository.updateStatus(run.id, 'failed');
      bus.emit('flow:error', { runId: run.id, sessionId: session.id, flowName: name });
    };

    const trackedPromise = promise.finally(async () => {
      this.activeFlows.delete(session.id);
      const existingRun = await this.app.data.flowRunRepository.getRunBySessionId(session.id);
      if (existingRun && existingRun.status === 'running') {
        await this.app.data.flowRunRepository.updateStatus(run.id, 'failed');
      }
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

  async getFlowRunHistory(userId: string): Promise<FlowRunRecord[]> {
    return this.app.data.flowRunRepository.getRunsByUser(userId);
  }
}
