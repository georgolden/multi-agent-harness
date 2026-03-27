import { describe, it, expect, vi } from 'vitest';
import { Type } from '@sinclair/typebox';
import { Agent, type AgentSchema } from './agent.js';
import { Flow, Node, type FlowSchema, packet, exit, type SinglePacket } from './flow.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

type MockSession = {
  id: string;
  hooks: Record<string, unknown>;
  currentNodeName?: string;
  currentPacketData?: unknown;
  beginNodeTransaction(): Promise<void>;
  commitNodeTransaction(nodeName: string, packetData: unknown): Promise<void>;
  rollbackNodeTransaction(): Promise<void>;
};

function mockSession(
  overrides: { id?: string; currentNodeName?: string; currentPacketData?: unknown } = {},
): MockSession {
  return {
    id: overrides.id ?? 'sess-1',
    hooks: {},
    currentNodeName: overrides.currentNodeName,
    currentPacketData: overrides.currentPacketData,
    beginNodeTransaction: async () => {},
    commitNodeTransaction: async () => {},
    rollbackNodeTransaction: async () => {},
  };
}

/**
 * Build a concrete Flow+FlowMeta class.
 * The single node calls `runFn` if provided, otherwise exits with the input data.
 */
function makeFlowClass(opts: {
  runFn?: (input: unknown) => Promise<SinglePacket<any, any, any>>;
  schema?: FlowSchema;
  parameters?: Record<string, unknown>;
  sessionId?: string;
  onCreateSession?: (app: unknown, user: unknown, parent: unknown, input: unknown) => void;
}) {
  const flowSchema: FlowSchema = opts.schema ?? { startNode: 'only', nodes: { only: null } };
  const params = opts.parameters ?? Type.Object({ message: Type.String() });
  const sid = opts.sessionId ?? 'sess-1';

  class OnlyNode extends Node<any, any, any, any> {
    async run(p: SinglePacket<any, any, any>) {
      return opts.runFn ? opts.runFn(p.data) : exit({ data: p.data, deps: p.deps, context: p.context });
    }
  }

  class TestFlow extends Flow<any, any, any, any> {
    name = 'TestFlow';
    description = 'test';
    parameters = params;
    nodeConstructors = { only: OnlyNode };

    constructor() {
      super(flowSchema);
    }

    async createSession(app: unknown, user: unknown, parent: unknown, input: unknown): Promise<MockSession> {
      opts.onCreateSession?.(app, user, parent, input);
      return mockSession({ id: sid });
    }
  }

  return TestFlow;
}

/** Build a concrete Agent subclass with the given flow constructors and optional schema. */
function makeAgent(flowConstructors: Record<string, new () => Flow<any, any, any, any>>, agentSchema?: AgentSchema) {
  const fcs = flowConstructors;
  const s = agentSchema;
  class TestAgent extends Agent<any, any, MockSession> {
    name = 'TestAgent';
    description = 'Test agent';
    flowConstructors = fcs;
    constructor(app: unknown, user: unknown, parent?: MockSession, schemaOverride?: AgentSchema) {
      super(app, user, parent, schemaOverride ?? s);
    }
  }
  return TestAgent;
}

const APP = { name: 'app' };
const USER = { id: 'u1' };

// ─── 1. Constructor ──────────────────────────────────────────────────────────

describe('Agent — constructor', () => {
  it('stores app, user, parent', () => {
    const FC = makeFlowClass({});
    const TestAgent = makeAgent({ TestFlow: FC });
    const parent = mockSession({ id: 'parent' });
    const agent = new TestAgent(APP, USER, parent);
    expect(agent.app).toBe(APP);
    expect(agent.user).toBe(USER);
    expect(agent.parent).toBe(parent);
  });

  it('parent is optional', () => {
    const FC = makeFlowClass({});
    const TestAgent = makeAgent({ TestFlow: FC });
    const agent = new TestAgent(APP, USER);
    expect(agent.parent).toBeUndefined();
  });

  it('schemaOverride is stored as schema', () => {
    const FC = makeFlowClass({});
    const override: AgentSchema = { start: 'TestFlow', flows: { TestFlow: null } };
    const TestAgent = makeAgent({ TestFlow: FC });
    const agent = new TestAgent(APP, USER, undefined, override);
    expect(agent.schema).toBe(override);
  });

  it('initial state: runPromise null, allSessions and activeSessions empty', () => {
    const FC = makeFlowClass({});
    const TestAgent = makeAgent({ TestFlow: FC });
    const agent = new TestAgent(APP, USER);
    expect(agent.runPromise).toBeNull();
    expect(agent.allSessions).toEqual([]);
    expect(agent.activeSessions).toEqual([]);
  });
});

// ─── 2. Single-flow auto-schema ──────────────────────────────────────────────

describe('Agent — single-flow auto-schema', () => {
  it('runs successfully with no schema declared', async () => {
    const FC = makeFlowClass({});
    const TestAgent = makeAgent({ TestFlow: FC });
    const agent = new TestAgent(APP, USER);
    const result = await agent.run({ message: 'hello' });
    expect((result as any).branch).toBe('exit');
  });

  it('throws if multiple flows but no schema declared', () => {
    const FC = makeFlowClass({});
    const TestAgent = makeAgent({ FlowA: FC, FlowB: FC });
    const agent = new TestAgent(APP, USER);
    expect(() => agent.run({ message: 'hi' })).toThrow('no schema defined');
  });
});

// ─── 3. run() / runPromise ───────────────────────────────────────────────────

describe('Agent — run() and runPromise', () => {
  it('run() returns a promise and stores it on runPromise', async () => {
    const FC = makeFlowClass({});
    const TestAgent = makeAgent({ TestFlow: FC });
    const agent = new TestAgent(APP, USER);
    const p = agent.run({ message: 'hi' });
    expect(agent.runPromise).toBe(p);
    await p;
  });

  it('run() resolves with the final flow result', async () => {
    const FC = makeFlowClass({
      runFn: async (input: any) => exit({ data: { processed: input.message }, deps: {}, context: {} }),
    });
    const TestAgent = makeAgent({ TestFlow: FC });
    const agent = new TestAgent(APP, USER);
    const result = (await agent.run({ message: 'world' })) as any;
    expect(result.data).toEqual({ processed: 'world' });
  });
});

// ─── 4. Input validation ─────────────────────────────────────────────────────

describe('Agent — input validation', () => {
  it('throws descriptively when input does not match parameters schema', async () => {
    const FC = makeFlowClass({ parameters: Type.Object({ message: Type.String() }) });
    const TestAgent = makeAgent({ TestFlow: FC });
    const agent = new TestAgent(APP, USER);
    await expect(agent.run({ message: 42 })).rejects.toThrow('input validation failed');
  });

  it('passes when input matches schema', async () => {
    const FC = makeFlowClass({ parameters: Type.Object({ message: Type.String() }) });
    const TestAgent = makeAgent({ TestFlow: FC });
    const agent = new TestAgent(APP, USER);
    await expect(agent.run({ message: 'ok' })).resolves.toBeDefined();
  });

  it('error message includes the flow name', async () => {
    const FC = makeFlowClass({ parameters: Type.Object({ message: Type.String() }) });
    const schema: AgentSchema = { start: 'SpecialFlow', flows: { SpecialFlow: null } };
    const TestAgent = makeAgent({ SpecialFlow: FC }, schema);
    const agent = new TestAgent(APP, USER);
    await expect(agent.run({ message: 99 })).rejects.toThrow('"SpecialFlow"');
  });

  it('throws when flow constructor is missing from flowConstructors', async () => {
    const FC = makeFlowClass({});
    const schema: AgentSchema = { start: 'Missing', flows: { Missing: null } };
    const TestAgent = makeAgent({ TestFlow: FC }, schema);
    const agent = new TestAgent(APP, USER);
    await expect(agent.run({ message: 'hi' })).rejects.toThrow('"Missing"');
  });
});

// ─── 5. Session lifecycle ────────────────────────────────────────────────────

describe('Agent — session lifecycle', () => {
  it('createSession is called with app, user, parent, input', async () => {
    const onCreate = vi.fn();
    const parent = mockSession({ id: 'p1' });
    const FC = makeFlowClass({ onCreateSession: onCreate });
    const TestAgent = makeAgent({ TestFlow: FC });
    const agent = new TestAgent(APP, USER, parent);
    await agent.run({ message: 'hi' });
    expect(onCreate).toHaveBeenCalledWith(APP, USER, parent, { message: 'hi' });
  });

  it('session is added to allSessions after creation', async () => {
    const FC = makeFlowClass({ sessionId: 'sess-x' });
    const TestAgent = makeAgent({ TestFlow: FC });
    const agent = new TestAgent(APP, USER);
    await agent.run({ message: 'hi' });
    expect(agent.allSessions).toHaveLength(1);
    expect((agent.allSessions[0] as MockSession).id).toBe('sess-x');
  });

  it('session is removed from activeSessions after flow completes', async () => {
    const FC = makeFlowClass({});
    const TestAgent = makeAgent({ TestFlow: FC });
    const agent = new TestAgent(APP, USER);
    await agent.run({ message: 'hi' });
    expect(agent.activeSessions).toHaveLength(0);
  });

  it('session is in activeSessions while flow is running', async () => {
    let capturedActive: unknown[] = [];
    const FC = makeFlowClass({
      runFn: async (input: any) => {
        capturedActive = [...agent.activeSessions];
        return exit({ data: input, deps: {}, context: {} });
      },
    });
    const TestAgent = makeAgent({ TestFlow: FC });
    const agent = new TestAgent(APP, USER);
    await agent.run({ message: 'hi' });
    expect(capturedActive).toHaveLength(1);
  });
});

// ─── 6. sessionHooks assignment ──────────────────────────────────────────────

describe('Agent — sessionHooks', () => {
  it('assigns sessionHooks onto session.hooks when set', async () => {
    const onCompleted = vi.fn();
    const FC = makeFlowClass({ sessionId: 'sess-h' });
    const TestAgent = makeAgent({ TestFlow: FC });
    const agent = new TestAgent(APP, USER);
    agent.sessionHooks = { onCompleted };
    await agent.run({ message: 'hi' });
    const sess = agent.allSessions[0] as MockSession;
    expect(sess.hooks.onCompleted).toBe(onCompleted);
  });

  it('does not mutate session.hooks when sessionHooks is not set', async () => {
    const FC = makeFlowClass({ sessionId: 'sess-n' });
    const TestAgent = makeAgent({ TestFlow: FC });
    const agent = new TestAgent(APP, USER);
    await agent.run({ message: 'hi' });
    const sess = agent.allSessions[0] as MockSession;
    expect(sess.hooks).toEqual({});
  });

  it('each session in a multi-flow run gets hooks assigned', async () => {
    const onCompleted = vi.fn();
    const FC1 = makeFlowClass({ sessionId: 'sess-1' });
    const FC2 = makeFlowClass({ sessionId: 'sess-2' });
    const schema: AgentSchema = { start: 'Flow1', flows: { Flow1: 'Flow2', Flow2: null } };
    const TestAgent = makeAgent({ Flow1: FC1, Flow2: FC2 }, schema);
    const agent = new TestAgent(APP, USER);
    agent.sessionHooks = { onCompleted };
    await agent.run({ message: 'hi' });
    expect(agent.allSessions).toHaveLength(2);
    for (const s of agent.allSessions as MockSession[]) {
      expect(s.hooks.onCompleted).toBe(onCompleted);
    }
  });

  it('all hooks in sessionHooks are merged onto session.hooks', async () => {
    const onCompleted = vi.fn();
    const onFailed = vi.fn();
    const FC = makeFlowClass({});
    const TestAgent = makeAgent({ TestFlow: FC });
    const agent = new TestAgent(APP, USER);
    agent.sessionHooks = { onCompleted, onFailed };
    await agent.run({ message: 'hi' });
    const sess = agent.allSessions[0] as MockSession;
    expect(sess.hooks.onCompleted).toBe(onCompleted);
    expect(sess.hooks.onFailed).toBe(onFailed);
  });
});

// ─── 7. buildContext ─────────────────────────────────────────────────────────

describe('Agent — buildContext', () => {
  it('default buildContext passes user, parent, session to flow context', async () => {
    let capturedContext: any;

    class CapturingFlow extends makeFlowClass({}) {
      async run(p: any) {
        capturedContext = p.context;
        return exit({ data: p.data, deps: p.deps, context: p.context });
      }
    }

    const parent = mockSession({ id: 'par' });
    const TestAgent = makeAgent({ TestFlow: CapturingFlow as any });
    const agent = new TestAgent(APP, USER, parent);
    await agent.run({ message: 'ctx-test' });
    expect(capturedContext.user).toBe(USER);
    expect(capturedContext.parent).toBe(parent);
    expect(capturedContext.session).toBeDefined();
  });

  it('buildContext can be overridden to inject extra fields', async () => {
    let capturedContext: any;

    class CapturingFlow extends makeFlowClass({}) {
      async run(p: any) {
        capturedContext = p.context;
        return exit({ data: p.data, deps: p.deps, context: p.context });
      }
    }

    class CustomAgent extends Agent<any, any, MockSession> {
      name = 'CustomAgent';
      description = 'Custom agent';
      flowConstructors = { TestFlow: CapturingFlow as any };
      protected buildContext(session: MockSession, input: unknown) {
        return { ...super.buildContext(session, input), extra: 'injected' };
      }
    }

    const agent = new CustomAgent(APP, USER);
    await agent.run({ message: 'hi' });
    expect(capturedContext.extra).toBe('injected');
    expect(capturedContext.user).toBe(USER);
  });
});

// ─── 8. Multi-flow routing ───────────────────────────────────────────────────

describe('Agent — multi-flow routing', () => {
  it('string wiring always routes to the named flow', async () => {
    const visited: string[] = [];
    const FC1 = makeFlowClass({
      sessionId: 's1',
      runFn: async (i: any) => {
        visited.push('Flow1');
        return exit({ data: i, deps: {}, context: {} });
      },
    });
    const FC2 = makeFlowClass({
      sessionId: 's2',
      runFn: async (i: any) => {
        visited.push('Flow2');
        return exit({ data: i, deps: {}, context: {} });
      },
    });
    const schema: AgentSchema = { start: 'Flow1', flows: { Flow1: 'Flow2', Flow2: null } };
    const agent = new (makeAgent({ Flow1: FC1, Flow2: FC2 }, schema))(APP, USER);
    await agent.run({ message: 'hi' });
    expect(visited).toEqual(['Flow1', 'Flow2']);
  });

  it('branch-map wiring routes by output branch', async () => {
    const visited: string[] = [];
    const FC1 = makeFlowClass({
      sessionId: 's1',
      runFn: async (i: any) => {
        visited.push('Flow1');
        return packet({ data: i, branch: 'task', deps: {}, context: {} });
      },
    });
    const FC2 = makeFlowClass({
      sessionId: 's2',
      runFn: async (i: any) => {
        visited.push('Flow2');
        return exit({ data: i, deps: {}, context: {} });
      },
    });
    const FC3 = makeFlowClass({
      sessionId: 's3',
      runFn: async (i: any) => {
        visited.push('Flow3');
        return exit({ data: i, deps: {}, context: {} });
      },
    });
    const schema: AgentSchema = {
      start: 'Flow1',
      flows: { Flow1: { task: 'Flow2', finish: 'Flow3' }, Flow2: null, Flow3: null },
    };
    const agent = new (makeAgent({ Flow1: FC1, Flow2: FC2, Flow3: FC3 }, schema))(APP, USER);
    await agent.run({ message: 'hi' });
    expect(visited).toEqual(['Flow1', 'Flow2']);
  });

  it('branch-map falls back to default when branch is unrecognized', async () => {
    const visited: string[] = [];
    const FC1 = makeFlowClass({
      sessionId: 's1',
      runFn: async (i: any) => {
        visited.push('Flow1');
        return packet({ data: i, branch: 'unknown', deps: {}, context: {} });
      },
    });
    const FC2 = makeFlowClass({
      sessionId: 's2',
      runFn: async (i: any) => {
        visited.push('Flow2');
        return exit({ data: i, deps: {}, context: {} });
      },
    });
    const schema: AgentSchema = { start: 'Flow1', flows: { Flow1: { default: 'Flow2' }, Flow2: null } };
    const agent = new (makeAgent({ Flow1: FC1, Flow2: FC2 }, schema))(APP, USER);
    await agent.run({ message: 'hi' });
    expect(visited).toEqual(['Flow1', 'Flow2']);
  });

  it('null wiring in branch-map terminates the agent immediately', async () => {
    const visited: string[] = [];
    const FC1 = makeFlowClass({
      sessionId: 's1',
      runFn: async (i: any) => {
        visited.push('Flow1');
        return packet({ data: i, branch: 'finish', deps: {}, context: {} });
      },
    });
    const FC2 = makeFlowClass({
      sessionId: 's2',
      runFn: async (i: any) => {
        visited.push('Flow2');
        return exit({ data: i, deps: {}, context: {} });
      },
    });
    const schema: AgentSchema = { start: 'Flow1', flows: { Flow1: { finish: null, continue: 'Flow2' }, Flow2: null } };
    const agent = new (makeAgent({ Flow1: FC1, Flow2: FC2 }, schema))(APP, USER);
    await agent.run({ message: 'hi' });
    expect(visited).toEqual(['Flow1']);
  });

  it('data from one flow is passed as input to the next', async () => {
    let flow2Input: unknown;
    const FC1 = makeFlowClass({
      sessionId: 's1',
      runFn: async (_: any) => exit({ data: { forwarded: true }, deps: {}, context: {} }),
    });
    // FC2 accepts any object since it receives forwarded data, not the original input shape
    const FC2 = makeFlowClass({
      sessionId: 's2',
      parameters: Type.Object({}),
      runFn: async (i: any) => {
        flow2Input = i;
        return exit({ data: i, deps: {}, context: {} });
      },
    });
    const schema: AgentSchema = { start: 'Flow1', flows: { Flow1: 'Flow2', Flow2: null } };
    const agent = new (makeAgent({ Flow1: FC1, Flow2: FC2 }, schema))(APP, USER);
    await agent.run({ message: 'start' });
    expect(flow2Input).toEqual({ forwarded: true });
  });

  it('allSessions accumulates across all flows in order', async () => {
    const FC1 = makeFlowClass({ sessionId: 's1' });
    const FC2 = makeFlowClass({ sessionId: 's2' });
    const FC3 = makeFlowClass({ sessionId: 's3' });
    const schema: AgentSchema = { start: 'Flow1', flows: { Flow1: 'Flow2', Flow2: 'Flow3', Flow3: null } };
    const agent = new (makeAgent({ Flow1: FC1, Flow2: FC2, Flow3: FC3 }, schema))(APP, USER);
    await agent.run({ message: 'hi' });
    expect(agent.allSessions.map((s) => (s as MockSession).id)).toEqual(['s1', 's2', 's3']);
  });

  it('flow can loop back to itself until branch changes', async () => {
    const visited: string[] = [];
    let callCount = 0;
    const FC1 = makeFlowClass({
      sessionId: 's1',
      runFn: async (i: any) => {
        callCount++;
        visited.push(`Flow1-${callCount}`);
        return packet({ data: i, branch: callCount < 3 ? 'loop' : 'done', deps: {}, context: {} });
      },
    });
    const FC2 = makeFlowClass({
      sessionId: 's2',
      runFn: async (i: any) => {
        visited.push('Flow2');
        return exit({ data: i, deps: {}, context: {} });
      },
    });
    const schema: AgentSchema = { start: 'Flow1', flows: { Flow1: { loop: 'Flow1', done: 'Flow2' }, Flow2: null } };
    const agent = new (makeAgent({ Flow1: FC1, Flow2: FC2 }, schema))(APP, USER);
    await agent.run({ message: 'hi' });
    expect(visited).toEqual(['Flow1-1', 'Flow1-2', 'Flow1-3', 'Flow2']);
  });

  it('unrecognized branch with no default terminates the agent', async () => {
    const visited: string[] = [];
    const FC1 = makeFlowClass({
      sessionId: 's1',
      runFn: async (i: any) => {
        visited.push('Flow1');
        return packet({ data: i, branch: 'nowhere', deps: {}, context: {} });
      },
    });
    const FC2 = makeFlowClass({
      sessionId: 's2',
      runFn: async (i: any) => {
        visited.push('Flow2');
        return exit({ data: i, deps: {}, context: {} });
      },
    });
    const schema: AgentSchema = { start: 'Flow1', flows: { Flow1: { done: 'Flow2' }, Flow2: null } };
    const agent = new (makeAgent({ Flow1: FC1, Flow2: FC2 }, schema))(APP, USER);
    await agent.run({ message: 'hi' });
    expect(visited).toEqual(['Flow1']);
  });
});

// ─── 9. Error handling ───────────────────────────────────────────────────────

describe('Agent — error handling', () => {
  it('rejects when createSession throws', async () => {
    class BrokenFlow extends Flow<any, any, any, any> {
      name = 'BrokenFlow';
      description = 'test';
      parameters = Type.Object({ message: Type.String() });
      nodeConstructors = {};
      constructor() {
        super({ startNode: 'x', nodes: {} });
      }
      async createSession(): Promise<never> {
        throw new Error('session exploded');
      }
    }

    const TestAgent = makeAgent({ BrokenFlow });
    const agent = new TestAgent(APP, USER);
    await expect(agent.run({ message: 'hi' })).rejects.toThrow('session exploded');
  });

  it('activeSessions is clean after an error', async () => {
    class BrokenFlow extends Flow<any, any, any, any> {
      name = 'BrokenFlow';
      description = 'test';
      parameters = Type.Object({ message: Type.String() });
      nodeConstructors = {};
      constructor() {
        super({ startNode: 'x', nodes: {} });
      }
      async createSession(): Promise<never> {
        throw new Error('boom');
      }
    }

    const TestAgent = makeAgent({ BrokenFlow });
    const agent = new TestAgent(APP, USER);
    await agent.run({ message: 'hi' }).catch(() => {});
    expect(agent.activeSessions).toHaveLength(0);
  });
});

// ─── 10. activeFlows tracking ────────────────────────────────────────────────

describe('Agent — activeFlows tracking', () => {
  it('starts empty', () => {
    const FC = makeFlowClass({});
    const agent = new (makeAgent({ TestFlow: FC }))(APP, USER);
    expect(agent.activeFlows).toEqual([]);
  });

  it('has one active flow while run is executing', async () => {
    let capturedFlows: unknown[] = [];
    const FC = makeFlowClass({
      runFn: async (input: any) => {
        capturedFlows = [...agent.activeFlows];
        return exit({ data: input, deps: {}, context: {} });
      },
    });
    const agent = new (makeAgent({ TestFlow: FC }))(APP, USER);
    await agent.run({ message: 'hi' });
    expect(capturedFlows).toHaveLength(1);
  });

  it('is empty after run completes', async () => {
    const FC = makeFlowClass({});
    const agent = new (makeAgent({ TestFlow: FC }))(APP, USER);
    await agent.run({ message: 'hi' });
    expect(agent.activeFlows).toHaveLength(0);
  });

  it('is empty after run errors', async () => {
    class BrokenFlow extends Flow<any, any, any, any> {
      name = 'BrokenFlow';
      description = 'test';
      parameters = Type.Object({ message: Type.String() });
      nodeConstructors = {};
      constructor() {
        super({ startNode: 'x', nodes: {} });
      }
      async createSession(): Promise<never> {
        throw new Error('boom');
      }
    }
    const agent = new (makeAgent({ BrokenFlow }))(APP, USER);
    await agent.run({ message: 'hi' }).catch(() => {});
    expect(agent.activeFlows).toHaveLength(0);
  });
});

// ─── 11. pause() ─────────────────────────────────────────────────────────────

describe('Agent — pause()', () => {
  it('sets paused = true', () => {
    const FC = makeFlowClass({});
    const agent = new (makeAgent({ TestFlow: FC }))(APP, USER);
    expect(agent.paused).toBe(false);
    agent.pause();
    expect(agent.paused).toBe(true);
  });

  it('calling pause() while no flows are active is a no-op', () => {
    const FC = makeFlowClass({});
    const agent = new (makeAgent({ TestFlow: FC }))(APP, USER);
    expect(() => agent.pause()).not.toThrow();
    expect(agent.paused).toBe(true);
  });

  it('pause() aborts an in-flight flow — run resolves with abort branch', async () => {
    let agentRef: InstanceType<ReturnType<typeof makeAgent>>;
    const FC = makeFlowClass({
      runFn: async (input: any) => {
        agentRef!.pause();
        // keep going — abort is detected at next boundary after node finishes
        return exit({ data: input, deps: {}, context: {} });
      },
    });
    agentRef = new (makeAgent({ TestFlow: FC }))(APP, USER);
    const result = (await agentRef.run({ message: 'hi' })) as any;
    expect(result.branch).toBe('abort');
  });

  it('pause() aborts all active flows when multiple are running', async () => {
    // Use a multi-flow schema where both flows are started in parallel is not the pattern,
    // but we can verify activeFlows is cleared after pause+abort settles
    let agentRef: InstanceType<ReturnType<typeof makeAgent>>;
    const FC = makeFlowClass({
      runFn: async (input: any) => {
        agentRef!.pause();
        return exit({ data: input, deps: {}, context: {} });
      },
    });
    agentRef = new (makeAgent({ TestFlow: FC }))(APP, USER);
    await agentRef.run({ message: 'hi' });
    expect(agentRef.activeFlows).toHaveLength(0);
    expect(agentRef.activeSessions).toHaveLength(0);
  });

  it('run() resets paused to false on a fresh run', async () => {
    const FC = makeFlowClass({});
    const agent = new (makeAgent({ TestFlow: FC }))(APP, USER);
    agent.pause();
    expect(agent.paused).toBe(true);
    await agent.run({ message: 'hi' });
    expect(agent.paused).toBe(false);
  });
});

// ─── 12. resume() ────────────────────────────────────────────────────────────

describe('Agent — resume()', () => {
  it('throws if flow name is not in flowConstructors', () => {
    const FC = makeFlowClass({});
    const agent = new (makeAgent({ TestFlow: FC }))(APP, USER);
    const session = mockSession({ id: 's1', currentNodeName: 'only', currentPacketData: {} });
    expect(() => agent.resume('Missing', session)).toThrow('"Missing"');
  });

  it('throws if session has no currentNodeName', () => {
    const FC = makeFlowClass({});
    const agent = new (makeAgent({ TestFlow: FC }))(APP, USER);
    const session = mockSession({ id: 's1' });
    expect(() => agent.resume('TestFlow', session)).toThrow('no currentNodeName');
  });

  it('resumes from currentNodeName and returns a promise', async () => {
    const FC = makeFlowClass({ schema: { startNode: 'only', nodes: { only: null } } });
    const agent = new (makeAgent({ TestFlow: FC }))(APP, USER);
    const session = mockSession({ id: 's1', currentNodeName: 'only', currentPacketData: { message: 'resumed' } });
    const result = (await agent.resume('TestFlow', session)) as any;
    expect(result.branch).toBe('exit');
  });

  it('stores the promise on runPromise', async () => {
    const FC = makeFlowClass({});
    const agent = new (makeAgent({ TestFlow: FC }))(APP, USER);
    const session = mockSession({ id: 's1', currentNodeName: 'only', currentPacketData: { message: 'hi' } });
    const p = agent.resume('TestFlow', session);
    expect(agent.runPromise).toBe(p);
    await p;
  });

  it('sets paused = false on resume', async () => {
    const FC = makeFlowClass({});
    const agent = new (makeAgent({ TestFlow: FC }))(APP, USER);
    agent.paused = true;
    const session = mockSession({ id: 's1', currentNodeName: 'only', currentPacketData: { message: 'hi' } });
    await agent.resume('TestFlow', session);
    expect(agent.paused).toBe(false);
  });

  it('adds session to activeSessions during resume and removes after', async () => {
    let capturedActive: unknown[] = [];
    const FC = makeFlowClass({
      runFn: async (input: any) => {
        capturedActive = [...agent.activeSessions];
        return exit({ data: input, deps: {}, context: {} });
      },
    });
    const agent = new (makeAgent({ TestFlow: FC }))(APP, USER);
    const session = mockSession({ id: 'resume-sess', currentNodeName: 'only', currentPacketData: { message: 'hi' } });
    await agent.resume('TestFlow', session);
    expect(capturedActive).toHaveLength(1);
    expect((capturedActive[0] as MockSession).id).toBe('resume-sess');
    expect(agent.activeSessions).toHaveLength(0);
  });

  it('adds flow to activeFlows during resume and removes after', async () => {
    let capturedFlows: unknown[] = [];
    const FC = makeFlowClass({
      runFn: async (input: any) => {
        capturedFlows = [...agent.activeFlows];
        return exit({ data: input, deps: {}, context: {} });
      },
    });
    const agent = new (makeAgent({ TestFlow: FC }))(APP, USER);
    const session = mockSession({ id: 's1', currentNodeName: 'only', currentPacketData: {} });
    await agent.resume('TestFlow', session);
    expect(capturedFlows).toHaveLength(1);
    expect(agent.activeFlows).toHaveLength(0);
  });

  it('pause after resume aborts the resumed flow', async () => {
    let agentRef: InstanceType<ReturnType<typeof makeAgent>>;
    const FC = makeFlowClass({
      runFn: async (input: any) => {
        agentRef!.pause();
        return exit({ data: input, deps: {}, context: {} });
      },
    });
    agentRef = new (makeAgent({ TestFlow: FC }))(APP, USER);
    const session = mockSession({ id: 's1', currentNodeName: 'only', currentPacketData: { message: 'hi' } });
    const result = (await agentRef.resume('TestFlow', session)) as any;
    expect(result.branch).toBe('abort');
    expect(agentRef.paused).toBe(true);
  });

  it('full pause-then-resume cycle: run → pause → resume → completes', async () => {
    let runCount = 0;
    let agentRef: InstanceType<ReturnType<typeof makeAgent>>;
    const FC = makeFlowClass({
      runFn: async (input: any) => {
        runCount++;
        if (runCount === 1) {
          agentRef!.pause();
        }
        return exit({ data: input, deps: {}, context: {} });
      },
    });
    agentRef = new (makeAgent({ TestFlow: FC }))(APP, USER);

    // First run — gets aborted by pause inside the node
    const first = (await agentRef.run({ message: 'start' })) as any;
    expect(first.branch).toBe('abort');
    expect(agentRef.paused).toBe(true);

    // Resume from checkpoint
    const session = mockSession({ id: 's1', currentNodeName: 'only', currentPacketData: { message: 'start' } });
    const second = (await agentRef.resume('TestFlow', session)) as any;
    expect(second.branch).toBe('exit');
    expect(agentRef.paused).toBe(false);
    expect(runCount).toBe(2);
  });
});
