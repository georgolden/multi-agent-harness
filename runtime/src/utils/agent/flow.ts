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
// Packet — core input/output contract between all nodes and flows
//
// Naming alternatives to consider: Signal, Frame, Envelope, Token
//
// "Packet" was chosen: neutral, pipeline-idiomatic, clearly carries
// data + metadata, and makes the dataflow mental model obvious.
// ============================================================

/**
 * The single type that flows between every node and flow.
 *
 * - `type` is optional — absent or `'single'` means one item.
 *   Set `type: 'batch'` to carry an array; the framework will call
 *   `run()` in parallel for each element automatically.
 *
 * - `branch` drives routing. Reserved values:
 *     `'exit'`  — normal flow termination (resolves the Flow's promise)
 *     `'error'` — error termination (triggers fallback chain if present)
 *     `'abort'` — abort termination (propagates up through nested flows)
 *     `'pause'` — internal; do not set manually
 *
 * - `deps` and `context` travel with the data so every node receives
 *   full state. Return updated `context` from `run()` to mutate flow
 *   state. `deps` are treated as immutable external services but are
 *   included for consistency.
 *
 * - `signal` is injected by Flow and available in `run()` so you can
 *   wire it into fetch / API calls for true in-flight cancellation.
 *   The framework only passes it through — never set it yourself.
 *
 * In batch mode the context from individual parallel `run()` calls is
 * NOT merged back — parallel runs are context-isolated. Update context
 * in `postprocess` after collecting all batch results.
 */
export type Packet<TData = unknown, TDeps = unknown, TContext = unknown> =
  | { data: TData; type?: 'single'; branch?: string; deps?: TDeps; context?: TContext; signal?: AbortSignal }
  | { data: TData[]; type: 'batch'; branch?: string; deps?: TDeps; context?: TContext; signal?: AbortSignal };

// ---- Helpers ------------------------------------------------

export const single = <T, D = unknown, C = unknown>(
  data: T,
  opts?: { branch?: string; deps?: D; context?: C },
): Packet<T, D, C> => ({ data, ...opts });

export const batch = <T, D = unknown, C = unknown>(
  data: T[],
  opts?: { branch?: string; deps?: D; context?: C },
): Packet<T, D, C> => ({ type: 'batch', data, ...opts });

/** Terminate the containing Flow successfully */
export const exit = <T, D = unknown, C = unknown>(data: T, opts?: { deps?: D; context?: C }): Packet<T, D, C> => ({
  data,
  branch: 'exit',
  ...opts,
});

/** Terminate the containing Flow with an error */
export const error = <T, D = unknown, C = unknown>(data: T, opts?: { deps?: D; context?: C }): Packet<T, D, C> => ({
  data,
  branch: 'error',
  ...opts,
});

// ============================================================
// Node
// ============================================================

export abstract class Node<TDeps = unknown, TContext = unknown, TInput = unknown, TOutput = unknown> {
  /** Downstream nodes keyed by branch name */
  readonly branches = new Map<string, Node<TDeps, TContext, TOutput, any>>();

  readonly options: {
    readonly maxRunTries: number;
    readonly wait: number;
    readonly timeout?: number;
    readonly maxLoopEntering?: number;
  };

  constructor(options: NodeOptions = {}) {
    this.options = {
      maxRunTries: options.maxRunTries ?? 1,
      wait: options.wait ?? 0,
      timeout: options.timeout,
      maxLoopEntering: options.maxLoopEntering,
    };
  }

  /** Connect a named branch to a downstream node */
  branch(name: string, node: Node<TDeps, TContext, TOutput, any>): this {
    this.branches.set(name, node);
    return this;
  }

  /** Shorthand: `branch('default', node)` */
  next(node: Node<TDeps, TContext, TOutput, any>): this {
    return this.branch('default', node);
  }

  /**
   * Optional preprocessing.
   *
   * Transform the incoming packet before `run()`. Set `type: 'batch'` on
   * the returned packet to switch into parallel batch mode — `run()` will
   * be invoked once per element in `data`, then results are reassembled.
   *
   * If omitted, the packet passes through unchanged (an upstream batch
   * result automatically propagates batch mode into this node).
   */
  preprocess?(packet: Packet<TInput, TDeps, TContext>): Promise<Packet<TInput, TDeps, TContext>>;

  /**
   * Required. Core logic.
   *
   * Always receives a **single-item** packet — the framework handles
   * batch splitting/reassembly automatically.
   *
   * Return a packet with updated `data`, optional `context` changes,
   * and an optional `branch` for routing. Routing can also be done in
   * `postprocess` if you prefer the separation.
   *
   * `packet.signal` is available when the containing Flow has one.
   * Pass it to fetch / API calls for true in-flight cancellation:
   *   `await fetch(url, { signal: packet.signal })`
   */
  abstract run(packet: Packet<TInput, TDeps, TContext>): Promise<Packet<TOutput, TDeps, TContext>>;

  /**
   * Optional postprocessing.
   *
   * Receives the assembled result packet. In batch mode, `data` is
   * `TOutput[]`. Add or override `branch` here to route to the next node.
   *
   * If omitted, the `branch` from `run()`'s packet is used directly.
   */
  postprocess?(packet: Packet<TOutput, TDeps, TContext>): Promise<Packet<TOutput, TDeps, TContext>>;

  /**
   * Optional error handler for when all `run()` retries are exhausted or
   * any pipeline step throws. Must return a packet with `'exit'` or
   * `'error'` branch to avoid leaving the flow in an undefined state.
   *
   * If omitted, errors are automatically converted to an `error(err)`
   * packet — `_exec` never rejects (neverthrow).
   */
  fallback?(packet: Packet<TInput, TDeps, TContext>, err: Error): Promise<Packet<TOutput, TDeps, TContext>>;

  /**
   * Optional abort hook — called when the flow's abort signal fires
   * while this node is the active node, or when the node itself is
   * aborted mid-retry.
   *
   * Use this for cleanup: cancel pending work, flush buffers, log state.
   * Errors thrown here are swallowed so they don't mask the abort.
   */
  onAbort?(packet: Packet<TInput, TDeps, TContext>): Promise<void>;

  // ----------------------------------------------------------
  // Internal — called by Flow during traversal. Never rejects.
  // Flow.preprocess / Flow.postprocess are invoked here too since
  // Flow extends Node and _exec is inherited.
  // ----------------------------------------------------------

  /** @internal */
  async _exec(packet: Packet<TInput, TDeps, TContext>): Promise<Packet<TOutput, TDeps, TContext>> {
    try {
      // 1. Preprocess — batch/single decision point
      const preprocessed: Packet<TInput, TDeps, TContext> = this.preprocess ? await this.preprocess(packet) : packet;

      // 2. Run
      let result: Packet<TOutput, TDeps, TContext>;

      if (preprocessed.type === 'batch') {
        // Parallel batch — context changes from individual runs are isolated
        const results = await Promise.all(
          preprocessed.data.map((item) =>
            this._runWithRetry({
              data: item,
              deps: preprocessed.deps,
              context: preprocessed.context,
              signal: preprocessed.signal,
            }),
          ),
        );
        result = {
          type: 'batch',
          data: results.map((r) => r.data as TOutput),
          deps: preprocessed.deps,
          context: preprocessed.context,
        };
      } else {
        result = await this._runWithRetry(preprocessed);
      }

      // 3. Postprocess
      return this.postprocess ? await this.postprocess(result) : result;
    } catch (err) {
      // AbortError: call onAbort hook and return abort packet (never rejects)
      if (err instanceof DOMException && err.name === 'AbortError') {
        if (this.onAbort) await this.onAbort(packet).catch(() => {});
        return { data: err as unknown as TOutput, branch: 'abort', deps: packet.deps, context: packet.context };
      }
      const safeErr = ensureError(err);
      if (this.fallback) return this.fallback(packet, safeErr);
      return { data: safeErr as unknown as TOutput, branch: 'error', deps: packet.deps, context: packet.context };
    }
  }

  private async _runWithRetry(packet: Packet<TInput, TDeps, TContext>): Promise<Packet<TOutput, TDeps, TContext>> {
    const { maxRunTries, wait, timeout } = this.options;
    let lastError!: Error;

    for (let attempt = 0; attempt < maxRunTries; attempt++) {
      // Check abort before each attempt
      if (packet.signal?.aborted) throw new DOMException('Aborted', 'AbortError');

      try {
        const p = this.run(packet);
        if (timeout === undefined) return await p;

        const ac = new AbortController();
        const timer = sleep(timeout, { signal: ac.signal }).then<never>(() => {
          throw new Error(`Node.run timed out after ${timeout}ms`);
        });
        timer.catch((err) => {
          if (err.name === 'AbortError') return;
        });

        try {
          return await Promise.race([p, timer]);
        } finally {
          ac.abort();
        }
      } catch (err) {
        // Abort errors propagate immediately — no retry
        if (err instanceof DOMException && err.name === 'AbortError') throw err;
        lastError = ensureError(err);
        if (attempt < maxRunTries - 1) {
          await sleep(wait);
          // Check abort after sleep too — no point retrying into an aborted flow
          if (packet.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        }
      }
    }

    // Propagates to _exec's catch → fallback or error packet
    throw lastError;
  }
}

// ============================================================
// Flow
// ============================================================

/** Saved state when a Flow is paused — enough to resume from the exact boundary */
export type FlowCheckpoint<TDeps = unknown, TContext = unknown> = {
  node: Node<TDeps, TContext, any, any>;
  packet: Packet<any, TDeps, TContext>;
};

/**
 * A Flow is fully Node-compatible: it extends Node, so it carries
 * `preprocess`, `_exec`, `postprocess`, and `fallback`. A Flow can be
 * dropped into another Flow as any other node — batching, retries, and
 * pre/postprocessing all work identically.
 *
 * `run()` traverses the internal graph and resolves **only** when:
 *   - A node returns `exit(data)` — or `flow.exit()` is called.
 *   - A node returns `error(data)` and no handler absorbs it — or `flow.error()`.
 *   - `flow.abort()` is called (or a linked external signal fires).
 *
 * While **paused**, `run()` stays pending — it does NOT resolve. The flow
 * is suspended at a node boundary. Call `flow.resume(packet?)` to continue.
 * This is the intended pattern for human-in-the-loop agents.
 *
 * ---
 *
 * **Action methods** (callable from any code that holds a flow reference):
 *   - `flow.pause()`        — pause after current node finishes
 *   - `flow.resume(packet)` — resume from checkpoint, optionally replacing the packet
 *   - `flow.exit(data?)`    — force-exit at next boundary
 *   - `flow.error(data?)`   — force-error at next boundary
 *   - `flow.abort()`        — immediate abort (also wakes paused flow)
 *
 * **Lifecycle hooks** (declare on your Flow subclass):
 *   - `onPause(packet)`  — flow paused; emit your event / set up listener here
 *   - `onResume(packet)` — flow resumed; packet is what was passed to resume()
 *   - `onExit(packet)`   — flow terminated successfully
 *   - `onError(packet)`  — flow terminated with unhandled error
 *   - `onAbort(packet)`  — flow aborted (inherited from Node, called on this flow too)
 *
 * ---
 *
 * **Pause boundary guarantee**: pause always happens at a node boundary
 * (after `_exec` completes, before the next node starts). preprocess / run /
 * postprocess are atomic — they finish before the pause takes effect. If you
 * need a pause mid-node, split it into two nodes.
 *
 * ---
 *
 * Error handling chain for `'error'` branch:
 *   1. Route to a node connected to the `'error'` branch (if present).
 *   2. Call `flow.fallback()` (if defined).
 *   3. Call `flow.onError()` hook and terminate.
 *
 * Context travels through packets — each node can return updated context
 * and the next node in the chain will see it automatically.
 */
export class Flow<TDeps = unknown, TContext = unknown, TInput = unknown, TOutput = unknown> extends Node<
  TDeps,
  TContext,
  TInput,
  TOutput
> {
  private readonly _start: Node<TDeps, TContext, TInput, any>;
  private readonly _controller = new AbortController();

  // ---- Pause / resume state ----
  private _pausePending = false;
  private _checkpoint: FlowCheckpoint<TDeps, TContext> | null = null;
  private _resumeResolve: ((p: Packet<any, TDeps, TContext>) => void) | null = null;

  // ---- Forced terminal signals ----
  private _exitPending = false;
  private _errorPending: { data: unknown } | null = null;

  constructor(start: Node<TDeps, TContext, TInput, any>, options?: NodeOptions) {
    super(options);
    this._start = start;
    if (options?.signal) {
      if (options.signal.aborted) this._controller.abort();
      else options.signal.addEventListener('abort', () => this.abort(), { once: true });
    }
  }

  // ---- Action methods ------------------------------------------------

  /**
   * Abort the flow immediately. The `run()` promise resolves with
   * `branch: 'abort'`. Also wakes a paused flow so it can abort.
   *
   * Note: in-flight `run()` calls are NOT cancelled — see `packet.signal`
   * for true in-flight cancellation.
   */
  abort(): void {
    this._controller.abort();
    this._wake();
  }

  /**
   * Request a pause after the current node finishes executing.
   *
   * - `run()` stays pending (does not resolve) until `resume()` is called.
   * - `onPause` hook fires with the checkpoint packet.
   * - Calling `pause()` while already paused is a no-op; the pending flag
   *   will cause another pause after the next `resume()` triggers a node.
   */
  pause(): void {
    this._pausePending = true;
  }

  /**
   * Resume a paused flow.
   *
   * @param packet  Optional replacement packet for the checkpoint.
   *                Omit to continue with the exact packet that was saved.
   *                Pass a new packet to inject updated data (e.g., human reply).
   *
   * Throws if the flow is not currently paused.
   */
  resume(packet?: Packet<any, TDeps, TContext>): void {
    if (!this._resumeResolve) throw new Error('Flow is not paused');
    this._resumeResolve(packet ?? this._checkpoint!.packet);
    this._resumeResolve = null;
  }

  /**
   * Force-exit the flow at the next node boundary.
   * `run()` resolves with `branch: 'exit'`. Also wakes a paused flow.
   */
  exit(_data?: unknown): void {
    this._exitPending = true;
    this._wake();
  }

  /**
   * Force-error the flow at the next node boundary.
   * Goes through the normal error chain (error-branch node → fallback → onError).
   * Also wakes a paused flow.
   */
  error(data?: unknown): void {
    this._errorPending = { data };
    this._wake();
  }

  /** Wakes a paused flow so abort/exit/error can take effect */
  private _wake(): void {
    if (this._resumeResolve && this._checkpoint) {
      this._resumeResolve(this._checkpoint.packet);
      this._resumeResolve = null;
    }
  }

  // ---- Lifecycle hooks -----------------------------------------------

  /**
   * Called when the flow pauses (after the current node finishes).
   * `packet` is the checkpoint packet — what will be fed to the next node on resume.
   * Use this to emit events, store state, or register reply listeners.
   */
  onPause?(packet: Packet<any, TDeps, TContext>): Promise<void>;

  /**
   * Called when the flow resumes.
   * `packet` is exactly what was passed to `resume()` (or the saved checkpoint).
   */
  onResume?(packet: Packet<any, TDeps, TContext>): Promise<void>;

  /**
   * Called when the flow terminates successfully (`branch: 'exit'`).
   * Fired for both node-driven exits and `flow.exit()` action calls.
   */
  onExit?(packet: Packet<TOutput, TDeps, TContext>): Promise<void>;

  /**
   * Called when the flow terminates with an unhandled error (`branch: 'error'`
   * after the full error chain is exhausted). Also fired for `flow.error()`.
   */
  onError?(packet: Packet<TOutput, TDeps, TContext>): Promise<void>;

  // ---- Traversal helpers ---------------------------------------------

  /** Calls onError hook and returns the terminal error packet. */
  private async _handleTerminalError(
    errPacket: Packet<TOutput, TDeps, TContext>,
  ): Promise<Packet<TOutput, TDeps, TContext>> {
    if (this.onError) await this.onError(errPacket).catch(() => {});
    return errPacket;
  }

  /** Throws if the node or flow-level loop limit is exceeded. */
  private _checkLoopGuard(node: Node<TDeps, TContext, any, any>, enters: number): void {
    const { maxLoopEntering } = node.options;
    if (maxLoopEntering !== undefined && enters > maxLoopEntering) {
      throw new Error(`Node exceeded maxLoopEntering of ${maxLoopEntering} in this flow run`);
    }
    if (
      node === this._start &&
      this.options.maxLoopEntering !== undefined &&
      enters > this.options.maxLoopEntering
    ) {
      throw new Error(
        `Flow exceeded maxLoopEntering of ${this.options.maxLoopEntering} (start node entered ${enters} times)`,
      );
    }
  }

  /**
   * Suspends the traversal loop until resume() / abort() / exit() / error() wakes it.
   * Calls onPause before suspending and onResume after a genuine resume.
   * Returns the packet to continue with (what was passed to resume(), or the checkpoint).
   */
  private async _suspendUntilResumed(
    checkpointPacket: Packet<any, TDeps, TContext>,
    nextNode: Node<TDeps, TContext, any, any>,
  ): Promise<Packet<any, TDeps, TContext>> {
    this._checkpoint = { node: nextNode, packet: checkpointPacket };
    if (this.onPause) await this.onPause(checkpointPacket).catch(() => {});

    const resumedPacket = await new Promise<Packet<any, TDeps, TContext>>((resolve) => {
      this._resumeResolve = resolve;
    });
    this._checkpoint = null;

    // Only call onResume for genuine resumes — abort/exit/error wakeups are handled
    // at the top of the main loop after continue
    const isGenuineResume =
      !this._controller.signal.aborted && !this._exitPending && !this._errorPending;
    if (isGenuineResume && this.onResume) await this.onResume(resumedPacket).catch(() => {});

    return resumedPacket;
  }

  // ---- Traversal -----------------------------------------------------

  async run(packet: Packet<TInput, TDeps, TContext>): Promise<Packet<TOutput, TDeps, TContext>> {
    const { signal } = this._controller;
    const enterCount = new Map<Node, number>();
    let currentNode: Node<TDeps, TContext, any, any> = this._start;
    let currentPacket: Packet<any, TDeps, TContext> = { ...packet, signal };

    try {
      for (;;) {
        // ── Abort ─────────────────────────────────────────────────────
        if (signal.aborted) {
          if (currentNode.onAbort) await currentNode.onAbort(currentPacket).catch(() => {});
          if (this.onAbort) await this.onAbort(currentPacket).catch(() => {});
          return { data: undefined as unknown as TOutput, branch: 'abort', deps: packet.deps, context: currentPacket.context };
        }

        // ── Forced exit ───────────────────────────────────────────────
        if (this._exitPending) {
          this._exitPending = false;
          const exitPacket: Packet<TOutput, TDeps, TContext> = { data: undefined as unknown as TOutput, branch: 'exit', deps: packet.deps, context: currentPacket.context };
          if (this.onExit) await this.onExit(exitPacket).catch(() => {});
          return exitPacket;
        }

        // ── Forced error ──────────────────────────────────────────────
        const pendingError = this._errorPending;
        if (pendingError) {
          const errorData: unknown = pendingError.data;
          this._errorPending = null;
          const errPacket: Packet<TOutput, TDeps, TContext> = { data: errorData as TOutput, branch: 'error', deps: packet.deps, context: currentPacket.context };
          const errorHandler = currentNode.branches.get('error');
          if (errorHandler) { currentNode = errorHandler; currentPacket = { ...errPacket, signal }; continue; }
          if (this.fallback) return this.fallback(packet, errorData instanceof Error ? errorData : new Error(String(errorData)));
          return await this._handleTerminalError(errPacket);
        }

        // ── Loop guards ───────────────────────────────────────────────
        const enters = (enterCount.get(currentNode) ?? 0) + 1;
        enterCount.set(currentNode, enters);
        this._checkLoopGuard(currentNode, enters);

        // ── Execute ───────────────────────────────────────────────────
        const result = await currentNode._exec(currentPacket);

        // ── Branch routing ────────────────────────────────────────────
        if (result.branch === 'exit') {
          const exitPacket = result as Packet<TOutput, TDeps, TContext>;
          if (this.onExit) await this.onExit(exitPacket).catch(() => {});
          return exitPacket;
        }

        if (result.branch === 'abort') {
          if (this.onAbort) await this.onAbort(currentPacket).catch(() => {});
          return result as Packet<TOutput, TDeps, TContext>;
        }

        if (result.branch === 'error') {
          const errorHandler = currentNode.branches.get('error');
          if (errorHandler) { currentNode = errorHandler; currentPacket = { ...result, signal }; continue; }
          if (this.fallback) return this.fallback(packet, result.data instanceof Error ? (result.data as Error) : new Error(String(result.data)));
          return await this._handleTerminalError(result as Packet<TOutput, TDeps, TContext>);
        }

        const nextNode = currentNode.branches.get(result.branch ?? 'default');
        if (!nextNode) return result as Packet<TOutput, TDeps, TContext>;

        // ── Pause ─────────────────────────────────────────────────────
        if (this._pausePending) {
          this._pausePending = false;
          const resumedPacket = await this._suspendUntilResumed({ ...result, signal }, nextNode);
          // After resume, loop back to top — abort/exit/error checks fire naturally
          currentNode = nextNode;
          currentPacket = { ...resumedPacket, signal };
          continue;
        }

        // ── Advance ───────────────────────────────────────────────────
        currentNode = nextNode;
        currentPacket = { ...result, signal };
      }
    } catch (err) {
      const safeErr = ensureError(err);
      if (this.fallback) return this.fallback(packet, safeErr);
      return await this._handleTerminalError({ data: safeErr as unknown as TOutput, branch: 'error', deps: packet.deps, context: packet.context });
    }
  }
}
