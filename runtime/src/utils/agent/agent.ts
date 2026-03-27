import { Value } from '@sinclair/typebox/value';
import type { TObject } from '@sinclair/typebox';
import type { Flow } from './flow.js';
import type { SessionHooks, SessionData } from '../../services/sessionService/types.js';
import type { AgentSessionData } from '../../data/agentSessionRepository/types.js';

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
  /** Atomically checkpoint which flow is currently running and what its input was. */
  checkpointFlow(agentSessionId: string, flowName: string, flowInput: unknown): Promise<void>;
  /** Mark the AgentSession terminal (completed / failed). */
  finalizeAgentSession(agentSessionId: string, status: 'completed' | 'failed'): Promise<void>;
  /** Link a FlowSession to this AgentSession. */
  linkFlowSession(flowSessionId: string, agentSessionId: string): Promise<void>;
}

// ============================================================
// AgentSchema
// ============================================================

/**
 * Wiring descriptor for a single flow inside an agent. Three forms:
 *
 * - `'NextFlow'`                        — always advance to NextFlow
 * - `{ branch: 'TargetFlow', ... }`    — route by branch name from flow output
 * - `null`                              — terminal; agent exits when this flow finishes
 */
export type AgentFlowWiring =
  | string // always go to this flow
  | Record<string, string | null> // branch name → next flow name | null (exit)
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
 *     ManagerFlow:  { task: 'ExecutorFlow', finish: null },
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
export abstract class Agent<TApp = unknown, TUser = unknown, TSession = unknown> {
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

  constructor(app: TApp, user: TUser, parent?: TSession, schemaOverride?: AgentSchema) {
    this.app = app;
    this.user = user;
    this.parent = parent;
    if (schemaOverride) this.schema = schemaOverride;
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

  private async _initAndExecute(startFlow: string, input: unknown): Promise<unknown> {
    if (this.checkpointer) {
      const userId = (this.user as any)?.id ?? 'unknown';
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
  runFrom(flowName: string, input: unknown): Promise<unknown> {
    this.paused = false;
    this.runPromise = this._executeFrom(flowName, input);
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
    const s = session as any;
    const nodeName: string = s.currentNodeName ?? s.sessionData?.currentNodeName;
    const packetData: unknown = s.currentPacketData ?? s.sessionData?.currentPacketData;
    if (!nodeName) {
      throw new Error(`Agent "${this.constructor.name}": session has no currentNodeName — cannot resume`);
    }

    const flow = new FlowClass();
    flow.session = session as any;

    this.activeFlows.push(flow);
    this.activeSessions.push(session);

    const ctx = context ?? this.buildContext(session, packetData);
    const inPacket = { data: packetData, deps: this.app, context: ctx };

    const promise = flow.runFrom(nodeName, inPacket as any).finally(() => {
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

  private async _executeFrom(flowName: string, input: unknown): Promise<unknown> {
    const FlowClass = this.flowConstructors[flowName];
    if (!FlowClass) {
      throw new Error(`Agent "${this.constructor.name}": no constructor for flow "${flowName}"`);
    }

    const flow = new FlowClass();

    // Validate input against flow parameters schema
    if (!Value.Check(flow.parameters as TObject, input)) {
      const errors = [...Value.Errors(flow.parameters as TObject, input)];
      throw new Error(
        `Agent "${this.constructor.name}": input validation failed for flow "${flowName}":\n` +
          errors.map((e) => `  ${e.path}: ${e.message}`).join('\n'),
      );
    }

    // Checkpoint: record which flow we're about to enter
    if (this.checkpointer && this.agentSessionId) {
      await this.checkpointer.checkpointFlow(this.agentSessionId, flowName, input);
    }

    // Create session — flow is responsible for building its system prompt
    const session = (await flow.createSession(this.app, this.user, this.parent, input)) as TSession;

    // Link flow session to agent session
    if (this.checkpointer && this.agentSessionId) {
      await this.checkpointer.linkFlowSession((session as any).id, this.agentSessionId);
    }

    this.allSessions.push(session);
    this.activeSessions.push(session);
    this.activeFlows.push(flow);

    if (this.sessionHooks) {
      Object.assign((session as any).hooks, this.sessionHooks);
    }

    const context = this.buildContext(session, input);
    const result = await flow.run({ deps: this.app, context: context as any, data: input });

    this.activeSessions = this.activeSessions.filter((s) => s !== session);
    this.activeFlows = this.activeFlows.filter((f) => f !== flow);

    // Route to next flow
    const wiring = this._resolvedSchema().flows[flowName];
    const branch = (result as any).branch ?? 'default';
    const next = this._resolveNext(wiring, branch);

    if (next === null) return result;
    return this._executeFrom(next, (result as any).data);
  }

  /**
   * Restore a previously interrupted agent from its persisted AgentSession and
   * all linked FlowSession records.
   *
   * - Reconstructs the agent with the saved agentSchema so multi-flow routing works.
   * - Sets agentSessionId so checkpointing continues against the existing record.
   * - If a FlowSession exists for currentFlowName and is running/paused, resumes it
   *   from its node checkpoint via resume().
   * - Otherwise restarts the checkpointed flow from scratch via runFrom().
   *
   * @param AgentClass   - concrete Agent subclass to instantiate
   * @param agentSession - persisted AgentSession record
   * @param flowSessions - all FlowSession records linked to this AgentSession
   * @param app          - app instance
   * @param user         - user instance
   */
  static restore<TApp, TUser, TSession>(
    AgentClass: new (
      app: TApp,
      user: TUser,
      parent?: TSession,
      schemaOverride?: AgentSchema,
    ) => Agent<TApp, TUser, TSession>,
    agentSession: AgentSessionData,
    flowSessions: SessionData[],
    app: TApp,
    user: TUser,
  ): { agent: Agent<TApp, TUser, TSession>; promise: Promise<unknown> } {
    if (!agentSession.currentFlowName) {
      throw new Error(`Agent.restore: AgentSession '${agentSession.id}' has no currentFlowName checkpoint`);
    }

    const agent = new AgentClass(app, user, undefined, agentSession.agentSchema as AgentSchema);
    agent.agentSessionId = agentSession.id;

    const currentFlowSession = flowSessions
      .filter((fs) => fs.flowName === agentSession.currentFlowName)
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
      .find((fs) => fs.status === 'running' || fs.status === 'paused');

    let promise: Promise<unknown>;

    if (currentFlowSession) {
      promise = agent.resume(agentSession.currentFlowName, currentFlowSession as unknown as TSession);
    } else {
      promise = agent.runFrom(agentSession.currentFlowName, agentSession.currentFlowInput);
    }

    return { agent, promise };
  }

  private _resolveNext(wiring: AgentFlowWiring, branch: string): string | null {
    if (wiring === null) return null;
    if (typeof wiring === 'string') return wiring;
    // branch-map: try exact branch, then 'default', then null (exit)
    if (branch in wiring) return wiring[branch];
    if ('default' in wiring) return wiring['default'];
    return null;
  }
}
