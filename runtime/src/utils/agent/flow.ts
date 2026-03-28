import { setTimeout as sleep } from 'node:timers/promises';
import { ensureError } from '../error.js';

// ============================================================
// NodeOptions
// ============================================================

export type NodeOptions = {
  /** Max execution attempts on error. Default: 1 */
  maxRunTries?: number;
  /** Milliseconds to wait between retries. Default: 0 */
  wait?: number;
  /** Milliseconds before run() is forced to abort (per attempt) */
  timeout?: number;
  /** Max times a node can be entered per flow run — infinite-loop guard */
  maxLoopEntering?: number;
  /**
   * External AbortSignal to link to this Flow's internal controller.
   * Aborting the external signal will abort the flow.
   * Only meaningful on Flow — ignored on plain Nodes.
   */
  signal?: AbortSignal;
};

// ============================================================
// Schema
// ============================================================

/**
 * Wiring descriptor for a single node inside a flow. Three forms:
 *
 * - `'NextNode'`                  — always advance to NextNode (sugar for `{ default: 'NextNode' }`)
 * - `{ branch: 'Target', ... }`  — route by branch name emitted from `run()`
 * - `null`                        — explicit terminal node; the flow exits when this node finishes
 */
export type NodeWiring =
  | string // shorthand: always go to this constructor name
  | Record<string, string> // branch name → target constructor name
  | null; // terminal — flow exits after this node

/**
 * Serializable, database-storable description of a flow graph.
 *
 * `nodes` is a flat map where:
 *   - each *key*   is a constructor name present in the flow's `nodeConstructors`
 *   - each *value* is a `NodeWiring` describing outgoing edges
 *
 * The entry-point node is identified by `startNode` (a constructor name).
 * `options` are applied to the Flow itself (retry, timeout, loop-guard).
 *
 * @example
 * ```ts
 * const schema: FlowSchema = {
 *   startNode: 'PrepareInput',
 *   nodes: {
 *     PrepareInput:  'DecideAction',
 *     DecideAction:  { ask_user: 'AskUser', tool_calls: 'ToolCalls', response: 'Response' },
 *     AskUser:       { pause: 'UserResponse' },
 *     UserResponse:  'DecideAction',
 *     ToolCalls:     'DecideAction',
 *     Response:      null,
 *   },
 * };
 * ```
 */
export type FlowSchema = {
  /** Constructor name of the first node to execute when the flow starts. */
  startNode: string;
  /**
   * Flat map of every node in the graph.
   * Key   = constructor name (must match an entry in `nodeConstructors`).
   * Value = outgoing branch wiring for that node.
   */
  nodes: Record<string, NodeWiring>;
  /** Options applied to the Flow node itself (retry, timeout, loop-guard). */
  options?: NodeOptions;
};

// ============================================================
// Packet types
// ============================================================

type PacketBase<TDeps, TContext> = {
  branch?: string;
  deps: TDeps;
  context: TContext;
  signal?: AbortSignal;
};

/**
 * A single-item packet. `data` is optional — omit when the node only
 * passes context/deps changes and carries no meaningful data.
 *
 * This is what `run()` always receives — the framework splits batch
 * packets before calling `run()`.
 */
export type SinglePacket<TData = unknown, TDeps = unknown, TContext = unknown> = PacketBase<TDeps, TContext> & {
  type?: 'single';
  data: TData;
};

/**
 * A batch packet carrying multiple items for parallel execution.
 * Return this from `preprocess` to switch the node into batch mode.
 * `run()` is called once per element via `Promise.allSettled`.
 */
export type BatchPacket<TData = unknown, TDeps = unknown, TContext = unknown> = PacketBase<TDeps, TContext> & {
  type: 'batch';
  data: TData[];
};

/**
 * Produced when a single execution fails.
 * Routed to `fallback` instead of `postprocess`.
 *
 * - `data` — the error that was thrown
 */
export type ErrorPacket<TData = unknown, TDeps = unknown, TContext = unknown> = PacketBase<TDeps, TContext> & {
  branch: 'error';
  data: TData;
};

/**
 * Produced when at least one item in a batch fails.
 * Routed to `fallback` instead of `postprocess`.
 *
 * - `data`   — successful results collected so far (may be empty)
 * - `error` — `AggregateError` wrapping all per-item failures
 */
export type BatchErrorPacket<TData = unknown, TDeps = unknown, TContext = unknown> = PacketBase<TDeps, TContext> & {
  type: 'batch';
  branch: 'error';
  data: TData[];
  error: AggregateError;
};

/** Any packet that can flow between nodes. */
export type Packet<TData = unknown, TDeps = unknown, TContext = unknown> =
  | SinglePacket<TData, TDeps, TContext>
  | BatchPacket<TData, TDeps, TContext>
  | ErrorPacket<TData, TDeps, TContext>
  | BatchErrorPacket<TData, TDeps, TContext>
  | PausePacket<TData, TDeps, TContext>;

/**
 * Permissive output packet union for branch-aware nodes.
 * For each branch in TBranches, accepts a SinglePacket with that branch's data type.
 * Also accepts void/no-data packets and batch packets.
 */
export type BranchPacket<TBranches extends Record<string, unknown>, TDeps = unknown, TContext = unknown> =
  | { [K in keyof TBranches]: SinglePacket<TBranches[K], TDeps, TContext> }[keyof TBranches]
  | SinglePacket<void, TDeps, TContext>
  | BatchPacket<TBranches[keyof TBranches], TDeps, TContext>;

/**
 * Produced when a node explicitly pauses the flow.
 * The flow suspends until `node.resume(packet)` or `flow.resume(packet)` is called.
 * The resume packet becomes the input to the node wired on the 'pause' branch.
 */
export type PausePacket<TData = unknown, TDeps = unknown, TContext = unknown> = PacketBase<TDeps, TContext> & {
  branch: 'pause';
  data: TData;
};

// ============================================================
// Packet helpers — all single-argument with named fields
// ============================================================

/**
 * Build a single-item packet. `data` is optional.
 *
 * @example
 *   return packet({ context: { ...p.context, session }, deps: p.deps });
 *   return packet({ data: result, branch: 'done', deps: p.deps, context: p.context });
 */
export const packet = <TData = undefined, TDeps = unknown, TContext = unknown>(opts: {
  data: TData;
  branch?: string;
  deps: TDeps;
  context: TContext;
}): SinglePacket<TData, TDeps, TContext> => ({ ...opts }) as SinglePacket<TData, TDeps, TContext>;

/**
 * Build a batch packet.
 *
 * @example
 *   return batch({ data: items, branch: 'process', deps: p.deps, context: p.context });
 */
export const batch = <TData, TDeps = unknown, TContext = unknown>(opts: {
  data: TData[];
  branch?: string;
  deps: TDeps;
  context: TContext;
}): BatchPacket<TData, TDeps, TContext> => ({ type: 'batch', ...opts });

/**
 * Terminate the containing Flow successfully. `data` is optional.
 *
 * @example
 *   return exit({ data: result, context: p.context });
 *   return exit();
 */
export const exit = <TData = undefined, TDeps = unknown, TContext = unknown>(opts: {
  data: TData;
  deps: TDeps;
  context: TContext;
}): SinglePacket<TData, TDeps, TContext> => ({ ...opts, branch: 'exit' });

/**
 * Terminate the containing Flow with an error. `data` is optional.
 *
 * @example
 *   return error({ data: new Error('bad'), context: p.context });
 *   return error();
 */
export const error = <TData = undefined, TDeps = unknown, TContext = unknown>(opts: {
  data: TData;
  deps: TDeps;
  context: TContext;
}): SinglePacket<TData, TDeps, TContext> => ({ ...opts, branch: 'error' });

/**
 * Pause the containing Flow. The flow suspends until `node.resume(packet)` or
 * `flow.resume(packet)` is called with a packet to pass to the next node.
 *
 * The next node is determined by the 'pause' branch wiring in the FlowSchema.
 *
 * @example
 *   return pause({ data: { waiting: true }, context: p.context, deps: p.deps });
 */
export const pause = <TData = undefined, TDeps = unknown, TContext = unknown>(opts: {
  data: TData;
  deps: TDeps;
  context: TContext;
}): PausePacket<TData, TDeps, TContext> => ({ ...opts, branch: 'pause' });

// ============================================================
// Node
// ============================================================

/**
 * Abstract base class for all pipeline nodes.
 *
 * Nodes are pure execution units — they have no knowledge of graph topology.
 * All routing is owned exclusively by the containing Flow via its FlowSchema.
 *
 * **Generic parameters** (write once on the class declaration):
 *   - `TDeps`     — external services / dependencies (injected, treated as immutable)
 *   - `TContext`  — mutable flow state that travels between nodes
 *   - `TInput`    — data type this node accepts
 *   - `TBranches` — map of `{ branchName: dataType }` describing per-branch output types
 *
 * **Phantom type aliases** — use in method signatures to avoid repeating generics:
 *   - `this['Deps']`         → `TDeps`
 *   - `this['Ctx']`          → `TContext`
 *   - `this['In']`           → `SinglePacket<TInput, TDeps, TContext>`
 *   - `this['InBatch']`      → `BatchPacket<TInput, TDeps, TContext>`
 *   - `this['InError']`      → `ErrorPacket<Error, TDeps, TContext>`
 *   - `this['InBatchError']` → `BatchErrorPacket<TInput, TDeps, TContext>`
 *   - `this['Out']`          → `BranchPacket<TBranches, TDeps, TContext>`
 *
 * @example
 * ```ts
 * export class MyNode extends Node<MyDeps, MyCtx, MyInput, { done: MyOutput; retry: void }> {
 *   async run(p: this['In']): Promise<this['Out']> {
 *     const result = await p.deps.myService.doWork(p.data);
 *     return packet({ data: result, branch: 'done', context: p.context, deps: p.deps });
 *   }
 * }
 * ```
 */
export abstract class Node<
  TDeps = unknown,
  TContext = unknown,
  TInput = unknown,
  TBranches extends Record<string, unknown> = Record<string, unknown>,
> {
  // ---- Phantom type aliases (zero runtime cost — never instantiate) ----
  declare readonly Deps: TDeps;
  declare readonly Ctx: TContext;
  declare readonly In: SinglePacket<TInput, TDeps, TContext>;
  declare readonly InBatch: BatchPacket<TInput, TDeps, TContext>;
  declare readonly InError: ErrorPacket<Error, TDeps, TContext>;
  declare readonly InBatchError: BatchErrorPacket<TInput, TDeps, TContext>;
  /** Permissive output — union of all branch data types, void, and batch. */
  declare readonly Out: BranchPacket<TBranches, TDeps, TContext>;

  readonly options: {
    readonly maxRunTries: number;
    readonly wait: number;
    readonly timeout?: number;
    readonly maxLoopEntering?: number;
  };

  /** @internal Callback for resuming a paused node (set by Flow) */
  private _resumeCallback: ((p: any) => void) | null = null;

  constructor(options: NodeOptions = {}) {
    this.options = {
      maxRunTries: options.maxRunTries ?? 1,
      wait: options.wait ?? 0,
      timeout: options.timeout,
      maxLoopEntering: options.maxLoopEntering,
    };
  }

  /**
   * Resume this node if it is currently paused (idempotent).
   * Calling when not paused is silently ignored.
   *
   * @example
   *   node.resume(packet({ data: response, context: p.context, deps: p.deps }));
   */
  resume(p: SinglePacket<any, TDeps, TContext> | BatchPacket<any, TDeps, TContext>): void {
    if (!this._resumeCallback) return;
    this._resumeCallback(p);
    this._resumeCallback = null;
  }

  /** @internal Called by Flow to subscribe to resume events. Never rejects. */
  _subscribeResume(callback: (p: any) => void): void {
    this._resumeCallback = callback;
  }

  // ---- Lifecycle methods (declare in subclass as needed) ---------------

  /**
   * Optional. Transform the incoming packet before `run()`.
   * Return a `BatchPacket` to switch into parallel batch execution.
   */
  preprocess?(
    packet: this['In'] | this['InBatch'] | SinglePacket<any, TDeps, TContext> | BatchPacket<any, TDeps, TContext>,
  ): Promise<SinglePacket<any, TDeps, TContext> | BatchPacket<any, TDeps, TContext>>;

  /** Required. Core logic. Always receives a single-item packet. */
  abstract run(
    packet: SinglePacket<any, TDeps, TContext> | this['In'],
  ): Promise<SinglePacket<any, TDeps, TContext> | BatchPacket<any, TDeps, TContext> | this['Out']>;

  /**
   * Optional. Receives the assembled result after all `run()` calls complete successfully.
   * Not called when batch has any failures — those go to `fallback`.
   */
  postprocess?(
    packet: SinglePacket<any, TDeps, TContext> | BatchPacket<any, TDeps, TContext>,
  ): Promise<this['Out'] | SinglePacket<any, TDeps, TContext> | BatchPacket<any, TDeps, TContext>>;

  /**
   * Optional. Called on error in single mode or any failure in batch mode.
   *
   * - Single error: `p` is `this['In']` and `this['InError']`, `err` is a plain `Error`
   * - Batch partial/full failure: `p` is `this['InBatchError']`, `err` is `AggregateError`
   */
  fallback?(
    packet: this['In'] | this['InError'] | this['InBatchError'],
    err: Error | AggregateError,
  ): Promise<this['Out']>;

  /**
   * Optional. Called when the flow aborts while this node is active.
   * Use for cleanup. Errors thrown here are swallowed.
   */
  onAbort?(packet: this['In'] | this['InBatch']): Promise<void>;

  // ---- Internal -------------------------------------------------------

  /** @internal Called by Flow during traversal. Never rejects. */
  async _exec(
    inPacket: SinglePacket<any, TDeps, TContext> | BatchPacket<any, TDeps, TContext>,
  ): Promise<SinglePacket<any, TDeps, TContext> | BatchPacket<any, TDeps, TContext>> {
    try {
      // 1. Preprocess — single/batch decision point
      const preprocessed = this.preprocess ? await this.preprocess(inPacket as any) : inPacket;

      // 2. Run
      let result: SinglePacket<any, TDeps, TContext> | BatchPacket<any, TDeps, TContext>;

      if (preprocessed.type === 'batch') {
        const settled = await Promise.allSettled(
          preprocessed.data.map((item: any) =>
            this._runWithRetry({
              data: item,
              deps: preprocessed.deps,
              context: preprocessed.context,
              signal: preprocessed.signal,
            }),
          ),
        );

        const successes: any[] = [];
        const failures: Error[] = [];
        for (const s of settled) {
          if (s.status === 'fulfilled') successes.push(s.value.data);
          else failures.push(ensureError(s.reason));
        }

        // If every failure is an AbortError, propagate as abort
        if (failures.length > 0 && failures.every((e) => e instanceof DOMException && e.name === 'AbortError')) {
          if (this.onAbort) await this.onAbort(inPacket as this['In'] | this['InBatch']).catch(() => {});
          return { branch: 'abort', deps: preprocessed.deps, context: preprocessed.context } as SinglePacket<
            any,
            TDeps,
            TContext
          >;
        }

        if (failures.length > 0) {
          const batchErr: BatchErrorPacket<any, TDeps, TContext> = {
            type: 'batch',
            branch: 'error',
            data: successes,
            error: new AggregateError(failures, `${failures.length} of ${settled.length} batch items failed`),
            deps: preprocessed.deps,
            context: preprocessed.context,
          };
          if (this.fallback) {
            return this.fallback(batchErr as this['InBatchError'], batchErr.error) as Promise<any>;
          }
          return {
            type: 'batch',
            data: successes,
            error: batchErr.error,
            branch: 'error',
            deps: preprocessed.deps,
            context: preprocessed.context,
          } as BatchErrorPacket<any, TDeps, TContext>;
        }

        result = {
          type: 'batch',
          data: successes,
          deps: preprocessed.deps,
          context: preprocessed.context,
        };
      } else {
        result = await this._runWithRetry(preprocessed as SinglePacket<any, TDeps, TContext>);
      }

      // 3. Postprocess (only reached on full success)
      if (this.postprocess) {
        return (await this.postprocess(result)) as
          | SinglePacket<any, TDeps, TContext>
          | BatchPacket<any, TDeps, TContext>;
      }
      return result;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        if (this.onAbort) await this.onAbort(inPacket as this['In'] | this['InBatch']).catch(() => {});
        return { branch: 'abort', deps: inPacket.deps, context: inPacket.context } as SinglePacket<
          any,
          TDeps,
          TContext
        >;
      }
      const safeErr = ensureError(err);
      if (this.fallback) return this.fallback(inPacket as this['In'], safeErr) as Promise<any>;
      return { data: safeErr, branch: 'error', deps: inPacket.deps, context: inPacket.context };
    }
  }

  private async _runWithRetry(p: SinglePacket<any, TDeps, TContext>): Promise<SinglePacket<any, TDeps, TContext>> {
    const { maxRunTries, wait, timeout } = this.options;
    let lastError!: Error;

    for (let attempt = 0; attempt < maxRunTries; attempt++) {
      if (p.signal?.aborted) throw new DOMException('Aborted', 'AbortError');

      try {
        const promise = this.run(p as this['In']);
        if (timeout === undefined) return (await promise) as any;

        const ac = new AbortController();
        const timer = sleep(timeout, { signal: ac.signal }).then<never>(() => {
          throw new Error(`Node.run timed out after ${timeout}ms`);
        });
        timer.catch((e) => {
          if (e.name === 'AbortError') return;
        });

        try {
          return (await Promise.race([promise, timer])) as any;
        } finally {
          ac.abort();
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') throw err;
        lastError = ensureError(err);
        if (attempt < maxRunTries - 1) {
          await sleep(wait);
          if (p.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        }
      }
    }

    throw lastError;
  }
}

// Minimal interface for the session checkpoint API — avoids a hard import cycle.
export interface FlowSessionRef {
  id: string;
  beginNodeTransaction(): Promise<void>;
  commitNodeTransaction(nodeName: string, packetData: unknown): Promise<void>;
  rollbackNodeTransaction(): Promise<void>;
}

// ============================================================
// Flow
// ============================================================

/** Saved state when a Flow is paused — enough to resume from the exact boundary */
export type FlowCheckpoint<TDeps = unknown, TContext = unknown> = {
  node: Node<TDeps, TContext, any, any>;
  packet: SinglePacket<any, TDeps, TContext> | BatchPacket<any, TDeps, TContext>;
};

/**
 * Abstract base class for all flow definitions.
 *
 * A concrete Flow subclass declares its `nodeConstructors` map and is instantiated
 * with a `FlowSchema` that describes the wiring. Nodes have no knowledge of graph
 * topology — the Flow owns all routing via the schema.
 *
 * Storing a `FlowSchema` in a database and passing it to `new MyFlow(schema)` is
 * sufficient to fully restore any flow at runtime.
 *
 * @example
 * ```ts
 * export class TaskSchedulerFlow extends Flow<App, TaskSchedulerContext> {
 *   nodeConstructors = { PrepareInput, DecideAction, AskUser, ToolCalls, Response, UserResponse };
 * }
 *
 * // Create from schema (schema can come from a database):
 * const flow = new TaskSchedulerFlow(schema);
 * ```
 *
 * **`toSchema()`** returns the FlowSchema this instance was constructed with.
 *
 * **Action methods:**
 *   - `flow.pause()`        — pause after current node finishes
 *   - `flow.resume(packet)` — resume, optionally replacing the checkpoint packet
 *   - `flow.exit(data?)`    — force-exit at next boundary
 *   - `flow.error(data?)`   — force-error at next boundary
 *   - `flow.abort()`        — immediate abort (also wakes paused flow)
 *
 */
export abstract class Flow<
  TDeps = unknown,
  TContext = unknown,
  TInput = unknown,
  TBranches extends Record<string, unknown> = Record<string, unknown>,
> extends Node<TDeps, TContext, TInput, TBranches> {
  /**
   * Map of constructor name → Node class for every node this flow can use.
   * Must be defined on the concrete subclass. The Flow instantiates nodes from
   * this map when building its routing table from the schema.
   *
   * @example
   * ```ts
   * nodeConstructors = { PrepareInput, DecideAction, AskUser, ToolCalls, Response, UserResponse };
   * ```
   */
  abstract nodeConstructors: Record<string, new (...args: any[]) => Node<any, any, any, any>>;

  /**
   * Optional schema property on the concrete subclass.
   * If defined, the constructor does not require a schema argument.
   *
   * @example
   * ```ts
   * schema: FlowSchema = { startNode: 'PrepareInput', nodes: { ... } };
   * ```
   */
  schema?: FlowSchema;

  // ── Self-description (required on every concrete subclass) ───────────────

  /** Human-readable name used to look up this flow. */
  get name(): string { return this.constructor.name; }
  /** Human-readable description of what this flow does. */
  abstract description: string;
  /** TypeBox schema used to validate input before the Agent calls run(). */
  abstract parameters: Record<string, unknown>;
  /**
   * Create the session for this flow run.
   * Called by Agent before flow.run() — receives app, user, parent, and the
   * validated input so it has everything needed to build the system prompt.
   */
  abstract createSession(app: TDeps, user: unknown, parent: unknown, input: unknown): Promise<FlowSessionRef>;

  // ── Session reference — set by Agent after createSession() ───────────────

  /**
   * The live session for this flow run. Set by Agent immediately after
   * createSession() returns. Used internally for node-level checkpointing.
   */
  session: FlowSessionRef | null = null;

  private _schema: FlowSchema | null = null;
  /** node name → Node instance, built lazily on first run */
  private _nodes!: Map<string, Node<TDeps, TContext, any, any>>;
  /** node name → (branch name → target node name) */
  private _wiring!: Map<string, Map<string, string>>;
  private _start!: Node<TDeps, TContext, TInput, any>;

  /** The running promise, set when run() is called. */
  runPromise: Promise<SinglePacket<any, TDeps, TContext> | BatchPacket<any, TDeps, TContext> | this['Out']> | null =
    null;

  private _controller = new AbortController();
  private _externalSignal: AbortSignal | undefined;
  private _pausePending = false;
  private _checkpoint: FlowCheckpoint<TDeps, TContext> | null = null;
  private _resumeResolve: ((p: SinglePacket<any, TDeps, TContext> | BatchPacket<any, TDeps, TContext>) => void) | null =
    null;
  private _exitPending = false;
  private _errorPending: { data: unknown } | null = null;

  constructor(schema?: FlowSchema, options?: NodeOptions) {
    // options resolved after schema is known; finalized in body below
    super({});
    // Schema may come from constructor arg or from a subclass class field.
    // Class fields are not yet assigned when super() runs, so we store the
    // constructor arg and resolve lazily in _ensureSchema().
    if (schema) this._schema = schema;
    const opts = options ?? schema?.options ?? {};
    (this as any).options = {
      maxRunTries: opts.maxRunTries ?? 1,
      wait: opts.wait ?? 0,
      timeout: opts.timeout,
      maxLoopEntering: opts.maxLoopEntering,
    };
    const sig = opts.signal;
    if (sig) {
      this._externalSignal = sig;
      if (sig.aborted) this._controller.abort();
      else sig.addEventListener('abort', () => this.abort(), { once: true });
    }
    // _buildRouting() is deferred to first run() because nodeConstructors is
    // a property on the subclass instance and not yet assigned when super() runs.
  }

  private _ensureSchema(): FlowSchema {
    if (this._schema) return this._schema;
    const s = (this as any).schema as FlowSchema | undefined;
    if (!s)
      throw new Error(
        `Flow "${this.constructor.name}" has no schema — define a schema property or pass one to the constructor`,
      );
    this._schema = s;
    return s;
  }

  /** Returns the FlowSchema this instance was constructed with. */
  toSchema(): FlowSchema {
    return this._ensureSchema();
  }

  // ---- Routing --------------------------------------------------------

  private _ensureRouting(): void {
    if (this._nodes) return;

    const { nodes, startNode } = this._ensureSchema();
    const ctors = this.nodeConstructors;

    this._nodes = new Map();
    this._wiring = new Map();

    for (const name of Object.keys(nodes)) {
      const Ctor = ctors[name];
      if (!Ctor) throw new Error(`Flow "${this.constructor.name}": no constructor for node "${name}"`);
      this._nodes.set(name, new Ctor());
      const wiring = nodes[name];
      const entries: [string, string][] =
        wiring === null ? [] : typeof wiring === 'string' ? [['default', wiring]] : Object.entries(wiring);
      this._wiring.set(name, new Map(entries));
    }

    const start = this._nodes.get(startNode);
    if (!start) throw new Error(`Flow "${this.constructor.name}": startNode "${startNode}" not found in nodes`);
    this._start = start as Node<TDeps, TContext, TInput, any>;
  }

  private _nextNode(currentName: string, branch: string): Node<TDeps, TContext, any, any> | undefined {
    const targetName = this._wiring.get(currentName)?.get(branch);
    return targetName ? this._nodes.get(targetName) : undefined;
  }

  private _nodeName(node: Node<any, any, any, any>): string {
    for (const [name, n] of this._nodes) {
      if (n === node) return name;
    }
    return node.constructor.name;
  }

  // ---- Action methods ------------------------------------------------

  abort(): void {
    this._controller.abort();
    this._wake();
  }

  private _rewireExternalSignal(): void {
    const sig = this._externalSignal;
    if (!sig) return;
    if (sig.aborted) {
      this._controller.abort();
    } else {
      sig.addEventListener('abort', () => this.abort(), { once: true });
    }
  }

  pause(): void {
    this._pausePending = true;
  }

  resume(p?: SinglePacket<any, TDeps, TContext> | BatchPacket<any, TDeps, TContext>): void {
    if (!this._resumeResolve) throw new Error('Flow is not paused');
    this._resumeResolve(p ?? this._checkpoint!.packet);
    this._resumeResolve = null;
  }

  exit(_data?: unknown): void {
    this._exitPending = true;
    this._wake();
  }

  error(data?: unknown): void {
    this._errorPending = { data };
    this._wake();
  }

  private _wake(): void {
    if (this._resumeResolve && this._checkpoint) {
      this._resumeResolve(this._checkpoint.packet);
      this._resumeResolve = null;
    }
  }

  // ---- Traversal helpers ---------------------------------------------

  private _checkLoopGuard(node: Node<TDeps, TContext, any, any>, enters: number): void {
    const { maxLoopEntering } = node.options;
    if (maxLoopEntering !== undefined && enters > maxLoopEntering) {
      throw new Error(`Node "${this._nodeName(node)}" exceeded maxLoopEntering of ${maxLoopEntering}`);
    }
    if (node === this._start && this.options.maxLoopEntering !== undefined && enters > this.options.maxLoopEntering) {
      throw new Error(`Flow "${this.constructor.name}" exceeded maxLoopEntering of ${this.options.maxLoopEntering}`);
    }
  }

  private async _suspendUntilResumed(
    checkpointPacket: SinglePacket<any, TDeps, TContext> | BatchPacket<any, TDeps, TContext>,
    nextNode: Node<TDeps, TContext, any, any>,
    pausingNode?: Node<TDeps, TContext, any, any>,
  ): Promise<SinglePacket<any, TDeps, TContext> | BatchPacket<any, TDeps, TContext>> {
    this._checkpoint = { node: nextNode, packet: checkpointPacket };

    const resumed = await new Promise<SinglePacket<any, TDeps, TContext> | BatchPacket<any, TDeps, TContext>>(
      (resolve) => {
        this._resumeResolve = resolve;
        if (pausingNode) pausingNode._subscribeResume(resolve);
      },
    );
    this._checkpoint = null;

    return resumed;
  }

  // ---- Traversal -----------------------------------------------------

  run(
    inPacket: SinglePacket<any, TDeps, TContext> | this['In'],
  ): Promise<SinglePacket<any, TDeps, TContext> | BatchPacket<any, TDeps, TContext> | this['Out']> {
    this._ensureRouting();
    this._controller = new AbortController();
    this._rewireExternalSignal();
    this.runPromise = this._traverse(this._start, inPacket);
    return this.runPromise;
  }

  /**
   * Start traversal from any named node in the schema, bypassing the start node.
   * Useful for resuming mid-graph or entering at a specific step.
   *
   * @param nodeName - constructor name of the node to start from (must exist in schema)
   * @param inPacket - input packet handed to that node
   *
   * @example
   *   flow.runFrom('DecideAction', packet({ data: resumeData, deps, context }));
   */
  runFrom(
    nodeName: string,
    inPacket: SinglePacket<any, TDeps, TContext> | BatchPacket<any, TDeps, TContext>,
  ): Promise<SinglePacket<any, TDeps, TContext> | BatchPacket<any, TDeps, TContext> | this['Out']> {
    this._ensureRouting();
    const node = this._nodes.get(nodeName);
    if (!node) {
      throw new Error(`Flow "${this.constructor.name}": no node named "${nodeName}" in schema`);
    }
    this._controller = new AbortController();
    this._rewireExternalSignal();
    this.runPromise = this._traverse(node, inPacket);
    return this.runPromise;
  }

  private async _traverse(
    startNode: Node<TDeps, TContext, any, any>,
    inPacket: SinglePacket<any, TDeps, TContext> | BatchPacket<any, TDeps, TContext>,
  ): Promise<SinglePacket<any, TDeps, TContext> | BatchPacket<any, TDeps, TContext> | this['Out']> {
    const { signal } = this._controller;
    const enterCount = new Map<Node, number>();
    let currentNode: Node<TDeps, TContext, any, any> = startNode;
    let currentPacket: SinglePacket<any, TDeps, TContext> | BatchPacket<any, TDeps, TContext> = { ...inPacket, signal };

    try {
      for (;;) {
        // ── Abort ─────────────────────────────────────────────────────
        if (signal.aborted) {
          if (currentNode.onAbort) await currentNode.onAbort(currentPacket).catch(() => {});
          return { branch: 'abort', deps: inPacket.deps, context: currentPacket.context } as this['Out'];
        }

        // ── Forced exit ───────────────────────────────────────────────
        if (this._exitPending) {
          this._exitPending = false;
          const exitPacket: SinglePacket<any, TDeps, TContext> = {
            branch: 'exit',
            deps: inPacket.deps,
            context: currentPacket.context,
            data: undefined,
          };
          return exitPacket;
        }

        // ── Forced error ──────────────────────────────────────────────
        const pendingError = this._errorPending;
        if (pendingError) {
          this._errorPending = null;
          const errData = ensureError(pendingError.data);
          const errPacket: ErrorPacket<Error, TDeps, TContext> = {
            data: errData,
            branch: 'error',
            deps: inPacket.deps,
            context: currentPacket.context,
          };
          const errorHandler = this._nextNode(this._nodeName(currentNode), 'error');
          if (errorHandler) {
            currentNode = errorHandler;
            currentPacket = { ...errPacket, signal };
            continue;
          }
          if (this.fallback) return this.fallback(inPacket as any, errData);
          return errPacket;
        }

        // ── Loop guards ───────────────────────────────────────────────
        const enters = (enterCount.get(currentNode) ?? 0) + 1;
        enterCount.set(currentNode, enters);
        this._checkLoopGuard(currentNode, enters);

        // ── Execute (wrapped in node transaction) ─────────────────────
        await this.session?.beginNodeTransaction();
        let result: SinglePacket<any, TDeps, TContext> | BatchPacket<any, TDeps, TContext>;
        result = await currentNode._exec(currentPacket);

        // ── Post-exec abort check ─────────────────────────────────────
        if (signal.aborted) {
          await this.session?.rollbackNodeTransaction();
          if (currentNode.onAbort) await currentNode.onAbort(currentPacket).catch(() => {});
          return { branch: 'abort', deps: inPacket.deps, context: currentPacket.context } as this['Out'];
        }

        // ── Branch routing ────────────────────────────────────────────
        if (result.branch === 'exit') {
          await this.session?.commitNodeTransaction('exit', result.data);
          return result;
        }

        if (result.branch === 'abort') {
          await this.session?.rollbackNodeTransaction();
          return result;
        }

        if (result.branch === 'error') {
          const errorHandler = this._nextNode(this._nodeName(currentNode), 'error');
          if (errorHandler) {
            await this.session?.commitNodeTransaction(this._nodeName(errorHandler), result.data);
            currentNode = errorHandler;
            currentPacket = { ...result, signal };
            continue;
          }
          await this.session?.rollbackNodeTransaction();
          const errVal = (result as SinglePacket<any>).data;
          if (this.fallback)
            return this.fallback(inPacket as any, errVal instanceof Error ? errVal : new Error(String(errVal)));
          return result;
        }

        // ── Pause (reserved branch) ────────────────────────────────────
        if (result.branch === 'pause') {
          const pauseHandler = this._nextNode(this._nodeName(currentNode), 'pause');
          if (!pauseHandler) {
            await this.session?.commitNodeTransaction('pause', result.data);
            return result;
          }
          // Checkpoint the pausing node (e.g. AskUser) with its own input data so
          // restore re-runs it — re-registers the listener and waits for user input.
          // Do NOT checkpoint pauseHandler (UserResponse) with undefined, which would
          // cause restore to run UserResponse with no user input.
          await this.session?.commitNodeTransaction(this._nodeName(currentNode), currentPacket.data);
          this._pausePending = false;
          const resumed = await this._suspendUntilResumed({ ...result, signal }, pauseHandler, currentNode);
          currentNode = pauseHandler;
          currentPacket = { ...resumed, signal };
          continue;
        }

        const nextNode = this._nextNode(this._nodeName(currentNode), result.branch ?? 'default');
        if (!nextNode) {
          // Terminal — no wired next node
          await this.session?.commitNodeTransaction(this._nodeName(currentNode), result.data);
          return result;
        }

        // Commit checkpoint: next node + result data so restore can runFrom(nextNode, data)
        await this.session?.commitNodeTransaction(this._nodeName(nextNode), result.data);

        // ── Pause ─────────────────────────────────────────────────────
        if (this._pausePending) {
          this._pausePending = false;
          const resumed = await this._suspendUntilResumed({ ...result, signal }, nextNode);
          currentNode = nextNode;
          currentPacket = { ...resumed, signal };
          continue;
        }

        // ── Advance ───────────────────────────────────────────────────
        currentNode = nextNode;
        currentPacket = { ...result, signal };
      }
    } catch (err) {
      await this.session?.rollbackNodeTransaction();
      const safeErr = ensureError(err);
      console.error(`[Flow._traverse] '${this.constructor.name}' unhandled error:`, safeErr);
      const errPacket = {
        data: safeErr,
        branch: 'error',
        deps: inPacket.deps,
        context: inPacket.context,
      } as ErrorPacket<Error, TDeps, TContext>;
      if (this.fallback) return this.fallback(errPacket, safeErr);
      return errPacket;
    }
  }
}
