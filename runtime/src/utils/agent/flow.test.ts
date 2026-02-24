import { describe, it, expect, vi } from 'vitest';
import { single, batch, exit, error, Node, Flow, type Packet, type NodeOptions } from './flow.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeNode(
  runFn: (p: Packet<any, any, any>) => Promise<Packet<any, any, any>>,
  opts?: {
    preprocess?: (p: Packet<any, any, any>) => Promise<Packet<any, any, any>>;
    postprocess?: (p: Packet<any, any, any>) => Promise<Packet<any, any, any>>;
    fallback?: (p: Packet<any, any, any>, err: Error) => Promise<Packet<any, any, any>>;
    onAbort?: (p: Packet<any, any, any>) => Promise<void>;
    nodeOptions?: NodeOptions;
  },
) {
  class TestNode extends Node<any, any, any, any> {
    preprocess = opts?.preprocess;
    postprocess = opts?.postprocess;
    fallback = opts?.fallback;
    onAbort = opts?.onAbort;
    async run(p: Packet<any, any, any>) {
      return runFn(p);
    }
  }
  return new TestNode(opts?.nodeOptions);
}

function makeFlow(
  start: Node<any, any, any, any>,
  hooks?: {
    onPause?: (p: Packet<any>) => Promise<void>;
    onResume?: (p: Packet<any>) => Promise<void>;
    onExit?: (p: Packet<any>) => Promise<void>;
    onError?: (p: Packet<any>) => Promise<void>;
    onAbort?: (p: Packet<any>) => Promise<void>;
    fallback?: (p: Packet<any>, err: Error) => Promise<Packet<any>>;
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
  }
  return new TestFlow(start, options);
}

// ─── 1. Packet helpers ───────────────────────────────────────────────────────

describe('packet helpers', () => {
  it('single() creates a packet without type field', () => {
    const p = single(42);
    expect(p.data).toBe(42);
    expect((p as any).type).toBeUndefined();
  });

  it('single() passes branch, deps, context', () => {
    const deps = { db: 'mock' };
    const ctx = { n: 1 };
    const p = single('hi', { branch: 'go', deps, context: ctx });
    expect(p).toMatchObject({ data: 'hi', branch: 'go', deps, context: ctx });
  });

  it('batch() creates a packet with type: batch', () => {
    const p = batch([1, 2, 3]);
    expect(p).toEqual({ type: 'batch', data: [1, 2, 3] });
  });

  it('batch() passes branch, deps, context', () => {
    const p = batch([1, 2], { branch: 'x', deps: { a: 1 }, context: { b: 2 } });
    expect(p).toMatchObject({ type: 'batch', data: [1, 2], branch: 'x' });
  });

  it('exit() sets branch: exit', () => {
    const p = exit('done');
    expect(p).toEqual({ data: 'done', branch: 'exit' });
  });

  it('exit() passes deps and context', () => {
    const p = exit('done', { context: { n: 99 } });
    expect(p).toMatchObject({ branch: 'exit', context: { n: 99 } });
  });

  it('error() sets branch: error', () => {
    const p = error('oops');
    expect(p).toEqual({ data: 'oops', branch: 'error' });
  });

  it('error() passes deps and context', () => {
    const p = error('fail', { deps: { svc: 'x' } });
    expect(p).toMatchObject({ branch: 'error', deps: { svc: 'x' } });
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
    const node = makeNode(async (p) => single(p.data + 1));
    const result = await node._exec(single(10));
    expect(result.data).toBe(11);
  });

  it('preprocess is called before run', async () => {
    const order: string[] = [];
    const node = makeNode(
      async (p) => {
        order.push('run');
        return single(p.data);
      },
      {
        preprocess: async (p) => {
          order.push('pre');
          return p;
        },
      },
    );
    await node._exec(single(1));
    expect(order).toEqual(['pre', 'run']);
  });

  it('postprocess is called after run', async () => {
    const order: string[] = [];
    const node = makeNode(
      async (p) => {
        order.push('run');
        return single(p.data);
      },
      {
        postprocess: async (p) => {
          order.push('post');
          return p;
        },
      },
    );
    await node._exec(single(1));
    expect(order).toEqual(['run', 'post']);
  });

  it('pipeline order: preprocess → run → postprocess', async () => {
    const order: string[] = [];
    const node = makeNode(
      async (p) => {
        order.push('run');
        return single((p.data as number) * 2);
      },
      {
        preprocess: async (p) => {
          order.push('pre');
          return single((p.data as number) + 1);
        },
        postprocess: async (p) => {
          order.push('post');
          return p;
        },
      },
    );
    const result = await node._exec(single(3));
    expect(order).toEqual(['pre', 'run', 'post']);
    expect(result.data).toBe(8); // (3+1)*2
  });

  it('postprocess can override branch', async () => {
    const node = makeNode(async (p) => single(p.data), { postprocess: async (p) => ({ ...p, branch: 'custom' }) });
    const result = await node._exec(single('x'));
    expect(result.branch).toBe('custom');
  });

  it('_exec never rejects — errors come back as branch: error', async () => {
    const node = makeNode(async () => {
      throw new Error('boom');
    });
    const result = await node._exec(single('x'));
    expect(result.branch).toBe('error');
    expect(result.data).toBeInstanceOf(Error);
    expect((result.data as Error).message).toBe('boom');
  });

  it('context from preprocess is forwarded to run', async () => {
    const node = makeNode(async (p) => single(p.data, { context: p.context }), {
      preprocess: async (p) => ({ ...p, context: { injected: true } }),
    });
    const result = await node._exec(single('x'));
    expect(result.context).toEqual({ injected: true });
  });

  it('deps pass through unchanged', async () => {
    const deps = { svc: 'test' };
    const node = makeNode(async (p) => single(p.data, { deps: p.deps }));
    const result = await node._exec(single(1, { deps }));
    expect(result.deps).toBe(deps);
  });
});

// ─── 4. Node — batch mode ────────────────────────────────────────────────────

describe('Node — batch mode', () => {
  it('preprocess can switch to batch mode', async () => {
    const node = makeNode(async (p) => single((p.data as number) * 2), { preprocess: async (_p) => batch([1, 2, 3]) });
    const result = await node._exec(single('ignored'));
    expect(result.type).toBe('batch');
    expect(result.data).toEqual([2, 4, 6]);
  });

  it('run is called once per batch item (parallel)', async () => {
    const calls: number[] = [];
    const node = makeNode(async (p) => {
      calls.push(p.data as number);
      return single((p.data as number) + 10);
    });
    const result = await node._exec(batch([1, 2, 3]));
    expect(calls).toHaveLength(3);
    expect(result.type).toBe('batch');
    expect((result.data as number[]).sort()).toEqual([11, 12, 13]);
  });

  it('batch results reassembled into single type:batch packet', async () => {
    const node = makeNode(async (p) => single(String(p.data)));
    const result = await node._exec(batch([7, 8]));
    expect(result).toMatchObject({ type: 'batch', data: ['7', '8'] });
  });

  it('context from individual batch runs is isolated (not merged back)', async () => {
    const node = makeNode(async (p) => single(p.data, { context: { modified: true } }));
    const originalCtx = { count: 0 };
    const result = await node._exec(batch([1, 2], { context: originalCtx }));
    // batch result context is the original preprocessed context, not per-run modifications
    expect(result.context).toBe(originalCtx);
  });

  it('AbortError from one batch item propagates as abort packet', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const node = makeNode(async (p) => {
      if (p.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      return single(p.data);
    });
    const result = await node._exec({ type: 'batch', data: [1, 2], signal: ctrl.signal });
    expect(result.branch).toBe('abort');
  });

  it('postprocess receives reassembled batch result', async () => {
    let postReceived: Packet<any, any, any> | null = null;
    const node = makeNode(async (p) => single((p.data as number) * 10), {
      postprocess: async (p) => {
        postReceived = p;
        return p;
      },
    });
    await node._exec(batch([2, 3]));
    expect(postReceived).not.toBeNull();
    expect((postReceived as any).type).toBe('batch');
    expect((postReceived as any).data).toEqual([20, 30]);
  });

  it('runs batch items in parallel (simultaneous execution)', async () => {
    const startTimes: number[] = [];
    const node = makeNode(async (p) => {
      startTimes.push(Date.now());
      await new Promise((r) => setTimeout(r, 50));
      return single(p.data);
    });
    await node._exec(batch([1, 2, 3]));
    // All started within a short window → parallel
    const spread = Math.max(...startTimes) - Math.min(...startTimes);
    expect(spread).toBeLessThan(30);
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
    const result = await node._exec(single('x'));
    expect(calls).toBe(1);
    expect(result.branch).toBe('error');
  });

  it('retries up to maxRunTries times on failure', async () => {
    let calls = 0;
    const node = makeNode(
      async () => {
        calls++;
        if (calls < 3) throw new Error('retry');
        return single('ok');
      },
      { nodeOptions: { maxRunTries: 3 } },
    );
    const result = await node._exec(single('x'));
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
    const result = await node._exec(single('x'));
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
    await node._exec(single('x'));
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
    const result = await node._exec(single('x'));
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
        return single(p.data);
      },
      { nodeOptions: { maxRunTries: 3, wait: 0 } },
    );
    const result = await node._exec({ data: 'x', signal: ctrl.signal });
    // aborted after first fail, should not retry
    expect(result.branch).toBe('abort');
    expect(calls).toBe(1);
  });
});

describe('Node — timeout', () => {
  it('throws timeout error after specified ms (per attempt)', async () => {
    const node = makeNode(async () => new Promise((r) => setTimeout(r, 200)), { nodeOptions: { timeout: 50 } });
    const result = await node._exec(single('x'));
    expect(result.branch).toBe('error');
    expect((result.data as Error).message).toMatch(/timed out after 50ms/);
  }, 1000);

  it('timeout is per-attempt, not cumulative', async () => {
    let calls = 0;
    const node = makeNode(
      async () => {
        calls++;
        if (calls < 2) return new Promise((r) => setTimeout(r, 200)); // times out
        return single('ok');
      },
      { nodeOptions: { timeout: 50, maxRunTries: 2 } },
    );
    const result = await node._exec(single('x'));
    expect(result.data).toBe('ok');
    expect(calls).toBe(2);
  }, 2000);
});

describe('Node — fallback', () => {
  it('fallback is called when all retries exhausted', async () => {
    const fallbackFn = vi.fn(async (_p: Packet<any>, _err: Error) => exit('recovered'));
    const node = makeNode(
      async () => {
        throw new Error('boom');
      },
      { fallback: fallbackFn, nodeOptions: { maxRunTries: 2 } },
    );
    const result = await node._exec(single('x'));
    expect(fallbackFn).toHaveBeenCalledOnce();
    expect(result.branch).toBe('exit');
    expect(result.data).toBe('recovered');
  });

  it('fallback receives the original input packet', async () => {
    let received: Packet<any> | null = null;
    const node = makeNode(
      async () => {
        throw new Error('x');
      },
      {
        fallback: async (p, _err) => {
          received = p;
          return error('handled');
        },
      },
    );
    const input = single('original-data', { context: { k: 1 } });
    await node._exec(input);
    expect((received as any).data).toBe('original-data');
  });

  it('fallback is called when preprocess throws', async () => {
    const fallbackFn = vi.fn(async () => exit('ok'));
    const node = makeNode(async (p) => single(p.data), {
      preprocess: async () => {
        throw new Error('pre-error');
      },
      fallback: fallbackFn,
    });
    const result = await node._exec(single('x'));
    expect(fallbackFn).toHaveBeenCalledOnce();
    expect(result.branch).toBe('exit');
  });

  it('fallback is called when postprocess throws', async () => {
    const fallbackFn = vi.fn(async () => exit('ok'));
    const node = makeNode(async (p) => single(p.data), {
      postprocess: async () => {
        throw new Error('post-error');
      },
      fallback: fallbackFn,
    });
    const result = await node._exec(single('x'));
    expect(fallbackFn).toHaveBeenCalledOnce();
  });

  it('without fallback, error becomes branch: error packet (neverthrow)', async () => {
    const node = makeNode(async () => {
      throw new Error('raw');
    });
    const result = await node._exec(single('x'));
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
    const result = await node._exec(single('x'));
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
    // Must not reject
    await expect(node._exec(single('x'))).resolves.toMatchObject({ branch: 'abort' });
  });
});

// ─── 6. Flow — traversal ─────────────────────────────────────────────────────

describe('Flow — traversal', () => {
  it('traverses a simple A → B chain', async () => {
    const results: string[] = [];
    const a = makeNode(async (p) => {
      results.push('A');
      return single(p.data, { branch: 'default' });
    });
    const b = makeNode(async (p) => {
      results.push('B');
      return exit(p.data);
    });
    a.next(b);
    const flow = makeFlow(a);
    const out = await flow.run(single('start'));
    expect(results).toEqual(['A', 'B']);
    expect(out.branch).toBe('exit');
  });

  it('signal is injected into every packet', async () => {
    const signals: (AbortSignal | undefined)[] = [];
    const a = makeNode(async (p) => {
      signals.push(p.signal);
      return exit(p.data);
    });
    const flow = makeFlow(a);
    await flow.run(single('x'));
    expect(signals[0]).toBeInstanceOf(AbortSignal);
  });

  it('context from each node is forwarded to the next', async () => {
    const a = makeNode(async (p) => single(p.data, { branch: 'default', context: { step: 1 } }));
    const b = makeNode(async (p) => exit(p.data, { context: { ...((p.context as any) ?? {}), step: 2 } }));
    a.next(b);
    const flow = makeFlow(a);
    const out = await flow.run(single('x'));
    expect(out.context).toMatchObject({ step: 2 });
  });

  it('advances using result.branch', async () => {
    const visited: string[] = [];
    const start = makeNode(async () => {
      visited.push('start');
      return single(1, { branch: 'go' });
    });
    const go = makeNode(async () => {
      visited.push('go');
      return exit(2);
    });
    const skip = makeNode(async () => {
      visited.push('skip');
      return exit(3);
    });
    start.branch('go', go).branch('skip', skip);
    const flow = makeFlow(start);
    await flow.run(single('x'));
    expect(visited).toEqual(['start', 'go']);
  });

  it('returns result as-is when no next node for branch (implicit exit)', async () => {
    const node = makeNode(async () => single('terminal', { branch: 'nowhere' }));
    const flow = makeFlow(node);
    const out = await flow.run(single('x'));
    expect(out.data).toBe('terminal');
    expect(out.branch).toBe('nowhere');
  });

  it('branch: default used when run returns no branch', async () => {
    const a = makeNode(async () => single('result')); // no branch → 'default'
    const b = makeNode(async (p) => exit(p.data));
    a.next(b); // branch('default', b)
    const flow = makeFlow(a);
    const out = await flow.run(single('x'));
    expect(out.branch).toBe('exit');
    expect(out.data).toBe('result');
  });
});

// ─── 7. Flow — reserved branches ─────────────────────────────────────────────

describe('Flow — reserved branches', () => {
  it('exit branch terminates flow and calls onExit', async () => {
    const onExit = vi.fn(async () => {});
    const node = makeNode(async () => exit('done'));
    const flow = makeFlow(node, { onExit });
    const out = await flow.run(single('x'));
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
    const out = await flow.run(single('x'));
    expect(out.branch).toBe('abort');
    expect(onAbort).toHaveBeenCalled();
  });

  it('error branch triggers error chain (terminal if no handler)', async () => {
    const onError = vi.fn(async () => {});
    const node = makeNode(async () => error('bad'));
    const flow = makeFlow(node, { onError });
    const out = await flow.run(single('x'));
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
      return exit(p.data);
    });
    const node = makeNode(async () => {
      visited.push('main');
      return error('fail');
    });
    node.branch('error', handler);
    const flow = makeFlow(node);
    const out = await flow.run(single('x'));
    expect(visited).toEqual(['main', 'handler']);
    expect(out.branch).toBe('exit');
  });

  it('step 2: calls flow.fallback if no error-branch node', async () => {
    const fallbackFn = vi.fn(async () => exit('flow-fallback'));
    const node = makeNode(async () => error('fail'));
    const flow = makeFlow(node, { fallback: fallbackFn });
    const out = await flow.run(single('x'));
    expect(fallbackFn).toHaveBeenCalledOnce();
    expect(out.branch).toBe('exit');
    expect(out.data).toBe('flow-fallback');
  });

  it('step 3: calls onError and returns terminal error packet', async () => {
    const onError = vi.fn(async () => {});
    const node = makeNode(async () => error('terminal'));
    const flow = makeFlow(node, { onError });
    const out = await flow.run(single('x'));
    expect(onError).toHaveBeenCalledOnce();
    expect(out.branch).toBe('error');
  });

  it('error chain: error-branch node → then continues traversal', async () => {
    const visited: string[] = [];
    const final = makeNode(async () => {
      visited.push('final');
      return exit('ok');
    });
    const errHandler = makeNode(async () => {
      visited.push('errHandler');
      return single('recovered');
    });
    errHandler.next(final);
    const start = makeNode(async () => {
      visited.push('start');
      return error('oops');
    });
    start.branch('error', errHandler);
    const flow = makeFlow(start);
    const out = await flow.run(single('x'));
    expect(visited).toEqual(['start', 'errHandler', 'final']);
    expect(out.branch).toBe('exit');
  });

  it('onError hook errors are swallowed', async () => {
    const node = makeNode(async () => error('x'));
    const flow = makeFlow(node, {
      onError: async () => {
        throw new Error('hook exploded');
      },
    });
    await expect(flow.run(single('x'))).resolves.toMatchObject({ branch: 'error' });
  });

  it('flow.error() forced error goes through error chain', async () => {
    // flow.error() is checked at the TOP of the next loop iteration.
    // The node must return a non-terminal packet so the loop continues.
    const onError = vi.fn(async () => {});
    let flowRef: ReturnType<typeof makeFlow>;
    const node = makeNode(async () => {
      flowRef!.error('forced');
      return single('continue'); // no exit — loop continues to top where _errorPending is checked
    });
    const next = makeNode(async () => exit('should-not-reach'));
    node.next(next); // connect so flow routes to next node and loops back to top
    flowRef = makeFlow(node, { onError });
    const out = await flowRef.run(single('x'));
    expect(out.branch).toBe('error');
    expect(onError).toHaveBeenCalledOnce();
  });
});

// ─── 9. Flow — loop guards ────────────────────────────────────────────────────

describe('Flow — loop guards', () => {
  it('per-node maxLoopEntering throws when exceeded', async () => {
    const onError = vi.fn(async () => {});
    const node = makeNode(
      async (p) => single(p.data), // routes to itself via 'default'
      { nodeOptions: { maxLoopEntering: 3 } },
    );
    node.next(node); // self-loop
    const flow = makeFlow(node, { onError });
    const out = await flow.run(single('x'));
    expect(out.branch).toBe('error');
    expect(onError).toHaveBeenCalledOnce();
  });

  it('flow-level maxLoopEntering counts start node re-enterings', async () => {
    const onError = vi.fn(async () => {});
    const node = makeNode(async (p) => single(p.data));
    node.next(node); // loop
    const flow = makeFlow(node, { onError }, { maxLoopEntering: 2 });
    const out = await flow.run(single('x'));
    expect(out.branch).toBe('error');
    expect(onError).toHaveBeenCalledOnce();
  });

  it('loop guard error goes through fallback chain', async () => {
    const fallback = vi.fn(async () => exit('caught'));
    const node = makeNode(async (p) => single(p.data), { nodeOptions: { maxLoopEntering: 1 } });
    node.next(node);
    const flow = makeFlow(node, { fallback });
    const out = await flow.run(single('x'));
    expect(fallback).toHaveBeenCalledOnce();
    expect(out.branch).toBe('exit');
  });
});

// ─── 10. Flow — abort ────────────────────────────────────────────────────────

describe('Flow — abort', () => {
  it('flow.abort() returns branch: abort', async () => {
    let flowRef: ReturnType<typeof makeFlow>;
    const node = makeNode(async () => {
      flowRef!.abort();
      return single('after-abort'); // preempted
    });
    const next = makeNode(async () => exit('next'));
    node.next(next);
    flowRef = makeFlow(node);
    const out = await flowRef.run(single('x'));
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
    await flow.run(single('x'));
    expect(nodeOnAbort).toHaveBeenCalled();
    expect(flowOnAbort).toHaveBeenCalled();
  });

  it('external signal aborts the flow', async () => {
    const ctrl = new AbortController();
    const node = makeNode(async (p) => {
      // After first node we abort externally
      ctrl.abort();
      return single(p.data);
    });
    const next = makeNode(async () => exit('should-not-reach'));
    node.next(next);
    const flow = makeFlow(node, {}, { signal: ctrl.signal });
    const out = await flow.run(single('x'));
    expect(out.branch).toBe('abort');
  });

  it('if signal already aborted at construction, aborts immediately', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const node = makeNode(async () => exit('should-not-run'));
    const flow = makeFlow(node, {}, { signal: ctrl.signal });
    const out = await flow.run(single('x'));
    expect(out.branch).toBe('abort');
  });

  it('abort wakes a paused flow', async () => {
    let flowRef: ReturnType<typeof makeFlow>;
    const a = makeNode(async (p) => single(p.data));
    const b = makeNode(async () => exit('ok'));
    a.next(b);
    flowRef = makeFlow(a);
    const runPromise = flowRef.run(single('x'));
    flowRef.pause();
    // Give the flow time to reach the pause
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
    const a = makeNode(async (p) => single(p.data));
    const b = makeNode(async (p) => exit(p.data));
    a.next(b);
    flowRef = makeFlow(a);
    flowRef.pause();
    const runPromise = flowRef.run(single('payload'));
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
    const a = makeNode(async (p) => single(p.data, { context: { step: 'a' } }));
    const b = makeNode(async (p) => exit(p.data));
    a.next(b);
    flowRef = makeFlow(a, { onPause });
    flowRef.pause();
    const runPromise = flowRef.run(single('x'));
    await new Promise((r) => setTimeout(r, 10));
    expect(onPause).toHaveBeenCalledOnce();
    flowRef.resume();
    await runPromise;
  });

  it('resume(packet) replaces the checkpoint packet', async () => {
    let flowRef: ReturnType<typeof makeFlow>;
    const a = makeNode(async (p) => single(p.data));
    const b = makeNode(async (p) => exit(p.data));
    a.next(b);
    flowRef = makeFlow(a);
    flowRef.pause();
    const runPromise = flowRef.run(single('original'));
    await new Promise((r) => setTimeout(r, 10));
    flowRef.resume(single('injected'));
    const out = await runPromise;
    expect(out.data).toBe('injected');
  });

  it('resume() with no arg reuses checkpoint packet', async () => {
    let flowRef: ReturnType<typeof makeFlow>;
    const a = makeNode(async (p) => single(p.data));
    const b = makeNode(async (p) => exit(p.data));
    a.next(b);
    flowRef = makeFlow(a);
    flowRef.pause();
    const runPromise = flowRef.run(single('checkpoint-data'));
    await new Promise((r) => setTimeout(r, 10));
    flowRef.resume(); // no arg
    const out = await runPromise;
    expect(out.data).toBe('checkpoint-data');
  });

  it('onResume fires only on genuine resume (not on abort wake)', async () => {
    const onResume = vi.fn(async () => {});
    let flowRef: ReturnType<typeof makeFlow>;
    const a = makeNode(async (p) => single(p.data));
    const b = makeNode(async () => exit('ok'));
    a.next(b);
    flowRef = makeFlow(a, { onResume });
    flowRef.pause();
    const runPromise = flowRef.run(single('x'));
    await new Promise((r) => setTimeout(r, 10));
    flowRef.abort(); // wakes via abort, not genuine resume
    await runPromise;
    expect(onResume).not.toHaveBeenCalled();
  });

  it('onResume fires on genuine resume', async () => {
    const onResume = vi.fn(async () => {});
    let flowRef: ReturnType<typeof makeFlow>;
    const a = makeNode(async (p) => single(p.data));
    const b = makeNode(async () => exit('ok'));
    a.next(b);
    flowRef = makeFlow(a, { onResume });
    flowRef.pause();
    const runPromise = flowRef.run(single('x'));
    await new Promise((r) => setTimeout(r, 10));
    flowRef.resume();
    await runPromise;
    expect(onResume).toHaveBeenCalledOnce();
  });

  it('resume() throws if flow is not paused', () => {
    const node = makeNode(async (p) => exit(p.data));
    const flow = makeFlow(node);
    expect(() => flow.resume()).toThrow('Flow is not paused');
  });

  it('exit() while paused wakes and terminates with exit branch', async () => {
    let flowRef: ReturnType<typeof makeFlow>;
    const a = makeNode(async (p) => single(p.data));
    const b = makeNode(async () => exit('ok'));
    a.next(b);
    flowRef = makeFlow(a);
    flowRef.pause();
    const runPromise = flowRef.run(single('x'));
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
        return single(p.data);
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
    const b = makeNode(async () => exit('done'));
    a.next(b);
    flowRef = makeFlow(a);
    flowRef.pause();
    const runPromise = flowRef.run(single('x'));
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual(['pre', 'run', 'post']); // full pipeline before pause
    flowRef.resume();
    await runPromise;
  });
});

// ─── 12. Flow — forced exit ───────────────────────────────────────────────────

describe('Flow — forced exit', () => {
  it('flow.exit() resolves with branch: exit and calls onExit', async () => {
    const onExit = vi.fn(async () => {});
    let flowRef: ReturnType<typeof makeFlow>;
    const node = makeNode(async () => {
      flowRef!.exit();
      return single('ignored');
    });
    const next = makeNode(async () => exit('next'));
    node.next(next);
    flowRef = makeFlow(node, { onExit });
    const out = await flowRef.run(single('x'));
    expect(out.branch).toBe('exit');
    expect(onExit).toHaveBeenCalledOnce();
  });
});

// ─── 13. Flow — Node compatibility (nested flows) ────────────────────────────

describe('Flow — Node compatibility', () => {
  it('a Flow can be used as a node inside another Flow', async () => {
    const inner = makeNode(async () => exit('inner-done'));
    const innerFlow = makeFlow(inner);

    // innerFlow returns exit → no next node, outer flow sees implicit exit
    const outer = makeFlow(innerFlow as unknown as Node<any, any, any, any>);
    const out = await outer.run(single('x'));
    expect(out.branch).toBe('exit');
    expect(out.data).toBe('inner-done');
  });

  it('nested flow abort propagates to outer flow', async () => {
    const innerNode = makeNode(async () => {
      throw new DOMException('Aborted', 'AbortError');
    });
    const innerFlow = makeFlow(innerNode);
    const outerNode = innerFlow as unknown as Node<any, any, any, any>;
    const outer = makeFlow(outerNode);
    const out = await outer.run(single('x'));
    expect(out.branch).toBe('abort');
  });

  it('maxLoopEntering on Flow used as node counts outer entering', async () => {
    // The outer flow checks innerFlow.options.maxLoopEntering each time it enters that node.
    // Inner flow must NOT return 'exit' (that would terminate the outer flow).
    // Inner flow returns single() → no next node inside → implicit return (branch: undefined).
    // Outer flow then routes via innerFlow.branches('default') back to looper → loop.
    const onError = vi.fn(async () => {});
    const innerNode = makeNode(async (p) => single(p.data)); // no exit — inner flow returns implicitly
    const innerFlow = makeFlow(innerNode, {}, { maxLoopEntering: 1 });

    const looper = makeNode(async (p) => single(p.data));
    looper.next(innerFlow as unknown as Node<any, any, any, any>);
    (innerFlow as unknown as Node<any, any, any, any>).next(looper); // looper → innerFlow → looper

    const outer = makeFlow(looper, { onError });
    const out = await outer.run(single('x'));
    // innerFlow entered twice → 2 > maxLoopEntering(1) → guard throws → onError
    expect(out.branch).toBe('error');
    expect(onError).toHaveBeenCalledOnce();
  });
});

// ─── 14. Flow — lifecycle hooks swallow errors ───────────────────────────────

describe('Flow — lifecycle hooks swallow their own errors', () => {
  it('onExit error is swallowed', async () => {
    const node = makeNode(async () => exit('done'));
    const flow = makeFlow(node, {
      onExit: async () => {
        throw new Error('onExit boom');
      },
    });
    await expect(flow.run(single('x'))).resolves.toMatchObject({ branch: 'exit' });
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
    await expect(flow.run(single('x'))).resolves.toMatchObject({ branch: 'abort' });
  });

  it('onPause error is swallowed', async () => {
    let flowRef: ReturnType<typeof makeFlow>;
    const a = makeNode(async (p) => single(p.data));
    const b = makeNode(async () => exit('ok'));
    a.next(b);
    flowRef = makeFlow(a, {
      onPause: async () => {
        throw new Error('onPause boom');
      },
    });
    flowRef.pause();
    const runPromise = flowRef.run(single('x'));
    await new Promise((r) => setTimeout(r, 10));
    flowRef.resume();
    await expect(runPromise).resolves.toMatchObject({ branch: 'exit' });
  });
});

// ─── 15. Edge Cases & Additional Coverage ────────────────────────────────────

describe('Edge Cases & Additional Coverage', () => {
  it('handles empty batch correctly', async () => {
    const node = makeNode(async (p) => single(p.data));
    const result = await node._exec(batch([]));
    expect(result.type).toBe('batch');
    expect(result.data).toEqual([]);
  });

  it('nested flow error is routed to "error" branch in outer flow', async () => {
    // Inner flow that fails
    const innerNode = makeNode(async () => error('inner-fail'));
    const innerFlow = makeFlow(innerNode);

    // Outer flow: innerFlow -> (error) -> handler
    const handler = makeNode(async () => exit('handled-inner-error'));
    (innerFlow as unknown as Node<any, any, any, any>).branch('error', handler);

    const outerFlow = makeFlow(innerFlow as unknown as Node<any, any, any, any>);
    const result = await outerFlow.run(single('start'));

    expect(result.branch).toBe('exit');
    expect(result.data).toBe('handled-inner-error');
  });

  it('abort during preprocess prevents run execution', async () => {
    const ctrl = new AbortController();
    const runFn = vi.fn(async (p) => single(p.data));

    const node = makeNode(runFn, {
      preprocess: async (p) => {
        ctrl.abort(); // Trigger abort
        return p;
      },
    });

    // _runWithRetry checks signal before calling run(), so runFn should not be called
    const result = await node._exec({ ...single('x'), signal: ctrl.signal });

    expect(result.branch).toBe('abort');
    expect(runFn).not.toHaveBeenCalled();
  });
});
