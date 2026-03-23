import { App } from '../app.js';
import { TaskSchedulerRunner } from './taskScheduler/flow.js';
import { FillTemplateRunner } from './fillTemplate/flow.js';
import { ExploreRunner } from './explore/flow.js';
import { AgenticLoopRunner } from './agentictLoop/flow.js';
import { AgentBuilderRunner } from './agentBuilder/flow.js';
import { OrchestratorRunner } from './orchestrator/flow.js';
import { User } from '../data/userRepository/types.js';
import { Session } from '../services/sessionService/index.js';
import type { StoredAgenticLoopSchema } from '../data/agenticLoopSchemaRepository/types.js';
import type { FlowHandle, FlowRunRecord } from './types.js';
import type { FlowRunner } from '../utils/agent/flowRunner.js';

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
 * runFlow(name, context, { message }) looks up the runner by name — checking
 * built-in runners first, then schema-based agents — and runs it with full
 * observability (DB record, bus events, activeFlows tracking).
 */
export class Flows {
  private registry = new Map<string, FlowRunner<any, any>>([
    ['taskScheduler', new TaskSchedulerRunner()],
    ['fillTemplate', new FillTemplateRunner()],
    ['explore', new ExploreRunner()],
    ['agenticLoop', new AgenticLoopRunner()],
    ['agentBuilder', new AgentBuilderRunner()],
    ['orchestrator', new OrchestratorRunner()],
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

    await this._restoreActiveFlows();
  }

  private async _restoreActiveFlows(): Promise<void> {
    const interrupted = await this.app.data.flowRunRepository.getActiveRuns();
    if (interrupted.length === 0) return;

    console.log(`[Flows] Found ${interrupted.length} interrupted flow run(s) to restore`);

    for (const run of interrupted) {
      const sessionData = await this.app.data.flowSessionRepository.getSession(run.sessionId);
      if (!sessionData || !sessionData.currentNodeName) continue;

      const user = await this.app.data.userRepository.getUser(sessionData.userId);
      if (!user) continue;

      const runner = this.registry.get(run.flowName);
      if (!runner) {
        console.warn(`[Flows] No runner registered for flow '${run.flowName}', skipping restore`);
        continue;
      }

      const session = await this.app.services.sessionService.get(sessionData.id);
      if (!session) continue;

      console.log(`[Flows] Restoring flow '${run.flowName}' session '${run.sessionId}'`);
      runner.restore(this.app, session, user).then(() => {
        this._wireFlowHooks(runner, run.id, run.flowName, session);
        const trackedPromise = runner.promise.finally(() => {
          this.activeFlows.delete(session.id);
        });
        this.activeFlows.set(session.id, { flow: runner.flow, session, promise: trackedPromise });
      }).catch((err) => {
        console.error(`[Flows] Failed to restore session '${run.sessionId}':`, err);
      });
    }
  }

  getRunner(name: string): FlowRunner<any, any> | undefined {
    return this.registry.get(name);
  }

  getRunners(): FlowRunner<any, any>[] {
    return Array.from(this.registry.values());
  }

  getSlice(names: string[]): FlowRunner<any, any>[] {
    return names.flatMap((name) => {
      const runner = this.registry.get(name);
      return runner ? [runner] : [];
    });
  }

  getSchemaAgent(flowName: string): StoredAgenticLoopSchema | undefined {
    return this.agenticLoopSchemas.get(flowName);
  }

  getAgenticLoopSchemas(): StoredAgenticLoopSchema[] {
    return Array.from(this.agenticLoopSchemas.values());
  }

  getFlowsAsXml(flowNames?: string[]): string {
    const runners = flowNames ? this.getSlice(flowNames) : this.getRunners();
    const lines = ['<available_agents>'];

    for (const runner of runners) {
      lines.push('  <agent>');
      lines.push(`    <name>${escapeXml(runner.flowName)}</name>`);
      lines.push(`    <description>${escapeXml(runner.description)}</description>`);
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
   * Run a flow by name. Looks up built-in runners first, then schema-based agents.
   */
  async runFlow(name: string, context: FlowContext, parameters: { message: string }): Promise<FlowHandle> {
    const runner = this.registry.get(name);
    if (runner) {
      return this._run(runner, name, context, parameters);
    }

    const schema = this.agenticLoopSchemas.get(name);
    if (schema) {
      return this.runSchemaFlow(schema, context, parameters);
    }

    const available = [...this.registry.keys(), ...this.agenticLoopSchemas.keys()].join(', ');
    throw new Error(`Flow '${name}' not found. Available: ${available || 'none'}`);
  }

  /**
   * Type-safe run for built-in runners.
   */
  async runBuiltinFlow<TParams>(
    runner: FlowRunner<any, TParams>,
    context: FlowContext,
    parameters: TParams,
  ): Promise<FlowHandle> {
    return this._run(runner, runner.flowName, context, parameters);
  }

  /**
   * Run a schema-based agentic loop flow.
   */
  async runSchemaFlow(
    schema: StoredAgenticLoopSchema,
    context: FlowContext,
    parameters: { message: string },
  ): Promise<FlowHandle> {
    const runner = this.registry.get('agenticLoop')!;
    return this._run(runner, schema.flowName, context, { schema, message: parameters.message });
  }

  private _wireFlowHooks(
    runner: FlowRunner<any, any>,
    runId: string,
    flowName: string,
    session: Session,
  ): void {
    const { bus } = this.app.infra;
    const { flow } = runner;

    session.hooks.onStatusChange = async (s, from, to) => {
      bus.emit('session:statusChange', { sessionId: s.id, flowName, userId: s.userId, from, to });
    };
    session.hooks.onMessage = async (s) => {
      bus.emit('session:message:update', { sessionId: s.id, flowName, userId: s.userId });
    };

    flow.onBeforeNode = async (_nodeName, _packet) => {
      await session.beginNodeTransaction();
    };

    flow.onAfterNode = async (nodeName, result) => {
      const serialized = runner.serializePacketData(nodeName, (result as any).data);
      await session.commitNodeTransaction(nodeName, serialized);
    };

    flow.onPause = async () => {
      await this.app.data.flowRunRepository.updateStatus(runId, 'paused');
      bus.emit('flow:pause', { runId, sessionId: session.id, flowName });
    };
    flow.onResume = async () => {
      await this.app.data.flowRunRepository.updateStatus(runId, 'running');
      bus.emit('flow:resume', { runId, sessionId: session.id, flowName });
    };
    flow.onExit = async () => {
      await this.app.data.flowRunRepository.updateStatus(runId, 'completed');
      bus.emit('flow:exit', { runId, sessionId: session.id, flowName });
    };
    flow.onError = async () => {
      await session.rollbackNodeTransaction().catch(() => {});
      await this.app.data.flowRunRepository.updateStatus(runId, 'failed');
      bus.emit('flow:error', { runId, sessionId: session.id, flowName });
    };
  }

  private async _run(runner: FlowRunner<any, any>, name: string, context: FlowContext, parameters: unknown): Promise<FlowHandle> {
    await runner.start(this.app, context, parameters as any);

    const run = await this.app.data.flowRunRepository.createRun({
      flowName: name,
      sessionId: runner.session.id,
      userId: context.user.id,
      parentSessionId: context.parent?.id,
    });

    this._wireFlowHooks(runner, run.id, name, runner.session);

    const trackedPromise = runner.promise.finally(async () => {
      this.activeFlows.delete(runner.session.id);
      const existingRun = await this.app.data.flowRunRepository.getRunBySessionId(runner.session.id);
      if (existingRun && existingRun.status === 'running') {
        await this.app.data.flowRunRepository.updateStatus(run.id, 'failed');
      }
    });

    const handle: FlowHandle = { flow: runner.flow, session: runner.session, promise: trackedPromise };
    this.activeFlows.set(runner.session.id, handle);
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
