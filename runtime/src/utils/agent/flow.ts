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
 * The next node is determined by `node.branch('pause', nextNode)` wiring.
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
 * **Generic parameters** (write once on the class declaration):
 *   - `TDeps`     — external services / dependencies (injected, treated as immutable)
 *   - `TContext`  — mutable flow state that travels between nodes
 *   - `TInput`    — data type this node accepts
 *   - `TBranches` — map of `{ branchName: dataType }` describing per-branch output types
 *
 * **Phantom type aliases** — use in method signatures to avoid repeating generics:
 *   - `this['Deps']`         → `TDeps` — use to compose custom packet types
 *   - `this['Ctx']`          → `TContext` — use to compose custom packet types
 *   - `this['In']`           → `SinglePacket<TInput, TDeps, TContext>`
 *   - `this['InBatch']`      → `BatchPacket<TInput, TDeps, TContext>`
 *   - `this['InError']`      → `ErrorPacket<Error, TDeps, TContext>`
 *   - `this['InBatchError']` → `BatchErrorPacket<TInput, TDeps, TContext>`
 *   - `this['Out']`          → `BranchPacket<TBranches, TDeps, TContext>` — permissive union of all branch types
 *
 * For intermediate types (preprocess output, run output when it differs from node output),
 * compose custom packet types using `this['Deps']` and `this['Ctx']`:
 *   `SinglePacket<MyRunOutput, this['Deps'], this['Ctx']>`
 *   `BatchPacket<MyRunOutput, this['Deps'], this['Ctx']>`
 *
 * @example
 * ```ts
 * export class MyNode extends Node<MyDeps, MyCtx, MyInput, { done: MyOutput; retry: void }> {
 *   async run(p: this['In']): Promise<this['Out']> {
 *     const result = await p.deps!.myService.doWork(p.data!);
 *     return packet({ data: result, branch: 'done', context: p.context, deps: p.deps });
 *   }
 *
 *   // Switch to batch mode in preprocess (custom intermediate type):
 *   async preprocess(p: this['In']): Promise<BatchPacket<PrepItem, this['Deps'], this['Ctx']>> {
 *     return batch({ data: p.data!.items, deps: p.deps, context: p.context });
 *   }
 *
 *   // Collapse batch results in postprocess (custom run output as input):
 *   async postprocess(p: BatchPacket<RunResult, this['Deps'], this['Ctx']>): Promise<this['Out']> {
 *     return packet({ data: p.data, branch: 'done', deps: p.deps, context: p.context });
 *   }
 *
 *   // Handle errors:
 *   async fallback(p: this['In'] | this['InError'] | this['InBatchError'], err: Error | AggregateError): Promise<this['Out']> {
 *     if (err instanceof AggregateError) {
 *       console.error('batch failures', err.error, 'successes', p.data);
 *     } else {
 *       console.error('error', err);
 *     }
 *     return exit({ context: p.context });
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
  /** Use to compose custom packet types: `SinglePacket<MyType, this['Deps'], this['Ctx']>` */
  declare readonly Deps: TDeps;
  /** Use to compose custom packet types: `SinglePacket<MyType, this['Deps'], this['Ctx']>` */
  declare readonly Ctx: TContext;

  declare readonly In: SinglePacket<TInput, TDeps, TContext>;
  declare readonly InBatch: BatchPacket<TInput, TDeps, TContext>;
  declare readonly InError: ErrorPacket<Error, TDeps, TContext>;
  declare readonly InBatchError: BatchErrorPacket<TInput, TDeps, TContext>;

  /** Permissive output — union of all branch data types, void, and batch. */
  declare readonly Out: BranchPacket<TBranches, TDeps, TContext>;

  /** Downstream nodes keyed by branch name */
  readonly branches = new Map<string, Node<TDeps, TContext, any, any>>();

  readonly options: {
    readonly maxRunTries: number;
    readonly wait: number;
    readonly timeout?: number;
    readonly maxLoopEntering?: number;
  };

  /** Stable name for this node — used for checkpointing */
  readonly nodeName: string;

  /** @internal Callback for resuming a paused node (set by Flow) */
  private _resumeCallback: ((p: any) => void) | null = null;

  constructor(nodeName: string, options?: NodeOptions);
  constructor(options?: NodeOptions);
  constructor(nodeNameOrOptions?: string | NodeOptions, options?: NodeOptions) {
    const name = typeof nodeNameOrOptions === 'string' ? nodeNameOrOptions : this.constructor.name;
    const opts = typeof nodeNameOrOptions === 'string' ? (options ?? {}) : (nodeNameOrOptions ?? {});
    this.nodeName = name;
    this.options = {
      maxRunTries: opts.maxRunTries ?? 1,
      wait: opts.wait ?? 0,
      timeout: opts.timeout,
      maxLoopEntering: opts.maxLoopEntering,
    };
  }

  /** Connect a named branch to a downstream node. Type-safe when branch name is in TBranches. */
  branch<K extends string & keyof TBranches>(name: K, node: Node<TDeps, TContext, TBranches[K], any>): this;
  branch(name: string, node: Node<TDeps, TContext, any, any>): this;
  branch(name: string, node: Node<TDeps, TContext, any, any>): this {
    this.branches.set(name, node);
    return this;
  }

  /** Shorthand: `branch('default', node)` */
  next(node: Node<TDeps, TContext, any, any>): this {
    return this.branch('default', node);
  }

  /**
   * Resume this node if it is currently paused (idempotent).
   * Calling when not paused is silently ignored.
   *
   * @example
   *   node.resume(packet({ data: response, context: p.context, deps: p.deps }));
   */
  resume(p: SinglePacket<any, TDeps, TContext> | BatchPacket<any, TDeps, TContext>): void {
    if (!this._resumeCallback) return; // silently ignore if not paused
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
   *
   * Override with specific types using `this['Deps']` and `this['Ctx']`:
   *   `async preprocess(p: this['In']): Promise<BatchPacket<MyType, this['Deps'], this['Ctx']>>`
   *
   * Return a `BatchPacket` to switch into parallel batch execution.
   * If omitted, the packet passes through unchanged.
   */
  preprocess?(
    packet: this['In'] | this['InBatch'] | SinglePacket<any, TDeps, TContext> | BatchPacket<any, TDeps, TContext>,
  ): Promise<SinglePacket<any, TDeps, TContext> | BatchPacket<any, TDeps, TContext>>;

  /**
   * Required. Core logic. Always receives a single-item packet.
   *
   * **Input type:** When `preprocess` is defined, the input type is whatever `preprocess` outputs.
   * Otherwise, it's `this['In']`. You can override the parameter type:
   *   `async run(p: SinglePacket<MyPreOutput, this['Deps'], this['Ctx']>): Promise<...>`
   *
   * **Return type:** When `postprocess` is defined, return intermediate data
   * (e.g., `SinglePacket<IntermediateType, this['Deps'], this['Ctx']>`).
   * Without postprocess, return `this['Out']` (branch-aware output).
   * You can override the return type to match your needs.
   */
  abstract run(
    packet: SinglePacket<any, TDeps, TContext> | this['In'],
  ): Promise<SinglePacket<any, TDeps, TContext> | BatchPacket<any, TDeps, TContext> | this['Out']>;

  /**
   * Optional. Receives the assembled result after all `run()` calls complete successfully.
   *
   * Override with the actual run output type:
   *   `async postprocess(p: BatchPacket<RunOut, this['Deps'], this['Ctx']>): Promise<this['Out']>`
   *
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
   *   — `p.data` holds all successful results, `p.error` wraps all individual failures
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
          // Any failure → BatchErrorPacket → fallback, postprocess skipped
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

// ============================================================
// Flow
// ============================================================

/** Saved state when a Flow is paused — enough to resume from the exact boundary */
export type FlowCheckpoint<TDeps = unknown, TContext = unknown> = {
  node: Node<TDeps, TContext, any, any>;
  packet: SinglePacket<any, TDeps, TContext> | BatchPacket<any, TDeps, TContext>;
};

/**
 * A Flow is fully Node-compatible — it extends Node and can be nested inside
 * another Flow. Batching, retries, and pre/postprocessing all work identically.
 *
 * `run()` traverses the internal graph and resolves only when:
 *   - A node returns `exit(...)` — or `flow.exit()` is called.
 *   - A node returns `error(...)` and no handler absorbs it — or `flow.error()`.
 *   - `flow.abort()` is called (or a linked external signal fires).
 *
 * While **paused**, `run()` stays pending. Call `flow.resume(packet?)` to continue.
 *
 * **Action methods:**
 *   - `flow.pause()`        — pause after current node finishes
 *   - `flow.resume(packet)` — resume, optionally replacing the checkpoint packet
 *   - `flow.exit(data?)`    — force-exit at next boundary
 *   - `flow.error(data?)`   — force-error at next boundary
 *   - `flow.abort()`        — immediate abort (also wakes paused flow)
 *
 * **Lifecycle hooks** (declare on your Flow subclass):
 *   - `onPause(packet)`  — flow paused
 *   - `onResume(packet)` — flow genuinely resumed (not wake from abort/exit/error)
 *   - `onExit(packet)`   — flow terminated successfully
 *   - `onError(packet)`  — flow terminated with unhandled error
 *   - `onAbort(packet)`  — flow aborted
 *
 * **Error chain for `'error'` branch:**
 *   1. Route to node connected to `'error'` branch (if present).
 *   2. Call `flow.fallback()` (if defined).
 *   3. Call `flow.onError()` hook and terminate.
 */
export class Flow<
  TDeps = unknown,
  TContext = unknown,
  TInput = unknown,
  TBranches extends Record<string, unknown> = Record<string, unknown>,
> extends Node<TDeps, TContext, TInput, TBranches> {
  private readonly _start: Node<TDeps, TContext, TInput, any>;
  private readonly _controller = new AbortController();

  private _pausePending = false;
  private _checkpoint: FlowCheckpoint<TDeps, TContext> | null = null;
  private _resumeResolve: ((p: SinglePacket<any, TDeps, TContext> | BatchPacket<any, TDeps, TContext>) => void) | null =
    null;

  private _exitPending = false;
  private _errorPending: { data: unknown } | null = null;

  constructor(start: Node<TDeps, TContext, TInput, any>, options?: NodeOptions) {
    super(options ?? {});
    this._start = start;
    if (options?.signal) {
      if (options.signal.aborted) this._controller.abort();
      else options.signal.addEventListener('abort', () => this.abort(), { once: true });
    }
  }

  // ---- Action methods ------------------------------------------------

  abort(): void {
    this._controller.abort();
    this._wake();
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

  // ---- Lifecycle hooks -----------------------------------------------

  onPause?(packet: SinglePacket<any, TDeps, TContext> | BatchPacket<any, TDeps, TContext>): Promise<void>;
  onResume?(packet: SinglePacket<any, TDeps, TContext> | BatchPacket<any, TDeps, TContext>): Promise<void>;
  onExit?(packet: SinglePacket<any, TDeps, TContext> | BatchPacket<any, TDeps, TContext>): Promise<void>;
  onError?(packet: SinglePacket<any, TDeps, TContext> | BatchPacket<any, TDeps, TContext>): Promise<void>;
  /** Called before each node executes. Errors are swallowed. */
  onBeforeNode?(nodeName: string, packet: SinglePacket<any, TDeps, TContext> | BatchPacket<any, TDeps, TContext>): Promise<void>;
  /** Called after each node executes successfully. Errors are swallowed. */
  onAfterNode?(nodeName: string, result: SinglePacket<any, TDeps, TContext> | BatchPacket<any, TDeps, TContext>): Promise<void>;

  // ---- Traversal helpers ---------------------------------------------

  private _checkLoopGuard(node: Node<TDeps, TContext, any, any>, enters: number): void {
    const { maxLoopEntering } = node.options;
    if (maxLoopEntering !== undefined && enters > maxLoopEntering) {
      throw new Error(`Node exceeded maxLoopEntering of ${maxLoopEntering} in this flow run`);
    }
    if (node === this._start && this.options.maxLoopEntering !== undefined && enters > this.options.maxLoopEntering) {
      throw new Error(
        `Flow exceeded maxLoopEntering of ${this.options.maxLoopEntering} (start node entered ${enters} times)`,
      );
    }
  }

  private async _suspendUntilResumed(
    checkpointPacket: SinglePacket<any, TDeps, TContext> | BatchPacket<any, TDeps, TContext>,
    nextNode: Node<TDeps, TContext, any, any>,
    pausingNode?: Node<TDeps, TContext, any, any>,
  ): Promise<SinglePacket<any, TDeps, TContext> | BatchPacket<any, TDeps, TContext>> {
    this._checkpoint = { node: nextNode, packet: checkpointPacket };
    if (this.onPause) await this.onPause(checkpointPacket).catch(() => {});

    const resumed = await new Promise<SinglePacket<any, TDeps, TContext> | BatchPacket<any, TDeps, TContext>>(
      (resolve) => {
        this._resumeResolve = resolve;
        // Subscribe the pausing node to the same resolve callback
        if (pausingNode) pausingNode._subscribeResume(resolve);
      },
    );
    this._checkpoint = null;

    const isGenuineResume = !this._controller.signal.aborted && !this._exitPending && !this._errorPending;
    if (isGenuineResume && this.onResume) await this.onResume(resumed).catch(() => {});

    return resumed;
  }

  // ---- Node lookup ---------------------------------------------------

  /**
   * Walk all reachable nodes recursively and return the one whose
   * `nodeName` matches. Used during flow restore.
   */
  getNodeByName(name: string): Node<TDeps, TContext, any, any> | undefined {
    const visited = new Set<Node>();
    const queue: Node<TDeps, TContext, any, any>[] = [this._start];
    while (queue.length > 0) {
      const node = queue.shift()!;
      if (visited.has(node)) continue;
      visited.add(node);
      if (node.nodeName === name) return node;
      for (const child of node.branches.values()) queue.push(child);
    }
    return undefined;
  }

  // ---- Traversal -----------------------------------------------------

  /**
   * Resume traversal from an arbitrary node with a given packet.
   * Same logic as `run()` but bypasses the start node.
   */
  async runFrom(
    startNode: Node<TDeps, TContext, any, any>,
    packet: SinglePacket<any, TDeps, TContext>,
  ): Promise<SinglePacket<any, TDeps, TContext> | BatchPacket<any, TDeps, TContext> | this['Out']> {
    const { signal } = this._controller;
    const enterCount = new Map<Node, number>();
    let currentNode: Node<TDeps, TContext, any, any> = startNode;
    let currentPacket: SinglePacket<any, TDeps, TContext> | BatchPacket<any, TDeps, TContext> = { ...packet, signal };

    try {
      for (;;) {
        if (signal.aborted) {
          if (currentNode.onAbort) await currentNode.onAbort(currentPacket).catch(() => {});
          if (this.onAbort) await this.onAbort(currentPacket).catch(() => {});
          return { branch: 'abort', deps: packet.deps, context: currentPacket.context } as this['Out'];
        }
        if (this._exitPending) {
          this._exitPending = false;
          const exitPacket: SinglePacket<any, TDeps, TContext> = { branch: 'exit', deps: packet.deps, context: currentPacket.context, data: undefined };
          if (this.onExit) await this.onExit(exitPacket).catch(() => {});
          return exitPacket;
        }
        const pendingError = this._errorPending;
        if (pendingError) {
          this._errorPending = null;
          const errData = ensureError(pendingError.data);
          const errPacket: ErrorPacket<Error, TDeps, TContext> = { data: errData, branch: 'error', deps: packet.deps, context: currentPacket.context };
          const errorHandler = currentNode.branches.get('error');
          if (errorHandler) { currentNode = errorHandler; currentPacket = { ...errPacket, signal }; continue; }
          if (this.onError) await this.onError(errPacket).catch(() => {});
          if (this.fallback) return this.fallback(packet as any, errData);
          return errPacket;
        }
        const enters = (enterCount.get(currentNode) ?? 0) + 1;
        enterCount.set(currentNode, enters);
        this._checkLoopGuard(currentNode, enters);

        if (this.onBeforeNode) await this.onBeforeNode(currentNode.nodeName, currentPacket).catch(() => {});
        const result = await currentNode._exec(currentPacket);
        if (this.onAfterNode) await this.onAfterNode(currentNode.nodeName, result).catch(() => {});

        if (result.branch === 'exit') { if (this.onExit) await this.onExit(result as SinglePacket<any, TDeps, TContext>).catch(() => {}); return result; }
        if (result.branch === 'abort') { if (this.onAbort) await this.onAbort(currentPacket as any).catch(() => {}); return result; }
        if (result.branch === 'error') {
          const errorHandler = currentNode.branches.get('error');
          if (errorHandler) { currentNode = errorHandler; currentPacket = { ...result, signal }; continue; }
          const errVal = (result as SinglePacket<any>).data;
          if (this.onError) await this.onError(result).catch(() => {});
          if (this.fallback) return this.fallback(packet as any, errVal instanceof Error ? errVal : new Error(String(errVal)));
          return result;
        }
        if (result.branch === 'pause') {
          const pauseHandler = currentNode.branches.get('pause');
          if (!pauseHandler) return result;
          this._pausePending = false;
          const resumed = await this._suspendUntilResumed({ ...result, signal }, pauseHandler, currentNode);
          currentNode = pauseHandler;
          currentPacket = { ...resumed, signal };
          continue;
        }
        const nextNode = currentNode.branches.get(result.branch ?? 'default');
        if (!nextNode) return result;
        if (this._pausePending) {
          this._pausePending = false;
          const resumed = await this._suspendUntilResumed({ ...result, signal }, nextNode);
          currentNode = nextNode;
          currentPacket = { ...resumed, signal };
          continue;
        }
        currentNode = nextNode;
        currentPacket = { ...result, signal };
      }
    } catch (err) {
      const safeErr = ensureError(err);
      const errPacket = { data: safeErr, branch: 'error', deps: packet.deps, context: packet.context } as ErrorPacket<Error, TDeps, TContext>;
      if (this.fallback) return this.fallback(errPacket, safeErr);
      if (this.onError) await this.onError(errPacket).catch(() => {});
      return errPacket;
    }
  }

  async run(
    inPacket: SinglePacket<any, TDeps, TContext> | this['In'],
  ): Promise<SinglePacket<any, TDeps, TContext> | BatchPacket<any, TDeps, TContext> | this['Out']> {
    return this.runFrom(this._start, inPacket as SinglePacket<any, TDeps, TContext>);
  }

}
