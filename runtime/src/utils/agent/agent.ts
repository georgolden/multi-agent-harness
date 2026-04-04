import { Value } from '@sinclair/typebox/value';
import type { TObject } from '@sinclair/typebox';
import type { Flow, FlowSessionRef } from './flow.js';
import type { SessionHooks, SessionData } from '../../services/sessionService/types.js';
import type { AgentSessionData, AgentStep, AgentStepItem } from '../../data/agentSessionRepository/types.js';

/** Minimal shape of what the agent reads from a flow result packet. */
type FlowResult = { branch?: string; data?: unknown };

/**
 * Minimal structural interface that TSession must satisfy.
 * Keeps Agent generic without coupling it to the concrete Session class.
 */
export interface AgentSession extends FlowSessionRef {
  hooks: SessionHooks;
  sessionData: SessionData;
  onUserMessage(cb: (payload: { message: string }) => void): void;
}

// ============================================================
// AgentCheckpointer
// ============================================================

/**
 * Minimal interface for persisting agent-level checkpoints.
 * Implement this to wire an AgentSessionRepository into an Agent without
 * coupling the generic Agent base class to any concrete app type.
 */
export interface AgentCheckpointer {
  /** Create a new AgentSession record and return its id. */
  createAgentSession(agentName: string, agentSchema: unknown, userId: string): Promise<string>;
  /** Open a transaction for the upcoming step checkpoint. */
  beginStepTransaction(agentSessionId: string): Promise<void>;
  /**
   * Atomically commit: write currentStep (with sessionId) and link the flow session — one transaction.
   */
  commitStepTransaction(agentSessionId: string, step: AgentStep, flowSessionId: string): Promise<void>;
  /** Roll back an open step transaction (e.g. on createSession failure). */
  rollbackStepTransaction(agentSessionId: string): Promise<void>;
  /** Write the initial parallel step shape (all items start with sessionId=null). No transaction — items link themselves via commitStepTransaction. */
  checkpointParallelStep(agentSessionId: string, step: AgentStep): Promise<void>;
  /** Update a single item within the current parallel step (parallel batch path). */
  updateStepItem(agentSessionId: string, index: number, update: Partial<AgentStepItem>): Promise<void>;
  /** Mark the AgentSession terminal (completed / failed). */
  finalizeAgentSession(agentSessionId: string, status: 'completed' | 'failed'): Promise<void>;
  /**
   * Atomically write status=continuing and the initial step (with the continue input).
   * Must be called before any other work in continue() — crash-safe entry point.
   */
  markContinuing(agentSessionId: string, step: AgentStep): Promise<void>;
}

// ============================================================
// AgentSchema
// ============================================================

/**
 * Descriptor for a parallel batch branch.
 * When a flow emits a BatchPacket on this branch, the agent spawns one chain
 * per item in parallel, then passes aggregated results to `collect`.
 */
export type BatchBranch = {
  mode: 'parallel';
  flow: string; // entry flow for each spawned chain
  collect: string | null; // flow that receives { results, errors } when all done, or null to return
};

/**
 * Wiring descriptor for a single flow inside an agent. Three forms:
 *
 * - `'NextFlow'`                        — always advance to NextFlow
 * - `{ branch: 'TargetFlow', ... }`    — route by branch name from flow output
 * - `null`                              — terminal; agent exits when this flow finishes
 */
export type AgentFlowWiring =
  | string // always go to this flow
  | Record<string, string | null | BatchBranch> // branch name → next flow | null (exit) | parallel batch
  | null; // terminal — agent exits after this flow

/**
 * Describes the flow graph for a multi-flow agent.
 *
 * - `start`  — name of the first flow to execute
 * - `flows`  — flat map of flow name → outgoing wiring
 *
 * For single-flow agents, omit this entirely — the Agent base class
 * auto-derives `{ start: flowName, flows: { [flowName]: null } }`.
 *
 * @example
 * ```ts
 * schema: AgentSchema = {
 *   start: 'ManagerFlow',
 *   flows: {
 *     ManagerFlow:  { task: { mode: parallel, flow: 'ExecutorFlow', collectBranch: success }, finish: null },
 *     ExecutorFlow: 'ReviewerFlow',
 *     ReviewerFlow: { test: 'TesterFlow', fix: 'ExecutorFlow' },
 *     TesterFlow:   { success: 'ManagerFlow', fix: 'ExecutorFlow' },
 *   },
 * };
 * ```
 */
export type AgentSchema = {
  start: string;
  flows: Record<string, AgentFlowWiring>;
};

// ============================================================
// Agent
// ============================================================

/**
 * Abstract base class that glues one or more Flows with their Sessions.
 *
 * - Constructor receives `(app, user, parent?, schemaOverride?)` — stored immediately.
 * - `run(input)` is the only public execution entry point.
 * - Each flow in `flowConstructors` must implement `FlowMeta` (name, description,
 *   parameters, createSession).
 * - For single-flow agents, `schema` is auto-derived — no need to declare it.
 * - For multi-flow agents, declare `schema` on the subclass.
 * - Assign `sessionHooks` to receive lifecycle callbacks on every session created
 *   by this agent.
 *
 * @example — single-flow agent
 * ```ts
 * export class ExploreAgent extends Agent<App> {
 *   flowConstructors = { ExploreFlow };
 * }
 * const agent = new ExploreAgent(app, user, parent);
 * agent.onExit = async (session) => { ... };
 * const result = await agent.run({ message: 'explore the repo' });
 * ```
 *
 * @example — multi-flow agent
 * ```ts
 * export class RalphWiggumLoopAgent extends Agent<App> {
 *   flowConstructors = { ManagerFlow, ExecutorFlow, ReviewerFlow, TesterFlow };
 *   schema: AgentSchema = {
 *     start: 'ManagerFlow',
 *     flows: {
 *       ManagerFlow:  { task: 'ExecutorFlow', finish: null },
 *       ExecutorFlow: 'ReviewerFlow',
 *       ReviewerFlow: { test: 'TesterFlow', fix: 'ExecutorFlow' },
 *       TesterFlow:   { success: 'ManagerFlow', fix: 'ExecutorFlow' },
 *     },
 *   };
 * }
 * ```
 */
export abstract class Agent<TApp = unknown, TUser = unknown, TSession extends AgentSession = AgentSession> {
  /** Human-readable name for this agent. */
  abstract name: string;

  /** Human-readable description of what this agent does. */
  abstract description: string;

  /**
   * Map of flow name → Flow constructor. Each constructor's instance must
   * implement `FlowMeta` (name, description, parameters, createSession).
   */
  abstract flowConstructors: Record<string, new () => Flow<TApp, any, any, any>>;

  /**
   * Optional agent-level flow graph. Auto-derived for single-flow agents.
   * Declare on the subclass for multi-flow agents.
   */
  schema?: AgentSchema;

  // ── Constructor args, stored immediately ──────────────────────────────────

  readonly app: TApp;
  readonly user: TUser;
  readonly parent: TSession | undefined;

  // ── Runtime state ─────────────────────────────────────────────────────────

  /** The running promise, set when run() is called. */
  runPromise: Promise<unknown> | null = null;

  /** Sessions created during this agent's lifetime. */
  allSessions: TSession[] = [];

  /** Sessions whose flow is currently executing. */
  activeSessions: TSession[] = [];

  /** Flows currently executing — parallel to activeSessions. */
  activeFlows: Flow<TApp, any, any, any>[] = [];

  /** Whether the agent is currently paused. */
  paused = false;

  /** Hooks assigned to every session created by this agent. */
  sessionHooks?: SessionHooks;

  /** Optional checkpointer — wire in to persist AgentSession to DB. */
  checkpointer?: AgentCheckpointer;

  /** ID of the current AgentSession DB record (set by run(), cleared on finish). */
  agentSessionId: string | null = null;

  /** Resolves with the first session created (or restored) by this agent. */
  readonly firstSession: Promise<TSession>;
  private _resolveFirstSession: (session: TSession) => void;

  constructor(app: TApp, user: TUser, parent?: TSession, schemaOverride?: AgentSchema) {
    this.app = app;
    this.user = user;
    this.parent = parent;
    if (schemaOverride) this.schema = schemaOverride;
    let resolve!: (session: TSession) => void;
    this.firstSession = new Promise<TSession>((r) => { resolve = r; });
    this._resolveFirstSession = resolve;
  }

  /**
   * Build the flow context. Override to add extra fields (tools, skills, etc.).
   * Default: `{ user, parent, session }`.
   */
  protected buildContext(session: TSession, _input: unknown): Record<string, unknown> {
    return { user: this.user, parent: this.parent, session };
  }

  /**
   * Start the agent. Validates input against the start flow's parameters schema,
   * creates its session, runs the flow, then routes to the next flow based on
   * the output branch — repeating until a terminal (`null`) wiring is reached.
   *
   * Stores the promise on `this.promise`.
   */
  run(input: unknown): Promise<unknown> {
    const schema = this._resolvedSchema();
    this.paused = false;
    this.runPromise = this._initAndExecute(schema.start, input);
    return this.runPromise;
  }

  /**
   * Continue a completed or failed agent session from the schema start node.
   * Reuses the existing agentSessionId — no new AgentSession record is created.
   * The last flow session from the previous run is linked as parent of the new flow session,
   * so flows can call session.attachParentContext() to inject prior context.
   *
   * Atomically writes status=continuing before any other work — crash-safe.
   */
  continue(input: unknown): Promise<unknown> {
    if (!this.agentSessionId) {
      throw new Error(`Agent "${this.constructor.name}": cannot continue — no agentSessionId set`);
    }
    this.paused = false;
    const schema = this._resolvedSchema();
    this.runPromise = this._continueExecute(schema.start, input);
    return this.runPromise;
  }

  private async _continueExecute(startFlow: string, input: unknown): Promise<unknown> {
    if (this.checkpointer && this.agentSessionId) {
      await this.checkpointer.markContinuing(this.agentSessionId, {
        mode: 'single',
        flow: startFlow,
        collect: null,
        items: [{ input, sessionId: null, status: 'running' }],
      });
    }
    try {
      const result = await this._executeFrom(startFlow, input);
      if (this.checkpointer && this.agentSessionId) {
        await this.checkpointer.finalizeAgentSession(this.agentSessionId, 'completed');
      }
      return result;
    } catch (err) {
      if (this.checkpointer && this.agentSessionId) {
        await this.checkpointer.finalizeAgentSession(this.agentSessionId, 'failed').catch(() => {});
      }
      throw err;
    }
  }

  private async _initAndExecute(startFlow: string, input: unknown): Promise<unknown> {
    if (this.checkpointer && !this.agentSessionId) {
      const userId = (this.user as { id?: string })?.id ?? 'unknown';
      this.agentSessionId = await this.checkpointer.createAgentSession(
        this.constructor.name,
        this._resolvedSchema(),
        userId,
      );
    }
    try {
      const result = await this._executeFrom(startFlow, input);
      if (this.checkpointer && this.agentSessionId) {
        await this.checkpointer.finalizeAgentSession(this.agentSessionId, 'completed');
      }
      return result;
    } catch (err) {
      if (this.checkpointer && this.agentSessionId) {
        await this.checkpointer.finalizeAgentSession(this.agentSessionId, 'failed').catch(() => {});
      }
      throw err;
    }
  }

  /**
   * Start the agent from a specific flow, bypassing the schema start node.
   * Creates a fresh flow session for `flowName`, runs it, then continues
   * routing through the rest of the schema as normal.
   *
   * Does NOT create a new AgentSession record — use this for mid-graph restarts
   * where the AgentSession already exists (set `this.agentSessionId` first if
   * you want checkpointing to continue against an existing record).
   *
   * @param flowName - name of the flow to start from (key in flowConstructors)
   * @param input    - input handed to that flow's createSession and run()
   */
  runFrom(flowName: string, input: unknown, existingSession?: TSession): Promise<unknown> {
    this.paused = false;
    this.runPromise = this._executeFrom(flowName, input, existingSession);
    return this.runPromise;
  }

  /**
   * Pause the agent. Aborts all currently active flows — their transactions
   * roll back, leaving each FlowSession at its last committed checkpoint.
   * The agent can be resumed by calling resume() with the session checkpoints.
   */
  pause(): void {
    this.paused = true;
    for (const flow of this.activeFlows) {
      flow.abort();
    }
  }

  /**
   * Resume a paused flow session from its checkpoint.
   * Creates a new flow instance, wires the session back in, and calls runFrom
   * using the session's currentNodeName and currentPacketData.
   *
   * @param flowName - name of the flow to resume (key in flowConstructors)
   * @param session  - the FlowSession to resume from (must have currentNodeName set)
   * @param context  - context object to pass into the packet
   */
  resume(flowName: string, session: TSession, context?: Record<string, unknown>): Promise<unknown> {
    this.paused = false;
    const FlowClass = this.flowConstructors[flowName];
    if (!FlowClass) {
      throw new Error(`Agent "${this.constructor.name}": no constructor for flow "${flowName}"`);
    }
    const nodeName = session.sessionData.currentNodeName;
    const packetData: unknown = session.sessionData.currentPacketData;
    if (!nodeName) {
      throw new Error(`Agent "${this.constructor.name}": session has no currentNodeName — cannot resume`);
    }

    const flow = new FlowClass();
    flow.session = session;

    this.activeFlows.push(flow);
    this.activeSessions.push(session);

    const ctx = context ?? this.buildContext(session, packetData);
    const inPacket = { data: packetData, deps: this.app, context: ctx };

    const restorePromise = flow.restoreSession ? flow.restoreSession(this.app, this.user, session) : Promise.resolve();

    const promise = restorePromise
      .then(() => flow.runFrom(nodeName, inPacket))
      .finally(() => {
        this.activeFlows = this.activeFlows.filter((f) => f !== flow);
        this.activeSessions = this.activeSessions.filter((s) => s !== session);
      });

    this.runPromise = promise;
    return promise;
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private _resolvedSchema(): AgentSchema {
    if (this.schema) return this.schema;
    const names = Object.keys(this.flowConstructors);
    if (names.length === 1) {
      return { start: names[0], flows: { [names[0]]: null } };
    }
    throw new Error(`Agent "${this.constructor.name}" has multiple flows but no schema defined`);
  }

  private async _executeFrom(flowName: string, input: unknown, existingSession?: TSession): Promise<unknown> {
    const FlowClass = this.flowConstructors[flowName];
    if (!FlowClass) {
      throw new Error(`Agent "${this.constructor.name}": no constructor for flow "${flowName}"`);
    }

    const flow = new FlowClass();

    // Validate input against flow parameters schema
    if (!Value.Check(flow.parameters as TObject, input)) {
      console.log({ input, params: flow.parameters });
      const errors = [...Value.Errors(flow.parameters as TObject, input)];
      throw new Error(
        `Agent "${this.constructor.name}": input validation failed for flow "${flowName}":\n` +
          errors.map((e) => `  ${e.path}: ${e.message}`).join('\n'),
      );
    }

    // Reuse existing session if provided (restore path), otherwise create a new one
    // with a transactional checkpoint: begin → createSession → commit (step + link) atomically
    let session: TSession;
    if (existingSession) {
      session = existingSession;
    } else {
      if (this.checkpointer && this.agentSessionId) {
        await this.checkpointer.beginStepTransaction(this.agentSessionId);
      }
      // Find the last session for this flow from prior runs — passed as parent so
      // the new session can call attachParentContext() to inject prior conversation context.
      const lastSessionForFlow = [...this.allSessions].reverse().find(
        (s) => s.sessionData.flowName === flowName,
      );
      const sessionParent = lastSessionForFlow ?? this.parent;
      try {
        session = (await flow.createSession(this.app, this.user, sessionParent, input)) as TSession;
      } catch (err) {
        if (this.checkpointer && this.agentSessionId) {
          await this.checkpointer.rollbackStepTransaction(this.agentSessionId);
        }
        throw err;
      }
      if (this.checkpointer && this.agentSessionId) {
        await this.checkpointer.commitStepTransaction(
          this.agentSessionId,
          { mode: 'single', flow: flowName, collect: null, items: [{ input, sessionId: session.id, status: 'running' }] },
          session.id,
        );
      }
    }

    flow.session = session;

    if (this.allSessions.length === 0) this._resolveFirstSession(session);
    this.allSessions.push(session);
    this.activeSessions.push(session);
    this.activeFlows.push(flow);

    if (this.sessionHooks) {
      Object.assign(session.hooks, this.sessionHooks);
    }

    const context = this.buildContext(session, input);
    console.log(
      `[Agent._executeFrom] flow.run data type=${typeof input} keys=${typeof input === 'object' && input !== null ? Object.keys(input as object).join(',') : 'n/a'} value=${JSON.stringify(input)?.slice(0, 200)}`,
    );
    const result = (await flow.run({
      deps: this.app,
      context: context as Record<string, unknown>,
      data: input,
    })) as FlowResult;

    this.activeSessions = this.activeSessions.filter((s) => s !== session);
    this.activeFlows = this.activeFlows.filter((f) => f !== flow);

    // Route to next flow
    const wiring = this._resolvedSchema().flows[flowName];
    const branch = result.branch ?? 'default';
    const next = this._resolveNext(wiring, branch);

    if (next === null) return result;
    if (typeof next === 'object') {
      // BatchBranch — result must be a batch packet
      const items = result.data as unknown[];
      return this._executeBatch(next, items);
    }
    return this._executeFrom(next, result.data);
  }

  private async _executeBatch(batchBranch: BatchBranch, items: unknown[]): Promise<unknown> {
    if (this.checkpointer && this.agentSessionId) {
      await this.checkpointer.checkpointParallelStep(this.agentSessionId, {
        mode: 'parallel',
        flow: batchBranch.flow,
        collect: batchBranch.collect,
        items: items.map((input) => ({ input, sessionId: null, status: 'running' })),
      });
    }

    const settled = await Promise.allSettled(
      items.map((item, index) =>
        this._executeFrom(batchBranch.flow, item).then(
          async (result) => {
            const failed = (result as FlowResult)?.branch === 'error';
            if (this.checkpointer && this.agentSessionId) {
              await this.checkpointer.updateStepItem(this.agentSessionId, index, {
                status: failed ? 'failed' : 'done',
                result,
              });
            }
            return result;
          },
          async (err) => {
            if (this.checkpointer && this.agentSessionId) {
              await this.checkpointer.updateStepItem(this.agentSessionId, index, {
                status: 'failed',
                result: String(err),
              });
            }
            throw err;
          },
        ),
      ),
    );

    const results: unknown[] = [];
    const errors: unknown[] = [];
    for (const s of settled) {
      if (s.status === 'rejected') {
        errors.push(s.reason);
      } else if ((s.value as FlowResult)?.branch === 'error') {
        errors.push(s.value);
      } else {
        results.push(s.value);
      }
    }

    const collected = { results, errors };
    if (batchBranch.collect === null) return collected;
    return this._executeFrom(batchBranch.collect, collected);
  }

  /**
   * Resume this agent from a persisted AgentSession checkpoint.
   * Call after wiring checkpointer and sessionHooks — this starts execution immediately.
   *
   * @param agentSession - persisted AgentSession record (must have currentStep set)
   * @param flowSessions - live TSession objects linked to this AgentSession
   */
  async restore(agentSession: AgentSessionData, flowSessions: TSession[]): Promise<unknown> {
    if (!agentSession.currentStep) {
      throw new Error(`Agent.restore: AgentSession '${agentSession.id}' has no currentStep checkpoint`);
    }

    const step = agentSession.currentStep;
    console.log(`[Agent.restore] agentSession='${agentSession.id}' mode='${step.mode}' flow='${step.flow}'`);

    this.agentSessionId = agentSession.id;

    try {
      const result =
        step.mode === 'parallel'
          ? await this._restoreParallel(step, flowSessions)
          : await this._restoreSingle(step, flowSessions);

      const branch = (result as FlowResult)?.branch;
      const errorData = (result as FlowResult)?.data;
      console.log(
        `[Agent.restore] finished agentSession='${agentSession.id}' branch='${branch}'${branch === 'error' ? ` error=${errorData}` : ''}`,
      );
      if (branch === 'error') {
        if (this.checkpointer && this.agentSessionId) {
          await this.checkpointer.finalizeAgentSession(this.agentSessionId, 'failed').catch(() => {});
        }
        return result;
      }
      if (branch !== 'abort' && this.checkpointer && this.agentSessionId) {
        await this.checkpointer.finalizeAgentSession(this.agentSessionId, 'completed');
      }
      return result;
    } catch (err) {
      console.error(`[Agent.restore] threw agentSession='${agentSession.id}'`, err);
      if (this.checkpointer && this.agentSessionId) {
        await this.checkpointer.finalizeAgentSession(this.agentSessionId, 'failed').catch(() => {});
      }
      throw err;
    }
  }

  private async _restoreSingle(step: AgentStep, flowSessions: TSession[]): Promise<unknown> {
    const item = step.items[0];
    const flowSession = item.sessionId ? flowSessions.find((fs) => fs.id === item.sessionId) : undefined;

    const status = flowSession?.sessionData.status;
    const nodeName = flowSession?.sessionData.currentNodeName;

    console.log(
      `[Agent.restore] single flow='${step.flow}' session=${flowSession ? `id='${flowSession.id}' status='${status}' nodeName='${nodeName}'` : 'none'}`,
    );

    // Paused — waiting for user input. Do NOT re-run the pausing node (e.g. AskUser).
    if (flowSession && status === 'paused') {
      const schema = flowSession.sessionData.flowSchema as { nodes: Record<string, unknown> } | undefined;
      const nodeWiring = nodeName ? schema?.nodes?.[nodeName] : undefined;
      const pauseHandlerName =
        typeof nodeWiring === 'object' && nodeWiring !== null && 'pause' in nodeWiring
          ? (nodeWiring as Record<string, string>)['pause']
          : undefined;
      console.log(`[Agent.restore] session '${flowSession.id}' is paused at '${nodeName ?? 'unknown'}' — waiting for user message`);
      if (this.allSessions.length === 0) this._resolveFirstSession(flowSession);
      this.allSessions.push(flowSession);
      this.runPromise = new Promise<unknown>((resolve, reject) => {
        flowSession.onUserMessage(({ message }: { message: string }) => {
          if (pauseHandlerName) {
            flowSession.sessionData.currentNodeName = pauseHandlerName;
            flowSession.sessionData.currentPacketData = message;
            this.resume(step.flow, flowSession).then(resolve).catch(reject);
          } else if (nodeName) {
            flowSession.sessionData.currentPacketData = message;
            this.resume(step.flow, flowSession).then(resolve).catch(reject);
          } else {
            // No node checkpoint — re-enter the flow from scratch reusing the existing session
            this.runFrom(step.flow, message, flowSession).then(resolve).catch(reject);
          }
        });
      });
      return this.runPromise;
    }

    return status === 'running' && nodeName && flowSession
      ? this.resume(step.flow, flowSession)
      : this.runFrom(step.flow, item.input, flowSession ?? undefined);
  }

  private async _restoreParallel(step: AgentStep, flowSessions: TSession[]): Promise<unknown> {
    const settled = await Promise.allSettled(
      step.items.map((item, index) => {
        // Already finished — use stored result
        if (item.status === 'done' || item.status === 'failed') {
          return item.status === 'done' ? Promise.resolve(item.result) : Promise.reject(item.result);
        }

        // Still running — resume or restart
        const flowSession = item.sessionId ? flowSessions.find((fs) => fs.id === item.sessionId) : undefined;
        const nodeName = flowSession?.sessionData.currentNodeName;
        const sessionStatus = flowSession?.sessionData.status;

        console.log(
          `[Agent.restore] parallel item[${index}] flow='${step.flow}' session=${flowSession ? `id='${flowSession.id}' status='${sessionStatus}' nodeName='${nodeName}'` : 'none'}`,
        );

        // Paused — waiting for user input
        if (flowSession && sessionStatus === 'paused') {
          const schema = flowSession.sessionData.flowSchema as { nodes: Record<string, unknown> } | undefined;
          const nodeWiring = nodeName ? schema?.nodes?.[nodeName] : undefined;
          const pauseHandlerName =
            typeof nodeWiring === 'object' && nodeWiring !== null && 'pause' in nodeWiring
              ? (nodeWiring as Record<string, string>)['pause']
              : undefined;
          console.log(
            `[Agent.restore] parallel item[${index}] session '${flowSession.id}' is paused at '${nodeName ?? 'unknown'}' — waiting for user message`,
          );
          if (this.allSessions.length === 0) this._resolveFirstSession(flowSession);
          this.allSessions.push(flowSession);
          return new Promise<unknown>((resolve, reject) => {
            flowSession.onUserMessage(({ message }: { message: string }) => {
              if (pauseHandlerName) {
                flowSession.sessionData.currentNodeName = pauseHandlerName;
                flowSession.sessionData.currentPacketData = message;
                this.resume(step.flow, flowSession).then(resolve).catch(reject);
              } else if (nodeName) {
                flowSession.sessionData.currentPacketData = message;
                this.resume(step.flow, flowSession).then(resolve).catch(reject);
              } else {
                this.runFrom(step.flow, message, flowSession).then(resolve).catch(reject);
              }
            });
          });
        }

        return (
          sessionStatus === 'running' && nodeName && flowSession
            ? this.resume(step.flow, flowSession)
            : this.runFrom(step.flow, item.input, flowSession ?? undefined)
        ).then(
          async (result) => {
            if (this.checkpointer && this.agentSessionId) {
              await this.checkpointer.updateStepItem(this.agentSessionId, index, { status: 'done', result });
            }
            return result;
          },
          async (err) => {
            if (this.checkpointer && this.agentSessionId) {
              await this.checkpointer.updateStepItem(this.agentSessionId, index, {
                status: 'failed',
                result: String(err),
              });
            }
            throw err;
          },
        );
      }),
    );

    const results: unknown[] = [];
    const errors: unknown[] = [];
    for (const s of settled) {
      if (s.status === 'rejected') {
        errors.push(s.reason);
      } else if ((s.value as FlowResult)?.branch === 'error') {
        errors.push(s.value);
      } else {
        results.push(s.value);
      }
    }

    const collected = { results, errors };
    if (step.collect === null) return collected;
    return this._executeFrom(step.collect, collected);
  }

  private _resolveNext(wiring: AgentFlowWiring, branch: string): string | null | BatchBranch {
    if (wiring === null) return null;
    if (typeof wiring === 'string') return wiring;
    // branch-map: try exact branch, then 'default', then null (exit)
    if (branch in wiring) return wiring[branch];
    if ('default' in wiring) return wiring['default'];
    return null;
  }
}
