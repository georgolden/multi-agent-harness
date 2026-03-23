import { describe, it, expect, vi } from 'vitest';
import {
  packet,
  batch,
  exit,
  error,
  pause,
  Node,
  Flow,
  type SinglePacket,
  type BatchPacket,
  type NodeOptions,
} from './flow.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeNode(
  runFn: (p: SinglePacket<any, any, any>) => Promise<SinglePacket<any, any, any>>,
  opts?: {
    preprocess?: (
      p: SinglePacket<any, any, any> | BatchPacket<any, any, any>,
    ) => Promise<SinglePacket<any, any, any> | BatchPacket<any, any, any>>;
    postprocess?: (
      p: SinglePacket<any, any, any> | BatchPacket<any, any, any>,
    ) => Promise<SinglePacket<any, any, any> | BatchPacket<any, any, any>>;
    fallback?: (
      p: SinglePacket<any, any, any> | BatchPacket<any, any, any>,
      err: Error | AggregateError,
    ) => Promise<SinglePacket<any, any, any>>;
    onAbort?: (p: SinglePacket<any, any, any> | BatchPacket<any, any, any>) => Promise<void>;
    nodeOptions?: NodeOptions;
  },
) {
  class TestNode extends Node<any, any, any, any> {
    preprocess = opts?.preprocess;
    postprocess = opts?.postprocess;
    fallback = opts?.fallback;
    onAbort = opts?.onAbort;
    async run(p: this['In']) {
      return runFn(p);
    }
  }
  return new TestNode(opts?.nodeOptions);
}

function makeFlow(
  start: Node<any, any, any, any>,
  hooks?: {
    onPause?: (p: SinglePacket<any> | BatchPacket<any>) => Promise<void>;
    onResume?: (p: SinglePacket<any> | BatchPacket<any>) => Promise<void>;
    onExit?: (p: SinglePacket<any>) => Promise<void>;
    onError?: (p: SinglePacket<any>) => Promise<void>;
    onAbort?: (p: SinglePacket<any> | BatchPacket<any>) => Promise<void>;
    fallback?: (p: SinglePacket<any> | BatchPacket<any>, err: Error | AggregateError) => Promise<SinglePacket<any>>;
    onBeforeNode?: (nodeName: string, p: SinglePacket<any> | BatchPacket<any>) => Promise<void>;
    onAfterNode?: (nodeName: string, result: SinglePacket<any> | BatchPacket<any>) => Promise<void>;
  },
  options?: NodeOptions,
) {
  class TestFlow extends Flow<any, any, any, any> {
    onPause = hooks?.onPause;
    onResume = hooks?.onResume;
    onExit = hooks?.onExit;
    onError = hooks?.onError;
    onAbort = hooks?.onAbort;
    fallback = hooks?.fallback;
    onBeforeNode = hooks?.onBeforeNode;
    onAfterNode = hooks?.onAfterNode;
  }
  return new TestFlow(start, options);
}

// ─── 1. Packet helpers ───────────────────────────────────────────────────────

describe('packet helpers', () => {
  it('packet() creates a packet with required data, deps, context', () => {
    const deps = { db: 'mock' };
    const ctx = { n: 1 };
    const p = packet({ data: 'hi', deps, context: ctx });
    expect(p).toMatchObject({ data: 'hi', deps, context: ctx });
  });

  it('packet() with all fields including branch', () => {
    const deps = { db: 'mock' };
    const ctx = { n: 1 };
    const p = packet({ data: 'hi', branch: 'go', deps, context: ctx });
    expect(p).toMatchObject({ data: 'hi', branch: 'go', deps, context: ctx });
  });

  it('batch() creates a packet with type: batch', () => {
    const p = batch({
      data: [1, 2, 3],
      deps: undefined,
      context: undefined,
    });
    expect(p).toEqual({ type: 'batch', data: [1, 2, 3] });
  });

  it('batch() passes branch, deps, context', () => {
    const p = batch({ data: [1, 2], branch: 'x', deps: { a: 1 }, context: { b: 2 } });
    expect(p).toMatchObject({ type: 'batch', data: [1, 2], branch: 'x' });
  });

  it('exit() sets branch: exit with required deps, context', () => {
    const p = exit({ data: 'done', deps: {}, context: { n: 99 } });
    expect(p).toMatchObject({ data: 'done', branch: 'exit', context: { n: 99 } });
  });

  it('exit() with undefined data', () => {
    const p = exit({ data: undefined, deps: {}, context: {} });
    expect(p).toMatchObject({ branch: 'exit' });
  });

  it('error() sets branch: error with required deps, context', () => {
    const p = error({ data: 'fail', deps: { svc: 'x' }, context: {} });
    expect(p).toMatchObject({ data: 'fail', branch: 'error', deps: { svc: 'x' } });
  });

  it('error() with undefined data', () => {
    const p = error({ data: undefined, deps: {}, context: {} });
    expect(p).toMatchObject({ branch: 'error' });
  });
});

// ─── 2. Node — graph wiring ──────────────────────────────────────────────────

describe('Node — graph wiring', () => {
  it('branch() stores node and returns this for chaining', () => {
    const a = makeNode(async (p) => p);
    const b = makeNode(async (p) => p);
    const c = makeNode(async (p) => p);
    const result = a.branch('ok', b).branch('fail', c);
    expect(result).toBe(a);
    expect(a.branches.get('ok')).toBe(b);
    expect(a.branches.get('fail')).toBe(c);
  });

  it('next() is shorthand for branch("default", node)', () => {
    const a = makeNode(async (p) => p);
    const b = makeNode(async (p) => p);
    a.next(b);
    expect(a.branches.get('default')).toBe(b);
  });

  it('multiple branches can point to the same node', () => {
    const a = makeNode(async (p) => p);
    const b = makeNode(async (p) => p);
    a.branch('x', b).branch('y', b);
    expect(a.branches.get('x')).toBe(b);
    expect(a.branches.get('y')).toBe(b);
  });
});

// ─── 3. Node — execution pipeline ────────────────────────────────────────────

describe('Node — execution pipeline', () => {
  it('runs without preprocess or postprocess', async () => {
    const node = makeNode(async (p) => packet({ data: (p.data as number) + 1, deps: p.deps, context: p.context }));
    const result = await node._exec(packet({ data: 10, deps: {}, context: {} }));
    expect(result.data).toBe(11);
  });

  it('preprocess is called before run', async () => {
    const order: string[] = [];
    const node = makeNode(
      async (p) => {
        order.push('run');
        return packet({ data: p.data, deps: p.deps, context: p.context });
      },
      {
        preprocess: async (p) => {
          order.push('pre');
          return p;
        },
      },
    );
    await node._exec(packet({ data: 1, deps: {}, context: {} }));
    expect(order).toEqual(['pre', 'run']);
  });

  it('postprocess is called after run', async () => {
    const order: string[] = [];
    const node = makeNode(
      async (p) => {
        order.push('run');
        return packet({ data: p.data, deps: p.deps, context: p.context });
      },
      {
        postprocess: async (p) => {
          order.push('post');
          return p;
        },
      },
    );
    await node._exec(packet({ data: 1, deps: {}, context: {} }));
    expect(order).toEqual(['run', 'post']);
  });

  it('pipeline order: preprocess → run → postprocess', async () => {
    const order: string[] = [];
    const node = makeNode(
      async (p) => {
        order.push('run');
        return packet({ data: (p.data as number) * 2, deps: p.deps, context: p.context });
      },
      {
        preprocess: async (p) => {
          order.push('pre');
          return packet({ data: (p.data as number) + 1, deps: p.deps, context: p.context });
        },
        postprocess: async (p) => {
          order.push('post');
          return p;
        },
      },
    );
    const result = await node._exec(packet({ data: 3, deps: {}, context: {} }));
    expect(order).toEqual(['pre', 'run', 'post']);
    expect(result.data).toBe(8); // (3+1)*2
  });

  it('postprocess can override branch', async () => {
    const node = makeNode(async (p) => packet({ data: p.data, deps: p.deps, context: p.context }), {
      postprocess: async (p) => ({ ...p, branch: 'custom' }),
    });
    const result = await node._exec(packet({ data: 'x', deps: {}, context: {} }));
    expect(result.branch).toBe('custom');
  });

  it('_exec never rejects — errors come back as branch: error', async () => {
    const node = makeNode(async () => {
      throw new Error('boom');
    });
    const result = await node._exec(packet({ data: 'x', deps: {}, context: {} }));
    expect(result.branch).toBe('error');
    expect(result.data).toBeInstanceOf(Error);
    expect((result.data as Error).message).toBe('boom');
  });

  it('context from preprocess is forwarded to run', async () => {
    const node = makeNode(async (p) => packet({ data: p.data, context: p.context, deps: p.deps }), {
      preprocess: async (p) => ({ ...p, context: { injected: true } }),
    });
    const result = await node._exec(packet({ data: 'x', deps: {}, context: {} }));
    expect(result.context).toEqual({ injected: true });
  });

  it('deps pass through unchanged', async () => {
    const deps = { svc: 'test' };
    const node = makeNode(async (p) => packet({ data: p.data, deps: p.deps, context: p.context }));
    const result = await node._exec(packet({ data: 1, deps, context: {} }));
    expect(result.deps).toBe(deps);
  });

  it('packet with no data passes through', async () => {
    const node = makeNode(async (p) => packet({ data: undefined, context: p.context, deps: p.deps }));
    const result = await node._exec(packet({ data: undefined, context: { val: 42 }, deps: {} }));
    expect((result as SinglePacket).data).toBeUndefined();
    expect(result.context).toEqual({ val: 42 });
  });
});

// ─── 4. Node — batch mode ────────────────────────────────────────────────────

describe('Node — batch mode', () => {
  it('preprocess can switch to batch mode', async () => {
    const node = makeNode(async (p) => packet({ data: (p.data as number) * 2, deps: p.deps, context: p.context }), {
      preprocess: async (p) => batch({ data: [1, 2, 3], deps: p.deps, context: p.context }),
    });
    const result = await node._exec(packet({ data: 'ignored', deps: {}, context: {} }));
    expect(result.type).toBe('batch');
    expect(result.data).toEqual([2, 4, 6]);
  });

  it('run is called once per batch item (parallel)', async () => {
    const calls: number[] = [];
    const node = makeNode(async (p) => {
      calls.push(p.data as number);
      return packet({ data: (p.data as number) + 10, deps: p.deps, context: p.context });
    });
    const result = await node._exec(batch({ data: [1, 2, 3], deps: {}, context: {} }));
    expect(calls).toHaveLength(3);
    expect(result.type).toBe('batch');
    expect((result.data as number[]).sort()).toEqual([11, 12, 13]);
  });

  it('batch results reassembled into type:batch packet', async () => {
    const node = makeNode(async (p) => packet({ data: String(p.data), deps: p.deps, context: p.context }));
    const result = await node._exec(batch({ data: [7, 8], deps: {}, context: {} }));
    expect(result).toMatchObject({ type: 'batch', data: ['7', '8'] });
  });

  it('context from individual batch runs is isolated (not merged back)', async () => {
    const node = makeNode(async (p) => packet({ data: p.data, context: { modified: true }, deps: p.deps }));
    const originalCtx = { count: 0 };
    const result = await node._exec(batch({ data: [1, 2], context: originalCtx, deps: {} }));
    expect(result.context).toBe(originalCtx);
  });

  it('any batch failure routes to fallback with AggregateError; successes in p.data', async () => {
    let received: { p: any; err: any } | null = null;
    const node = makeNode(
      async (p) => {
        if (p.data === 2) throw new Error('item 2 failed');
        return packet({ data: (p.data as number) * 10, deps: p.deps, context: p.context });
      },
      {
        fallback: async (p, err) => {
          received = { p, err };
          return exit({ data: (p as any).data, deps: (p as any).deps, context: (p as any).context });
        },
      },
    );
    const result = await node._exec(batch({ data: [1, 2, 3], deps: {}, context: {} }));
    expect(result.branch).toBe('exit');
    expect(received).not.toBeNull();
    expect(received!.err).toBeInstanceOf(AggregateError);
    expect(received!.err.errors).toHaveLength(1);
    expect((received!.p.data as number[]).sort()).toEqual([10, 30]);
  });

  it('all batch items fail — fallback gets empty data and full AggregateError', async () => {
    const node = makeNode(
      async () => {
        throw new Error('always');
      },
      { fallback: async (p, err) => error({ data: err, deps: p.deps, context: p.context }) },
    );
    const result = await node._exec(batch({ data: [1, 2], deps: {}, context: {} }));
    expect(result.branch).toBe('error');
    expect(result.data).toBeInstanceOf(AggregateError);
  });

  it('no fallback — batch failure produces error packet with AggregateError', async () => {
    const node = makeNode(async () => {
      throw new Error('fail');
    });
    const result = await node._exec(batch({ data: [1, 2], deps: {}, context: {} }));
    expect(result.branch).toBe('error');
    expect((result as any).error).toBeInstanceOf(AggregateError);
    expect((result as any).data).toEqual([]);
  });

  it('postprocess receives reassembled batch result on full success', async () => {
    let postReceived: any = null;
    const node = makeNode(async (p) => packet({ data: (p.data as number) * 10, deps: p.deps, context: p.context }), {
      postprocess: async (p) => {
        postReceived = p;
        return p;
      },
    });
    await node._exec(batch({ data: [2, 3], deps: {}, context: {} }));
    expect(postReceived).not.toBeNull();
    expect(postReceived.type).toBe('batch');
    expect(postReceived.data).toEqual([20, 30]);
  });

  it('postprocess is NOT called when batch has failures', async () => {
    const postprocess = vi.fn(async (p: any) => p);
    const node = makeNode(
      async (p) => {
        if (p.data === 1) throw new Error('fail');
        return packet({ data: p.data, deps: p.deps, context: p.context });
      },
      { postprocess, fallback: async (p, _err) => exit({ data: undefined, deps: p.deps, context: p.context }) },
    );
    await node._exec(batch({ data: [1, 2], deps: {}, context: {} }));
    expect(postprocess).not.toHaveBeenCalled();
  });

  it('runs batch items in parallel (simultaneous execution)', async () => {
    const startTimes: number[] = [];
    const node = makeNode(async (p) => {
      startTimes.push(Date.now());
      await new Promise((r) => setTimeout(r, 50));
      return packet({ data: p.data, deps: p.deps, context: p.context });
    });
    await node._exec(batch({ data: [1, 2, 3], deps: {}, context: {} }));
    const spread = Math.max(...startTimes) - Math.min(...startTimes);
    expect(spread).toBeLessThan(30);
  });

  it('AbortError from all batch items resolves as abort packet', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const node = makeNode(async (p) => {
      if (p.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      return packet({ data: p.data, deps: p.deps, context: p.context });
    });
    const result = await node._exec({ type: 'batch', data: [1, 2], signal: ctrl.signal, deps: {}, context: {} });
    expect(result.branch).toBe('abort');
  });
});

// ─── 5. Node — retries, timeout, fallback, abort hook ───────────────────────

describe('Node — retries', () => {
  it('maxRunTries defaults to 1 (no retry)', async () => {
    let calls = 0;
    const node = makeNode(async () => {
      calls++;
      throw new Error('fail');
    });
    const result = await node._exec(packet({ data: 'x', deps: {}, context: {} }));
    expect(calls).toBe(1);
    expect(result.branch).toBe('error');
  });

  it('retries up to maxRunTries times on failure', async () => {
    let calls = 0;
    const node = makeNode(
      async (p) => {
        calls++;
        if (calls < 3) throw new Error('retry');
        return packet({ data: 'ok', deps: p.deps, context: p.context });
      },
      { nodeOptions: { maxRunTries: 3 } },
    );
    const result = await node._exec(packet({ data: 'x', deps: {}, context: {} }));
    expect(calls).toBe(3);
    expect(result.data).toBe('ok');
  });

  it('returns error packet when all retries exhausted', async () => {
    const node = makeNode(
      async () => {
        throw new Error('always');
      },
      { nodeOptions: { maxRunTries: 2 } },
    );
    const result = await node._exec(packet({ data: 'x', deps: {}, context: {} }));
    expect(result.branch).toBe('error');
    expect((result.data as Error).message).toBe('always');
  });

  it('waits between retries', async () => {
    const times: number[] = [];
    const node = makeNode(
      async () => {
        times.push(Date.now());
        throw new Error('x');
      },
      { nodeOptions: { maxRunTries: 2, wait: 50 } },
    );
    await node._exec(packet({ data: 'x', deps: {}, context: {} }));
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(40);
  });

  it('AbortError is not retried — propagates immediately as abort packet', async () => {
    let calls = 0;
    const node = makeNode(
      async () => {
        calls++;
        throw new DOMException('Aborted', 'AbortError');
      },
      { nodeOptions: { maxRunTries: 3 } },
    );
    const result = await node._exec(packet({ data: 'x', deps: {}, context: {} }));
    expect(calls).toBe(1);
    expect(result.branch).toBe('abort');
  });

  it('abort is checked before each retry attempt', async () => {
    const ctrl = new AbortController();
    let calls = 0;
    const node = makeNode(
      async (p) => {
        calls++;
        if (calls === 1) {
          ctrl.abort();
          throw new Error('fail');
        }
        return packet({ data: p.data, deps: p.deps, context: p.context });
      },
      { nodeOptions: { maxRunTries: 3, wait: 0 } },
    );
    const result = await node._exec({ data: 'x', signal: ctrl.signal, deps: {}, context: {} });
    expect(result.branch).toBe('abort');
    expect(calls).toBe(1);
  });
});

describe('Node — timeout', () => {
  it('throws timeout error after specified ms (per attempt)', async () => {
    const node = makeNode(async () => new Promise((r) => setTimeout(r, 200)), { nodeOptions: { timeout: 50 } });
    const result = await node._exec(packet({ data: 'x', deps: {}, context: {} }));
    expect(result.branch).toBe('error');
    expect((result.data as Error).message).toMatch(/timed out after 50ms/);
  }, 1000);

  it('timeout is per-attempt, not cumulative', async () => {
    let calls = 0;
    const node = makeNode(
      async (p) => {
        calls++;
        if (calls < 2) return new Promise((r) => setTimeout(r, 200));
        return packet({ data: 'ok', deps: p.deps, context: p.context });
      },
      { nodeOptions: { timeout: 50, maxRunTries: 2 } },
    );
    const result = await node._exec(packet({ data: 'x', deps: {}, context: {} }));
    expect(result.data).toBe('ok');
    expect(calls).toBe(2);
  }, 2000);
});

describe('Node — fallback', () => {
  it('fallback is called when all retries exhausted', async () => {
    const fallbackFn = vi.fn(async (p: any, _err: Error) =>
      exit({ data: 'recovered', deps: p.deps, context: p.context }),
    );
    const node = makeNode(
      async () => {
        throw new Error('boom');
      },
      { fallback: fallbackFn, nodeOptions: { maxRunTries: 2 } },
    );
    const result = await node._exec(packet({ data: 'x', deps: {}, context: {} }));
    expect(fallbackFn).toHaveBeenCalledOnce();
    expect(result.branch).toBe('exit');
    expect(result.data).toBe('recovered');
  });

  it('fallback receives the original input packet', async () => {
    let received: any = null;
    const node = makeNode(
      async () => {
        throw new Error('x');
      },
      {
        fallback: async (p, _err) => {
          received = p;
          return error({ data: 'handled', deps: p.deps, context: p.context });
        },
      },
    );
    const input = packet({ data: 'original-data', context: { k: 1 }, deps: {} });
    await node._exec(input);
    expect(received.data).toBe('original-data');
  });

  it('fallback is called when preprocess throws', async () => {
    const fallbackFn = vi.fn(async (p: any) => exit({ data: undefined, deps: p.deps, context: p.context }));
    const node = makeNode(async (p) => packet({ data: p.data, deps: p.deps, context: p.context }), {
      preprocess: async () => {
        throw new Error('pre-error');
      },
      fallback: fallbackFn,
    });
    const result = await node._exec(packet({ data: 'x', deps: {}, context: {} }));
    expect(fallbackFn).toHaveBeenCalledOnce();
    expect(result.branch).toBe('exit');
  });

  it('fallback is called when postprocess throws', async () => {
    const fallbackFn = vi.fn(async (p: any) => exit({ data: undefined, deps: p.deps, context: p.context }));
    const node = makeNode(async (p) => packet({ data: p.data, deps: p.deps, context: p.context }), {
      postprocess: async () => {
        throw new Error('post-error');
      },
      fallback: fallbackFn,
    });
    const result = await node._exec(packet({ data: 'x', deps: {}, context: {} }));
    expect(fallbackFn).toHaveBeenCalledOnce();
  });

  it('without fallback, error becomes branch: error packet (neverthrow)', async () => {
    const node = makeNode(async () => {
      throw new Error('raw');
    });
    const result = await node._exec(packet({ data: 'x', deps: {}, context: {} }));
    expect(result.branch).toBe('error');
    expect(result.data).toBeInstanceOf(Error);
  });
});

describe('Node — abort hook', () => {
  it('onAbort is called when AbortError propagates', async () => {
    const onAbort = vi.fn(async () => {});
    const node = makeNode(
      async () => {
        throw new DOMException('Aborted', 'AbortError');
      },
      { onAbort },
    );
    const result = await node._exec(packet({ data: 'x', deps: {}, context: {} }));
    expect(onAbort).toHaveBeenCalledOnce();
    expect(result.branch).toBe('abort');
  });

  it('errors thrown in onAbort are swallowed', async () => {
    const node = makeNode(
      async () => {
        throw new DOMException('Aborted', 'AbortError');
      },
      {
        onAbort: async () => {
          throw new Error('onAbort exploded');
        },
      },
    );
    await expect(node._exec(packet({ data: 'x', deps: {}, context: {} }))).resolves.toMatchObject({ branch: 'abort' });
  });
});

// ─── 6. Flow — traversal ─────────────────────────────────────────────────────

describe('Flow — traversal', () => {
  it('traverses a simple A → B chain', async () => {
    const results: string[] = [];
    const a = makeNode(async (p) => {
      results.push('A');
      return packet({ data: p.data, branch: 'default', deps: p.deps, context: p.context });
    });
    const b = makeNode(async (p) => {
      results.push('B');
      return exit({ data: p.data, deps: p.deps, context: p.context });
    });
    a.next(b);
    const flow = makeFlow(a);
    const out = await flow.run(packet({ data: 'start', deps: {}, context: {} }));
    expect(results).toEqual(['A', 'B']);
    expect(out.branch).toBe('exit');
  });

  it('signal is injected into every packet', async () => {
    const signals: (AbortSignal | undefined)[] = [];
    const a = makeNode(async (p) => {
      signals.push(p.signal);
      return exit({ data: undefined, deps: p.deps, context: p.context });
    });
    const flow = makeFlow(a);
    await flow.run(packet({ data: 'x', deps: {}, context: {} }));
    expect(signals[0]).toBeInstanceOf(AbortSignal);
  });

  it('context from each node is forwarded to the next', async () => {
    const a = makeNode(async (p) => packet({ data: p.data, branch: 'default', context: { step: 1 }, deps: p.deps }));
    const b = makeNode(async (p) =>
      exit({ data: p.data, context: { ...((p.context as any) ?? {}), step: 2 }, deps: p.deps }),
    );
    a.next(b);
    const flow = makeFlow(a);
    const out = await flow.run(packet({ data: 'x', deps: {}, context: {} }));
    expect(out.context).toMatchObject({ step: 2 });
  });

  it('advances using result.branch', async () => {
    const visited: string[] = [];
    const start = makeNode(async (p) => {
      visited.push('start');
      return packet({ data: 1, branch: 'go', deps: p.deps, context: p.context });
    });
    const go = makeNode(async (p) => {
      visited.push('go');
      return exit({ data: 2, deps: p.deps, context: p.context });
    });
    const skip = makeNode(async (p) => {
      visited.push('skip');
      return exit({ data: 3, deps: p.deps, context: p.context });
    });
    start.branch('go', go).branch('skip', skip);
    const flow = makeFlow(start);
    await flow.run(packet({ data: 'x', deps: {}, context: {} }));
    expect(visited).toEqual(['start', 'go']);
  });

  it('returns result as-is when no next node for branch (implicit exit)', async () => {
    const node = makeNode(async (p) =>
      packet({ data: 'terminal', branch: 'nowhere', deps: p.deps, context: p.context }),
    );
    const flow = makeFlow(node);
    const out = await flow.run(packet({ data: 'x', deps: {}, context: {} }));
    expect(out.data).toBe('terminal');
    expect(out.branch).toBe('nowhere');
  });

  it('branch: default used when run returns no branch', async () => {
    const a = makeNode(async (p) => packet({ data: 'result', deps: p.deps, context: p.context }));
    const b = makeNode(async (p) => exit({ data: p.data, deps: p.deps, context: p.context }));
    a.next(b);
    const flow = makeFlow(a);
    const out = await flow.run(packet({ data: 'x', deps: {}, context: {} }));
    expect(out.branch).toBe('exit');
    expect(out.data).toBe('result');
  });
});

// ─── 7. Flow — reserved branches ─────────────────────────────────────────────

describe('Flow — reserved branches', () => {
  it('exit branch terminates flow and calls onExit', async () => {
    const onExit = vi.fn(async () => {});
    const node = makeNode(async (p) => exit({ data: 'done', deps: p.deps, context: p.context }));
    const flow = makeFlow(node, { onExit });
    const out = await flow.run(packet({ data: 'x', deps: {}, context: {} }));
    expect(out.branch).toBe('exit');
    expect(out.data).toBe('done');
    expect(onExit).toHaveBeenCalledOnce();
  });

  it('abort branch calls onAbort and returns abort packet', async () => {
    const onAbort = vi.fn(async () => {});
    const node = makeNode(async () => {
      throw new DOMException('Aborted', 'AbortError');
    });
    const flow = makeFlow(node, { onAbort });
    const out = await flow.run(packet({ data: 'x', deps: {}, context: {} }));
    expect(out.branch).toBe('abort');
    expect(onAbort).toHaveBeenCalled();
  });

  it('error branch triggers error chain (terminal if no handler)', async () => {
    const onError = vi.fn(async () => {});
    const node = makeNode(async (p) => error({ data: 'bad', deps: p.deps, context: p.context }));
    const flow = makeFlow(node, { onError });
    const out = await flow.run(packet({ data: 'x', deps: {}, context: {} }));
    expect(out.branch).toBe('error');
    expect(onError).toHaveBeenCalledOnce();
  });
});

// ─── 8. Flow — error chain ────────────────────────────────────────────────────

describe('Flow — error chain', () => {
  it('step 1: routes to error-branch node if present', async () => {
    const visited: string[] = [];
    const handler = makeNode(async (p) => {
      visited.push('handler');
      return exit({ data: p.data, deps: p.deps, context: p.context });
    });
    const node = makeNode(async (p) => {
      visited.push('main');
      return error({ data: 'fail', deps: p.deps, context: p.context });
    });
    node.branch('error', handler);
    const flow = makeFlow(node);
    const out = await flow.run(packet({ data: 'x', deps: {}, context: {} }));
    expect(visited).toEqual(['main', 'handler']);
    expect(out.branch).toBe('exit');
  });

  it('step 2: calls flow.fallback if no error-branch node', async () => {
    const fallbackFn = vi.fn(async (p: any) => exit({ data: 'flow-fallback', deps: p.deps, context: p.context }));
    const node = makeNode(async (p) => error({ data: 'fail', deps: p.deps, context: p.context }));
    const flow = makeFlow(node, { fallback: fallbackFn });
    const out = await flow.run(packet({ data: 'x', deps: {}, context: {} }));
    expect(fallbackFn).toHaveBeenCalledOnce();
    expect(out.branch).toBe('exit');
    expect(out.data).toBe('flow-fallback');
  });

  it('step 3: calls onError and returns terminal error packet', async () => {
    const onError = vi.fn(async () => {});
    const node = makeNode(async (p) => error({ data: 'terminal', deps: p.deps, context: p.context }));
    const flow = makeFlow(node, { onError });
    const out = await flow.run(packet({ data: 'x', deps: {}, context: {} }));
    expect(onError).toHaveBeenCalledOnce();
    expect(out.branch).toBe('error');
  });

  it('error chain: error-branch node → then continues traversal', async () => {
    const visited: string[] = [];
    const final = makeNode(async (p) => {
      visited.push('final');
      return exit({ data: 'ok', deps: p.deps, context: p.context });
    });
    const errHandler = makeNode(async (p) => {
      visited.push('errHandler');
      return packet({ data: 'recovered', deps: p.deps, context: p.context });
    });
    errHandler.next(final);
    const start = makeNode(async (p) => {
      visited.push('start');
      return error({ data: 'oops', deps: p.deps, context: p.context });
    });
    start.branch('error', errHandler);
    const flow = makeFlow(start);
    const out = await flow.run(packet({ data: 'x', deps: {}, context: {} }));
    expect(visited).toEqual(['start', 'errHandler', 'final']);
    expect(out.branch).toBe('exit');
  });

  it('onError hook errors are swallowed', async () => {
    const node = makeNode(async (p) => error({ data: 'x', deps: p.deps, context: p.context }));
    const flow = makeFlow(node, {
      onError: async () => {
        throw new Error('hook exploded');
      },
    });
    await expect(flow.run(packet({ data: 'x', deps: {}, context: {} }))).resolves.toMatchObject({ branch: 'error' });
  });

  it('flow.error() forced error goes through error chain', async () => {
    const onError = vi.fn(async () => {});
    let flowRef: ReturnType<typeof makeFlow>;
    const node = makeNode(async (p) => {
      flowRef!.error('forced');
      return packet({ data: 'continue', deps: p.deps, context: p.context });
    });
    const next = makeNode(async (p) => exit({ data: 'should-not-reach', deps: p.deps, context: p.context }));
    node.next(next);
    flowRef = makeFlow(node, { onError });
    const out = await flowRef.run(packet({ data: 'x', deps: {}, context: {} }));
    expect(out.branch).toBe('error');
    expect(onError).toHaveBeenCalledOnce();
  });
});

// ─── 9. Flow — loop guards ────────────────────────────────────────────────────

describe('Flow — loop guards', () => {
  it('per-node maxLoopEntering throws when exceeded', async () => {
    const onError = vi.fn(async () => {});
    const node = makeNode(async (p) => packet({ data: p.data, deps: p.deps, context: p.context }), {
      nodeOptions: { maxLoopEntering: 3 },
    });
    node.next(node);
    const flow = makeFlow(node, { onError });
    const out = await flow.run(packet({ data: 'x', deps: {}, context: {} }));
    expect(out.branch).toBe('error');
    expect(onError).toHaveBeenCalledOnce();
  });

  it('flow-level maxLoopEntering counts start node re-enterings', async () => {
    const onError = vi.fn(async () => {});
    const node = makeNode(async (p) => packet({ data: p.data, deps: p.deps, context: p.context }));
    node.next(node);
    const flow = makeFlow(node, { onError }, { maxLoopEntering: 2 });
    const out = await flow.run(packet({ data: 'x', deps: {}, context: {} }));
    expect(out.branch).toBe('error');
    expect(onError).toHaveBeenCalledOnce();
  });

  it('loop guard error goes through fallback chain', async () => {
    const fallback = vi.fn(async (p: any) => exit({ data: 'caught', deps: p.deps, context: p.context }));
    const node = makeNode(async (p) => packet({ data: p.data, deps: p.deps, context: p.context }), {
      nodeOptions: { maxLoopEntering: 1 },
    });
    node.next(node);
    const flow = makeFlow(node, { fallback });
    const out = await flow.run(packet({ data: 'x', deps: {}, context: {} }));
    expect(fallback).toHaveBeenCalledOnce();
    expect(out.branch).toBe('exit');
  });
});

// ─── 10. Flow — abort ────────────────────────────────────────────────────────

describe('Flow — abort', () => {
  it('flow.abort() returns branch: abort', async () => {
    let flowRef: ReturnType<typeof makeFlow>;
    const node = makeNode(async (p) => {
      flowRef!.abort();
      return packet({ data: 'after-abort', deps: p.deps, context: p.context });
    });
    const next = makeNode(async (p) => exit({ data: 'next', deps: p.deps, context: p.context }));
    node.next(next);
    flowRef = makeFlow(node);
    const out = await flowRef.run(packet({ data: 'x', deps: {}, context: {} }));
    expect(out.branch).toBe('abort');
  });

  it('abort calls currentNode.onAbort and flow.onAbort', async () => {
    const nodeOnAbort = vi.fn(async () => {});
    const flowOnAbort = vi.fn(async () => {});
    const node = makeNode(
      async () => {
        throw new DOMException('Aborted', 'AbortError');
      },
      { onAbort: nodeOnAbort },
    );
    const flow = makeFlow(node, { onAbort: flowOnAbort });
    await flow.run(packet({ data: 'x', deps: {}, context: {} }));
    expect(nodeOnAbort).toHaveBeenCalled();
    expect(flowOnAbort).toHaveBeenCalled();
  });

  it('external signal aborts the flow', async () => {
    const ctrl = new AbortController();
    const node = makeNode(async (p) => {
      ctrl.abort();
      return packet({ data: p.data, deps: p.deps, context: p.context });
    });
    const next = makeNode(async (p) => exit({ data: 'should-not-reach', deps: p.deps, context: p.context }));
    node.next(next);
    const flow = makeFlow(node, {}, { signal: ctrl.signal });
    const out = await flow.run(packet({ data: 'x', deps: {}, context: {} }));
    expect(out.branch).toBe('abort');
  });

  it('if signal already aborted at construction, aborts immediately', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const node = makeNode(async (p) => exit({ data: 'should-not-run', deps: p.deps, context: p.context }));
    const flow = makeFlow(node, {}, { signal: ctrl.signal });
    const out = await flow.run(packet({ data: 'x', deps: {}, context: {} }));
    expect(out.branch).toBe('abort');
  });

  it('abort wakes a paused flow', async () => {
    let flowRef: ReturnType<typeof makeFlow>;
    const a = makeNode(async (p) => packet({ data: p.data, deps: p.deps, context: p.context }));
    const b = makeNode(async (p) => exit({ data: 'ok', deps: p.deps, context: p.context }));
    a.next(b);
    flowRef = makeFlow(a);
    const runPromise = flowRef.run(packet({ data: 'x', deps: {}, context: {} }));
    flowRef.pause();
    await new Promise((r) => setTimeout(r, 10));
    flowRef.abort();
    const out = await runPromise;
    expect(out.branch).toBe('abort');
  });
});

// ─── 11. Flow — pause / resume ───────────────────────────────────────────────

describe('Flow — pause / resume', () => {
  it('pause() holds run() pending until resume() is called', async () => {
    let flowRef: ReturnType<typeof makeFlow>;
    const a = makeNode(async (p) => packet({ data: p.data, deps: p.deps, context: p.context }));
    const b = makeNode(async (p) => exit({ data: p.data, deps: p.deps, context: p.context }));
    a.next(b);
    flowRef = makeFlow(a);
    flowRef.pause();
    const runPromise = flowRef.run(packet({ data: 'payload', deps: {}, context: {} }));
    let resolved = false;
    runPromise.then(() => {
      resolved = true;
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(resolved).toBe(false);
    flowRef.resume();
    const out = await runPromise;
    expect(resolved).toBe(true);
    expect(out.branch).toBe('exit');
    expect(out.data).toBe('payload');
  });

  it('onPause fires with checkpoint packet before suspending', async () => {
    const onPause = vi.fn(async () => {});
    let flowRef: ReturnType<typeof makeFlow>;
    const a = makeNode(async (p) => packet({ data: p.data, context: { step: 'a' }, deps: p.deps }));
    const b = makeNode(async (p) => exit({ data: p.data, deps: p.deps, context: p.context }));
    a.next(b);
    flowRef = makeFlow(a, { onPause });
    flowRef.pause();
    const runPromise = flowRef.run(packet({ data: 'x', deps: {}, context: {} }));
    await new Promise((r) => setTimeout(r, 10));
    expect(onPause).toHaveBeenCalledOnce();
    flowRef.resume();
    await runPromise;
  });

  it('resume(packet) replaces the checkpoint packet', async () => {
    let flowRef: ReturnType<typeof makeFlow>;
    const a = makeNode(async (p) => packet({ data: p.data, deps: p.deps, context: p.context }));
    const b = makeNode(async (p) => exit({ data: p.data, deps: p.deps, context: p.context }));
    a.next(b);
    flowRef = makeFlow(a);
    flowRef.pause();
    const runPromise = flowRef.run(packet({ data: 'original', deps: {}, context: {} }));
    await new Promise((r) => setTimeout(r, 10));
    flowRef.resume(packet({ data: 'injected', deps: {}, context: {} }));
    const out = await runPromise;
    expect(out.data).toBe('injected');
  });

  it('resume() with no arg reuses checkpoint packet', async () => {
    let flowRef: ReturnType<typeof makeFlow>;
    const a = makeNode(async (p) => packet({ data: p.data, deps: p.deps, context: p.context }));
    const b = makeNode(async (p) => exit({ data: p.data, deps: p.deps, context: p.context }));
    a.next(b);
    flowRef = makeFlow(a);
    flowRef.pause();
    const runPromise = flowRef.run(packet({ data: 'checkpoint-data', deps: {}, context: {} }));
    await new Promise((r) => setTimeout(r, 10));
    flowRef.resume();
    const out = await runPromise;
    expect(out.data).toBe('checkpoint-data');
  });

  it('onResume fires only on genuine resume (not on abort wake)', async () => {
    const onResume = vi.fn(async () => {});
    let flowRef: ReturnType<typeof makeFlow>;
    const a = makeNode(async (p) => packet({ data: p.data, deps: p.deps, context: p.context }));
    const b = makeNode(async (p) => exit({ data: 'ok', deps: p.deps, context: p.context }));
    a.next(b);
    flowRef = makeFlow(a, { onResume });
    flowRef.pause();
    const runPromise = flowRef.run(packet({ data: 'x', deps: {}, context: {} }));
    await new Promise((r) => setTimeout(r, 10));
    flowRef.abort();
    await runPromise;
    expect(onResume).not.toHaveBeenCalled();
  });

  it('onResume fires on genuine resume', async () => {
    const onResume = vi.fn(async () => {});
    let flowRef: ReturnType<typeof makeFlow>;
    const a = makeNode(async (p) => packet({ data: p.data, deps: p.deps, context: p.context }));
    const b = makeNode(async (p) => exit({ data: 'ok', deps: p.deps, context: p.context }));
    a.next(b);
    flowRef = makeFlow(a, { onResume });
    flowRef.pause();
    const runPromise = flowRef.run(packet({ data: 'x', deps: {}, context: {} }));
    await new Promise((r) => setTimeout(r, 10));
    flowRef.resume();
    await runPromise;
    expect(onResume).toHaveBeenCalledOnce();
  });

  it('resume() throws if flow is not paused', () => {
    const node = makeNode(async (p) => exit({ data: p.data, deps: p.deps, context: p.context }));
    const flow = makeFlow(node);
    expect(() => flow.resume()).toThrow('Flow is not paused');
  });

  it('exit() while paused wakes and terminates with exit branch', async () => {
    let flowRef: ReturnType<typeof makeFlow>;
    const a = makeNode(async (p) => packet({ data: p.data, deps: p.deps, context: p.context }));
    const b = makeNode(async (p) => exit({ data: 'ok', deps: p.deps, context: p.context }));
    a.next(b);
    flowRef = makeFlow(a);
    flowRef.pause();
    const runPromise = flowRef.run(packet({ data: 'x', deps: {}, context: {} }));
    await new Promise((r) => setTimeout(r, 10));
    flowRef.exit();
    const out = await runPromise;
    expect(out.branch).toBe('exit');
  });

  it('preprocess/run/postprocess complete before pause takes effect', async () => {
    const order: string[] = [];
    let flowRef: ReturnType<typeof makeFlow>;
    const a = makeNode(
      async (p) => {
        order.push('run');
        return packet({ data: p.data, deps: p.deps, context: p.context });
      },
      {
        preprocess: async (p) => {
          order.push('pre');
          return p;
        },
        postprocess: async (p) => {
          order.push('post');
          return p;
        },
      },
    );
    const b = makeNode(async (p) => exit({ data: 'done', deps: p.deps, context: p.context }));
    a.next(b);
    flowRef = makeFlow(a);
    flowRef.pause();
    const runPromise = flowRef.run(packet({ data: 'x', deps: {}, context: {} }));
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual(['pre', 'run', 'post']);
    flowRef.resume();
    await runPromise;
  });

  it('pause packet: node returns pause() and flow suspends', async () => {
    const onPause = vi.fn(async () => {});
    let flowRef: ReturnType<typeof makeFlow>;
    const a = makeNode(async (p) => pause({ data: 'waiting', deps: p.deps, context: p.context }));
    const b = makeNode(async (p) => exit({ data: p.data, deps: p.deps, context: p.context }));
    a.branch('pause', b);
    flowRef = makeFlow(a, { onPause });
    const runPromise = flowRef.run(packet({ data: 'initial', deps: {}, context: {} }));
    let resolved = false;
    runPromise.then(() => {
      resolved = true;
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(resolved).toBe(false);
    expect(onPause).toHaveBeenCalledOnce();
    flowRef.resume(packet({ data: 'resumed', deps: {}, context: {} }));
    const out = await runPromise;
    expect(resolved).toBe(true);
    expect(out.data).toBe('resumed'); // resumed packet passed to b
  });

  it('node.resume(): node-driven resume wakes flow', async () => {
    let nodeRef: ReturnType<typeof makeNode>;
    let flowRef: ReturnType<typeof makeFlow>;
    const a = makeNode(async (p) => pause({ data: 'waiting', deps: p.deps, context: p.context }));
    const b = makeNode(async (p) => exit({ data: p.data, deps: p.deps, context: p.context }));
    a.branch('pause', b);
    nodeRef = a;
    flowRef = makeFlow(a);
    const runPromise = flowRef.run(packet({ data: 'x', deps: {}, context: {} }));
    await new Promise((r) => setTimeout(r, 10));
    // Node-driven resume
    nodeRef.resume(packet({ data: 'node-resumed', deps: {}, context: {} }));
    const out = await runPromise;
    expect(out.data).toBe('node-resumed');
  });

  it('node.resume() while not paused is silently ignored', async () => {
    const a = makeNode(async (p) => exit({ data: p.data, deps: p.deps, context: p.context }));
    const nodeRef = a;
    const flowRef = makeFlow(a);
    const out = await flowRef.run(packet({ data: 'x', deps: {}, context: {} }));
    // node.resume() when not paused — should not throw
    expect(() => nodeRef.resume(packet({ data: 'y', deps: {}, context: {} }))).not.toThrow();
    expect(out.data).toBe('x');
  });

  it('double node.resume() — second call ignored', async () => {
    let nodeRef: ReturnType<typeof makeNode>;
    const a = makeNode(async (p) => pause({ data: 'waiting', deps: p.deps, context: p.context }));
    const b = makeNode(async (p) => exit({ data: p.data, deps: p.deps, context: p.context }));
    a.branch('pause', b);
    nodeRef = a;
    const flowRef = makeFlow(a);
    const runPromise = flowRef.run(packet({ data: 'x', deps: {}, context: {} }));
    await new Promise((r) => setTimeout(r, 10));
    nodeRef.resume(packet({ data: 'first', deps: {}, context: {} }));
    // Second resume while first is already processing — should be ignored
    nodeRef.resume(packet({ data: 'second', deps: {}, context: {} }));
    const out = await runPromise;
    expect(out.data).toBe('first');
  });

  it('pause packet with no pause branch wired bubbles up as-is', async () => {
    const a = makeNode(async (p) => pause({ data: 'waiting', deps: p.deps, context: p.context }));
    // No branch('pause', ...) wired
    const flowRef = makeFlow(a);
    const out = await flowRef.run(packet({ data: 'x', deps: {}, context: {} }));
    expect(out.branch).toBe('pause');
    expect(out.data).toBe('waiting');
  });

  it('pause packet: both node.resume() and flow.pause()/resume() work together', async () => {
    let nodeRef: ReturnType<typeof makeNode>;
    let flowRef: ReturnType<typeof makeFlow>;
    const a = makeNode(async (p) => pause({ data: 'waiting', deps: p.deps, context: p.context }));
    const b = makeNode(async (p) => exit({ data: p.data, deps: p.deps, context: p.context }));
    a.branch('pause', b);
    nodeRef = a;
    flowRef = makeFlow(a);
    const runPromise = flowRef.run(packet({ data: 'x', deps: {}, context: {} }));
    await new Promise((r) => setTimeout(r, 10));
    // Woke by flow.pause() then node.resume() — node wins
    nodeRef.resume(packet({ data: 'via-node', deps: {}, context: {} }));
    const out = await runPromise;
    expect(out.data).toBe('via-node');
  });

  it('pause then abort: abort wakes the paused flow', async () => {
    const a = makeNode(async (p) => pause({ data: 'waiting', deps: p.deps, context: p.context }));
    const b = makeNode(async (p) => exit({ data: p.data, deps: p.deps, context: p.context }));
    a.branch('pause', b);
    const flowRef = makeFlow(a);
    const runPromise = flowRef.run(packet({ data: 'x', deps: {}, context: {} }));
    await new Promise((r) => setTimeout(r, 10));
    flowRef.abort();
    const out = await runPromise;
    expect(out.branch).toBe('abort');
  });
});

// ─── 12. Flow — forced exit ───────────────────────────────────────────────────

describe('Flow — forced exit', () => {
  it('flow.exit() resolves with branch: exit and calls onExit', async () => {
    const onExit = vi.fn(async () => {});
    let flowRef: ReturnType<typeof makeFlow>;
    const node = makeNode(async (p) => {
      flowRef!.exit();
      return packet({ data: 'ignored', deps: p.deps, context: p.context });
    });
    const next = makeNode(async (p) => exit({ data: 'next', deps: p.deps, context: p.context }));
    node.next(next);
    flowRef = makeFlow(node, { onExit });
    const out = await flowRef.run(packet({ data: 'x', deps: {}, context: {} }));
    expect(out.branch).toBe('exit');
    expect(onExit).toHaveBeenCalledOnce();
  });
});

// ─── 13. Flow — Node compatibility (nested flows) ────────────────────────────

describe('Flow — Node compatibility', () => {
  it('a Flow can be used as a node inside another Flow', async () => {
    const inner = makeNode(async (p) => exit({ data: 'inner-done', deps: p.deps, context: p.context }));
    const innerFlow = makeFlow(inner);
    const outer = makeFlow(innerFlow as unknown as Node<any, any, any, any>);
    const out = await outer.run(packet({ data: 'x', deps: {}, context: {} }));
    expect(out.branch).toBe('exit');
    expect(out.data).toBe('inner-done');
  });

  it('nested flow abort propagates to outer flow', async () => {
    const innerNode = makeNode(async () => {
      throw new DOMException('Aborted', 'AbortError');
    });
    const innerFlow = makeFlow(innerNode);
    const outer = makeFlow(innerFlow as unknown as Node<any, any, any, any>);
    const out = await outer.run(packet({ data: 'x', deps: {}, context: {} }));
    expect(out.branch).toBe('abort');
  });

  it('maxLoopEntering on Flow used as node counts outer entering', async () => {
    const onError = vi.fn(async () => {});
    const innerNode = makeNode(async (p) => packet({ data: p.data, deps: p.deps, context: p.context }));
    const innerFlow = makeFlow(innerNode, {}, { maxLoopEntering: 1 });
    const looper = makeNode(async (p) => packet({ data: p.data, deps: p.deps, context: p.context }));
    looper.next(innerFlow as unknown as Node<any, any, any, any>);
    (innerFlow as unknown as Node<any, any, any, any>).next(looper);
    const outer = makeFlow(looper, { onError });
    const out = await outer.run(packet({ data: 'x', deps: {}, context: {} }));
    expect(out.branch).toBe('error');
    expect(onError).toHaveBeenCalledOnce();
  });
});

// ─── 14. Flow — lifecycle hooks swallow errors ───────────────────────────────

describe('Flow — lifecycle hooks swallow their own errors', () => {
  it('onExit error is swallowed', async () => {
    const node = makeNode(async (p) => exit({ data: 'done', deps: p.deps, context: p.context }));
    const flow = makeFlow(node, {
      onExit: async () => {
        throw new Error('onExit boom');
      },
    });
    await expect(flow.run(packet({ data: 'x', deps: {}, context: {} }))).resolves.toMatchObject({ branch: 'exit' });
  });

  it('onAbort error is swallowed', async () => {
    const node = makeNode(async () => {
      throw new DOMException('Aborted', 'AbortError');
    });
    const flow = makeFlow(node, {
      onAbort: async () => {
        throw new Error('onAbort boom');
      },
    });
    await expect(flow.run(packet({ data: 'x', deps: {}, context: {} }))).resolves.toMatchObject({ branch: 'abort' });
  });

  it('onPause error is swallowed', async () => {
    let flowRef: ReturnType<typeof makeFlow>;
    const a = makeNode(async (p) => packet({ data: p.data, deps: p.deps, context: p.context }));
    const b = makeNode(async (p) => exit({ data: 'ok', deps: p.deps, context: p.context }));
    a.next(b);
    flowRef = makeFlow(a, {
      onPause: async () => {
        throw new Error('onPause boom');
      },
    });
    flowRef.pause();
    const runPromise = flowRef.run(packet({ data: 'x', deps: {}, context: {} }));
    await new Promise((r) => setTimeout(r, 10));
    flowRef.resume();
    await expect(runPromise).resolves.toMatchObject({ branch: 'exit' });
  });
});

// ─── 15. Edge Cases & Additional Coverage ────────────────────────────────────

describe('Edge Cases & Additional Coverage', () => {
  it('handles empty batch correctly', async () => {
    const node = makeNode(async (p) => packet({ data: p.data, deps: p.deps, context: p.context }));
    const result = await node._exec(batch({ data: [], deps: {}, context: {} }));
    expect(result.type).toBe('batch');
    expect(result.data).toEqual([]);
  });

  it('nested flow error is routed to "error" branch in outer flow', async () => {
    const innerNode = makeNode(async (p) => error({ data: 'inner-fail', deps: p.deps, context: p.context }));
    const innerFlow = makeFlow(innerNode);
    const handler = makeNode(async (p) => exit({ data: 'handled-inner-error', deps: p.deps, context: p.context }));
    (innerFlow as unknown as Node<any, any, any, any>).branch('error', handler);
    const outerFlow = makeFlow(innerFlow as unknown as Node<any, any, any, any>);
    const result = await outerFlow.run(packet({ data: 'start', deps: {}, context: {} }));
    expect(result.branch).toBe('exit');
    expect(result.data).toBe('handled-inner-error');
  });

  it('abort during preprocess prevents run execution', async () => {
    const ctrl = new AbortController();
    const runFn = vi.fn(async (p: any) => packet({ data: p.data, deps: p.deps, context: p.context }));
    const node = makeNode(runFn, {
      preprocess: async (p) => {
        ctrl.abort();
        return p;
      },
    });
    const result = await node._exec({ ...packet({ data: 'x', deps: {}, context: {} }), signal: ctrl.signal });
    expect(result.branch).toBe('abort');
    expect(runFn).not.toHaveBeenCalled();
  });
});

// ─── 16. Node — named constructor ────────────────────────────────────────────

describe('Node — named constructor', () => {
  it('nodeName defaults to class name when no name arg given', () => {
    const node = makeNode(async (p) => p);
    expect(node.nodeName).toBe('TestNode');
  });

  it('nodeName is set when string is passed as first arg', () => {
    class NamedNode extends Node<any, any, any, any> {
      async run(p: this['In']) {
        return p;
      }
    }
    const node = new NamedNode('myCustomName');
    expect(node.nodeName).toBe('myCustomName');
  });

  it('options are still respected when name is provided', () => {
    class NamedNode extends Node<any, any, any, any> {
      async run(p: this['In']) {
        return p;
      }
    }
    const node = new NamedNode('namedNode', { maxRunTries: 5, wait: 100, timeout: 200 });
    expect(node.nodeName).toBe('namedNode');
    expect(node.options.maxRunTries).toBe(5);
    expect(node.options.wait).toBe(100);
    expect(node.options.timeout).toBe(200);
  });

  it('nodeName without string arg — options still applied', () => {
    class NamedNode extends Node<any, any, any, any> {
      async run(p: this['In']) {
        return p;
      }
    }
    const node = new NamedNode({ maxRunTries: 3 });
    expect(node.nodeName).toBe('NamedNode');
    expect(node.options.maxRunTries).toBe(3);
  });
});

// ─── 17. Flow — onBeforeNode / onAfterNode hooks ─────────────────────────────

describe('Flow — onBeforeNode / onAfterNode hooks', () => {
  it('onBeforeNode is called before each node with its name and packet', async () => {
    const calls: Array<{ name: string; data: unknown }> = [];
    class NodeA extends Node<any, any, any, any> {
      async run(p: this['In']) {
        return packet({ data: 'a-result', deps: p.deps, context: p.context });
      }
    }
    class NodeB extends Node<any, any, any, any> {
      async run(p: this['In']) {
        return exit({ data: 'done', deps: p.deps, context: p.context });
      }
    }
    const a = new NodeA('nodeA');
    const b = new NodeB('nodeB');
    a.next(b);
    const flow = makeFlow(a, {
      onBeforeNode: async (name, p) => {
        calls.push({ name, data: p.data });
      },
    });
    await flow.run(packet({ data: 'start', deps: {}, context: {} }));
    expect(calls).toEqual([
      { name: 'nodeA', data: 'start' },
      { name: 'nodeB', data: 'a-result' },
    ]);
  });

  it('onAfterNode is called after each node with its name and result', async () => {
    const calls: Array<{ name: string; data: unknown }> = [];
    class NodeA extends Node<any, any, any, any> {
      async run(p: this['In']) {
        return packet({ data: 'a-result', deps: p.deps, context: p.context });
      }
    }
    class NodeB extends Node<any, any, any, any> {
      async run(p: this['In']) {
        return exit({ data: 'b-result', deps: p.deps, context: p.context });
      }
    }
    const a = new NodeA('nodeA');
    const b = new NodeB('nodeB');
    a.next(b);
    const flow = makeFlow(a, {
      onAfterNode: async (name, result) => {
        calls.push({ name, data: result.data });
      },
    });
    await flow.run(packet({ data: 'start', deps: {}, context: {} }));
    expect(calls).toEqual([
      { name: 'nodeA', data: 'a-result' },
      { name: 'nodeB', data: 'b-result' },
    ]);
  });

  it('onBeforeNode and onAfterNode are called in order around each node', async () => {
    const order: string[] = [];
    class MyNode extends Node<any, any, any, any> {
      async run(p: this['In']) {
        order.push('run');
        return exit({ data: 'done', deps: p.deps, context: p.context });
      }
    }
    const node = new MyNode('myNode');
    const flow = makeFlow(node, {
      onBeforeNode: async () => { order.push('before'); },
      onAfterNode: async () => { order.push('after'); },
    });
    await flow.run(packet({ data: 'x', deps: {}, context: {} }));
    expect(order).toEqual(['before', 'run', 'after']);
  });

  it('errors in onBeforeNode are swallowed and flow continues', async () => {
    const node = makeNode(async (p) => exit({ data: 'ok', deps: p.deps, context: p.context }));
    const flow = makeFlow(node, {
      onBeforeNode: async () => { throw new Error('before-hook boom'); },
    });
    const out = await flow.run(packet({ data: 'x', deps: {}, context: {} }));
    expect(out.branch).toBe('exit');
    expect(out.data).toBe('ok');
  });

  it('errors in onAfterNode are swallowed and flow continues', async () => {
    const a = makeNode(async (p) => packet({ data: 'intermediate', deps: p.deps, context: p.context }));
    const b = makeNode(async (p) => exit({ data: 'final', deps: p.deps, context: p.context }));
    a.next(b);
    const flow = makeFlow(a, {
      onAfterNode: async () => { throw new Error('after-hook boom'); },
    });
    const out = await flow.run(packet({ data: 'x', deps: {}, context: {} }));
    expect(out.branch).toBe('exit');
    expect(out.data).toBe('final');
  });
});

// ─── 18. Flow — getNodeByName ─────────────────────────────────────────────────

describe('Flow — getNodeByName', () => {
  it('finds the start node by name', () => {
    class StartNode extends Node<any, any, any, any> {
      async run(p: this['In']) { return exit({ data: 'done', deps: p.deps, context: p.context }); }
    }
    const start = new StartNode('startNode');
    const flow = makeFlow(start);
    expect(flow.getNodeByName('startNode')).toBe(start);
  });

  it('finds a downstream node by name', () => {
    class NodeA extends Node<any, any, any, any> {
      async run(p: this['In']) { return packet({ data: 'a', deps: p.deps, context: p.context }); }
    }
    class NodeB extends Node<any, any, any, any> {
      async run(p: this['In']) { return exit({ data: 'done', deps: p.deps, context: p.context }); }
    }
    const a = new NodeA('nodeA');
    const b = new NodeB('nodeB');
    a.next(b);
    const flow = makeFlow(a);
    expect(flow.getNodeByName('nodeB')).toBe(b);
  });

  it('returns undefined for a name that does not exist', () => {
    const node = makeNode(async (p) => exit({ data: 'done', deps: p.deps, context: p.context }));
    const flow = makeFlow(node);
    expect(flow.getNodeByName('nonExistent')).toBeUndefined();
  });

  it('handles cycles in the graph without infinite loop', () => {
    class NodeA extends Node<any, any, any, any> {
      async run(p: this['In']) { return packet({ data: p.data, deps: p.deps, context: p.context }); }
    }
    class NodeB extends Node<any, any, any, any> {
      async run(p: this['In']) { return exit({ data: 'done', deps: p.deps, context: p.context }); }
    }
    const a = new NodeA('nodeA');
    const b = new NodeB('nodeB');
    a.next(b);
    b.branch('loop', a); // cycle: b → a
    const flow = makeFlow(a);
    expect(flow.getNodeByName('nodeB')).toBe(b);
    expect(flow.getNodeByName('missing')).toBeUndefined();
  });

  it('finds nodes reachable through multiple branches', () => {
    class NodeA extends Node<any, any, any, any> {
      async run(p: this['In']) { return packet({ data: p.data, deps: p.deps, context: p.context }); }
    }
    class NodeB extends Node<any, any, any, any> {
      async run(p: this['In']) { return exit({ data: 'done', deps: p.deps, context: p.context }); }
    }
    class NodeC extends Node<any, any, any, any> {
      async run(p: this['In']) { return exit({ data: 'done', deps: p.deps, context: p.context }); }
    }
    const a = new NodeA('nodeA');
    const b = new NodeB('nodeB');
    const c = new NodeC('nodeC');
    a.branch('left', b).branch('right', c);
    const flow = makeFlow(a);
    expect(flow.getNodeByName('nodeC')).toBe(c);
  });
});

// ─── 19. Flow — runFrom ───────────────────────────────────────────────────────

describe('Flow — runFrom', () => {
  it('starts traversal from the given node, skipping earlier nodes', async () => {
    const visited: string[] = [];
    class NodeA extends Node<any, any, any, any> {
      async run(p: this['In']) {
        visited.push('A');
        return packet({ data: p.data, deps: p.deps, context: p.context });
      }
    }
    class NodeB extends Node<any, any, any, any> {
      async run(p: this['In']) {
        visited.push('B');
        return exit({ data: 'done', deps: p.deps, context: p.context });
      }
    }
    const a = new NodeA('nodeA');
    const b = new NodeB('nodeB');
    a.next(b);
    const flow = makeFlow(a);
    const out = await flow.runFrom(b, packet({ data: 'start-from-b', deps: {}, context: {} }));
    expect(visited).toEqual(['B']);
    expect(out.branch).toBe('exit');
  });

  it('runFrom respects flow abort signal', async () => {
    class NodeA extends Node<any, any, any, any> {
      async run(p: this['In']) {
        return exit({ data: 'done', deps: p.deps, context: p.context });
      }
    }
    const ctrl = new AbortController();
    ctrl.abort();
    const a = new NodeA('nodeA');
    const flow = makeFlow(a, {}, { signal: ctrl.signal });
    const out = await flow.runFrom(a, packet({ data: 'x', deps: {}, context: {} }));
    expect(out.branch).toBe('abort');
  });

  it('runFrom propagates onBeforeNode / onAfterNode hooks', async () => {
    const calls: string[] = [];
    class NodeB extends Node<any, any, any, any> {
      async run(p: this['In']) {
        return exit({ data: 'done', deps: p.deps, context: p.context });
      }
    }
    const b = new NodeB('nodeB');
    const flow = makeFlow(b, {
      onBeforeNode: async (name) => { calls.push(`before:${name}`); },
      onAfterNode: async (name) => { calls.push(`after:${name}`); },
    });
    await flow.runFrom(b, packet({ data: 'x', deps: {}, context: {} }));
    expect(calls).toEqual(['before:nodeB', 'after:nodeB']);
  });

  it('runFrom combined with getNodeByName restores from checkpoint', async () => {
    const visited: string[] = [];
    class NodeA extends Node<any, any, any, any> {
      async run(p: this['In']) {
        visited.push('A');
        return packet({ data: p.data, deps: p.deps, context: p.context });
      }
    }
    class NodeB extends Node<any, any, any, any> {
      async run(p: this['In']) {
        visited.push('B');
        return exit({ data: 'done', deps: p.deps, context: p.context });
      }
    }
    const a = new NodeA('nodeA');
    const b = new NodeB('nodeB');
    a.next(b);
    const flow = makeFlow(a);
    const resumeNode = flow.getNodeByName('nodeB')!;
    expect(resumeNode).toBe(b);
    const out = await flow.runFrom(resumeNode, packet({ data: 'restored', deps: {}, context: {} }));
    expect(visited).toEqual(['B']);
    expect(out.branch).toBe('exit');
    expect(out.data).toBe('done');
  });
});
