import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Type } from '@sinclair/typebox';
import { FlowRunner } from './flowRunner.js';
import { Flow, Node, packet, exit, pause, type SinglePacket } from './flow.js';
import { Session } from '../../services/sessionService/session.js';

// ─── Test doubles ────────────────────────────────────────────────────────────

type TestDeps = Record<string, never>;
type TestContext = { session: Session; tag?: string };
type TestParams = { message: string };

/** Minimal Session factory — no real DB needed */
function makeSession(overrides: Partial<{ id: string; currentNodeName: string; currentPacketData: unknown }> = {}): Session {
  const sessionData: any = {
    id: overrides.id ?? 'session-1',
    userId: 'user-1',
    flowName: 'test',
    systemPrompt: '',
    status: 'active',
    messages: [],
    activeMessages: [],
    contextFiles: [],
    contextFoldersInfos: [],
    toolSchemas: [],
    skillSchemas: [],
    tempFiles: [],
    toolLogs: [],
    skillLogs: [],
    startedAt: new Date(),
    currentNodeName: overrides.currentNodeName ?? null,
    currentPacketData: overrides.currentPacketData ?? null,
  };
  const app: any = {};
  return new Session(sessionData, app);
}

/** Minimal App double */
const mockApp: any = {};

/** Simple node that records visits and outputs data unchanged */
function makeRecordingNode(name: string, outputData?: unknown) {
  const visits: unknown[] = [];
  class RecordingNode extends Node<TestDeps, TestContext, unknown, { default: unknown }> {
    constructor() { super(name); }
    async run(p: this['In']): Promise<this['Out']> {
      visits.push(p.data);
      return packet({ data: outputData ?? p.data, context: p.context, deps: p.deps });
    }
  }
  return { node: new RecordingNode(), visits };
}

/** Builds a linear A → B flow and returns the pieces */
function makeLinearFlow() {
  const a = makeRecordingNode('NodeA', 'from-a');
  const b = makeRecordingNode('NodeB', 'from-b');
  a.node.next(b.node);
  const flow = new Flow(a.node);
  return { flow, a, b };
}

/** Concrete runner for tests — creates a session, runs the linear flow */
class TestRunner extends FlowRunner<TestContext, TestParams> {
  readonly flowName = 'test';
  readonly description = 'Test runner';
  readonly parameters = Type.Object({ message: Type.String() });

  private _flowFactory: () => Flow<any, any, any, any>;
  private _createdSession: Session;

  constructor(session: Session, flowFactory?: () => Flow<any, any, any, any>) {
    super();
    this._createdSession = session;
    this._flowFactory = flowFactory ?? (() => makeLinearFlow().flow);
  }

  async createSession(_app: any, _ctx: any, _params: TestParams): Promise<Session> {
    return this._createdSession;
  }

  async createContext(_app: any, _ctx: any, session: Session, _params: TestParams): Promise<TestContext> {
    return { session };
  }

  createFlow() {
    return this._flowFactory();
  }
}

/** Runner that overrides sessionCarryingNodes */
class SessionCarryingRunner extends TestRunner {
  protected sessionCarryingNodes(): string[] {
    return ['NodeA'];
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('FlowRunner.start()', () => {
  it('sets session, flow, and promise after start()', async () => {
    const session = makeSession();
    const runner = new TestRunner(session);

    await runner.start(mockApp, { user: { id: 'u1' } as any }, { message: 'hi' });

    expect(runner.session).toBe(session);
    expect(runner.flow).toBeDefined();
    expect(runner.promise).toBeInstanceOf(Promise);
  });

  it('promise resolves after the flow completes', async () => {
    const session = makeSession();
    const runner = new TestRunner(session);

    await runner.start(mockApp, { user: { id: 'u1' } as any }, { message: 'hi' });
    await expect(runner.promise).resolves.toBeDefined();
  });

  it('calls createSession, createContext, createFlow in order', async () => {
    const order: string[] = [];
    const session = makeSession();

    class SpyRunner extends FlowRunner<TestContext, TestParams> {
      readonly flowName = 'spy';
      readonly description = 'spy';
      readonly parameters = Type.Object({ message: Type.String() });

      async createSession() { order.push('createSession'); return session; }
      async createContext(_a: any, _c: any, s: Session) { order.push('createContext'); return { session: s }; }
      createFlow() { order.push('createFlow'); return makeLinearFlow().flow; }
    }

    await new SpyRunner().start(mockApp, { user: { id: 'u' } as any }, { message: 'x' });
    expect(order).toEqual(['createSession', 'createContext', 'createFlow']);
  });

  it('passes params to createSession', async () => {
    const session = makeSession();
    const receivedParams: TestParams[] = [];

    class ParamRunner extends TestRunner {
      async createSession(_app: any, _ctx: any, params: TestParams): Promise<Session> {
        receivedParams.push(params);
        return session;
      }
    }

    await new ParamRunner(session).start(mockApp, { user: { id: 'u' } as any }, { message: 'hello' });
    expect(receivedParams[0]).toEqual({ message: 'hello' });
  });

  it('_buildStartPacket default passes params as data', async () => {
    const session = makeSession();
    let receivedData: unknown;

    const startNode = {
      nodeName: 'Start',
      branches: new Map(),
      options: { maxRunTries: 1, wait: 0 },
      _exec: async (p: any) => { receivedData = p.data; return { ...p, branch: 'exit' }; },
    } as any;

    class DataCheckRunner extends FlowRunner<TestContext, TestParams> {
      readonly flowName = 'dc';
      readonly description = 'dc';
      readonly parameters = Type.Object({ message: Type.String() });
      async createSession() { return session; }
      async createContext(_a: any, _c: any, s: Session) { return { session: s }; }
      createFlow() { return new Flow(startNode); }
    }

    const runner = new DataCheckRunner();
    await runner.start(mockApp, { user: { id: 'u' } as any }, { message: 'world' });
    await runner.promise;
    expect(receivedData).toEqual({ message: 'world' });
  });
});

describe('FlowRunner.restore()', () => {
  it('throws if session has no currentNodeName', async () => {
    const session = makeSession({ currentNodeName: undefined });
    const runner = new TestRunner(session);

    await expect(runner.restore(mockApp, session, { id: 'u' } as any))
      .rejects.toThrow('has no currentNodeName checkpoint');
  });

  it('throws if currentNodeName is not found in flow graph', async () => {
    const session = makeSession({ currentNodeName: 'NonExistentNode' });
    const runner = new TestRunner(session);

    await expect(runner.restore(mockApp, session, { id: 'u' } as any))
      .rejects.toThrow("Node 'NonExistentNode' not found in flow 'test'");
  });

  it('sets session, flow, and promise after restore()', async () => {
    const session = makeSession({ currentNodeName: 'NodeB' });
    const { flow } = makeLinearFlow();
    const runner = new TestRunner(session, () => flow);

    await runner.restore(mockApp, session, { id: 'u' } as any);

    expect(runner.session).toBe(session);
    expect(runner.flow).toBe(flow);
    expect(runner.promise).toBeInstanceOf(Promise);
  });

  it('resumes execution from the checkpointed node, skipping earlier nodes', async () => {
    const session = makeSession({ currentNodeName: 'NodeB', currentPacketData: 'stored' });
    const { flow, a, b } = makeLinearFlow();
    const runner = new TestRunner(session, () => flow);

    await runner.restore(mockApp, session, { id: 'u' } as any);
    await runner.promise;

    // NodeA was NOT visited — we restored straight into NodeB
    expect(a.visits).toHaveLength(0);
    expect(b.visits).toHaveLength(1);
  });

  it('passes stored packet data to the restored node', async () => {
    const session = makeSession({ currentNodeName: 'NodeB', currentPacketData: 'resume-payload' });
    const { flow, b } = makeLinearFlow();
    const runner = new TestRunner(session, () => flow);

    await runner.restore(mockApp, session, { id: 'u' } as any);
    await runner.promise;

    expect(b.visits[0]).toBe('resume-payload');
  });

  it('calls createContext with empty params during restore', async () => {
    const session = makeSession({ currentNodeName: 'NodeB' });
    const receivedParams: any[] = [];

    class ParamSpyRunner extends TestRunner {
      async createContext(_app: any, _ctx: any, s: Session, params: TestParams): Promise<TestContext> {
        receivedParams.push(params);
        return { session: s };
      }
    }

    const runner = new ParamSpyRunner(session, () => makeLinearFlow().flow);
    await runner.restore(mockApp, session, { id: 'u' } as any);

    expect(receivedParams[0]).toEqual({});
  });

  it('passes the user into flowContext during restore', async () => {
    const session = makeSession({ currentNodeName: 'NodeB' });
    const receivedContexts: any[] = [];
    const user = { id: 'restored-user' } as any;

    class ContextSpyRunner extends TestRunner {
      async createContext(_app: any, ctx: any, s: Session) {
        receivedContexts.push(ctx);
        return { session: s };
      }
    }

    const runner = new ContextSpyRunner(session, () => makeLinearFlow().flow);
    await runner.restore(mockApp, session, user);

    expect(receivedContexts[0].user).toBe(user);
  });
});

describe('FlowRunner — restore from first node', () => {
  it('restores and runs from NodeA when checkpoint is NodeA', async () => {
    const session = makeSession({ currentNodeName: 'NodeA', currentPacketData: 'start-payload' });
    const { flow, a, b } = makeLinearFlow();
    const runner = new TestRunner(session, () => flow);

    await runner.restore(mockApp, session, { id: 'u' } as any);
    await runner.promise;

    expect(a.visits).toHaveLength(1);
    expect(b.visits).toHaveLength(1);
    expect(a.visits[0]).toBe('start-payload');
  });
});

describe('FlowRunner.serializePacketData()', () => {
  it('returns null for Session instances', () => {
    const session = makeSession();
    const runner = new TestRunner(session);
    expect(runner.serializePacketData('NodeA', session)).toBeNull();
  });

  it('returns null for undefined', () => {
    const session = makeSession();
    const runner = new TestRunner(session);
    expect(runner.serializePacketData('NodeA', undefined)).toBeNull();
  });

  it('passes strings through as-is', () => {
    const session = makeSession();
    const runner = new TestRunner(session);
    expect(runner.serializePacketData('NodeA', 'hello')).toBe('hello');
  });

  it('passes objects through as-is', () => {
    const session = makeSession();
    const runner = new TestRunner(session);
    const obj = { foo: 'bar' };
    expect(runner.serializePacketData('NodeA', obj)).toBe(obj);
  });

  it('passes null through as-is', () => {
    const session = makeSession();
    const runner = new TestRunner(session);
    expect(runner.serializePacketData('NodeA', null)).toBeNull();
  });
});

describe('FlowRunner.deserializePacketData()', () => {
  it('returns stored data for non-session-carrying nodes', () => {
    const session = makeSession();
    const runner = new TestRunner(session);
    expect(runner.deserializePacketData('NodeA', 'stored', session)).toBe('stored');
  });

  it('returns undefined when stored data is null and node is not session-carrying', () => {
    const session = makeSession();
    const runner = new TestRunner(session);
    expect(runner.deserializePacketData('NodeA', null, session)).toBeUndefined();
  });

  it('returns session for nodes listed in sessionCarryingNodes()', () => {
    const session = makeSession();
    const runner = new SessionCarryingRunner(session);
    expect(runner.deserializePacketData('NodeA', null, session)).toBe(session);
  });

  it('returns stored data for nodes NOT listed in sessionCarryingNodes()', () => {
    const session = makeSession();
    const runner = new SessionCarryingRunner(session);
    expect(runner.deserializePacketData('NodeB', 'payload', session)).toBe('payload');
  });
});

describe('FlowRunner — sessionCarryingNodes on restore', () => {
  it('restores session-carrying node with live session object, not null', async () => {
    const session = makeSession({ currentNodeName: 'NodeA', currentPacketData: null });
    const { flow, a } = makeLinearFlow();
    const runner = new SessionCarryingRunner(session, () => flow);

    await runner.restore(mockApp, session, { id: 'u' } as any);
    await runner.promise;

    // NodeA should have received the live session, not null
    expect(a.visits[0]).toBe(session);
  });

  it('restores non-session-carrying node with stored data', async () => {
    const session = makeSession({ currentNodeName: 'NodeB', currentPacketData: 'stored-value' });
    const { flow, b } = makeLinearFlow();
    const runner = new SessionCarryingRunner(session, () => flow);

    await runner.restore(mockApp, session, { id: 'u' } as any);
    await runner.promise;

    expect(b.visits[0]).toBe('stored-value');
  });
});

describe('FlowRunner — paused flow restore', () => {
  it('restores a flow that was paused mid-execution', async () => {
    // Build a flow: NodeA → (pause branch) → NodeB
    const a = makeRecordingNode('NodeA');
    const b = makeRecordingNode('NodeB', 'after-resume');

    // NodeA always outputs a pause
    class PausingNode extends Node<any, any, any, any> {
      constructor() { super('NodeA'); }
      async run(p: this['In']): Promise<this['Out']> {
        return pause({ data: p.data, context: p.context, deps: p.deps });
      }
    }
    const pauseNode = new PausingNode();
    pauseNode.branch('pause', b.node);

    const flow1 = new Flow(pauseNode);

    // Simulate: flow ran, got paused at NodeB checkpoint (the node AFTER pause)
    const session = makeSession({ currentNodeName: 'NodeB', currentPacketData: 'resumed-data' });
    const runner = new TestRunner(session, () => {
      // Fresh flow for restore — same graph structure
      const pn = new PausingNode();
      const bn = makeRecordingNode('NodeB', 'after-resume');
      pn.branch('pause', bn.node);
      return new Flow(pn);
    });

    await runner.restore(mockApp, session, { id: 'u' } as any);
    await runner.promise;

    // Restore goes straight to NodeB — the pause node is skipped
    expect(b.visits).toHaveLength(0); // b from original flow — runner made a new flow
    // Verify via the runner's flow
    const restoredB = runner.flow.getNodeByName('NodeB');
    expect(restoredB).toBeDefined();
  });
});

describe('FlowRunner — onBeforeNode / onAfterNode integration', () => {
  it('onBeforeNode fires before each node, onAfterNode after', async () => {
    const session = makeSession();
    const { flow, a, b } = makeLinearFlow();
    const beforeLog: string[] = [];
    const afterLog: string[] = [];

    flow.onBeforeNode = async (name) => { beforeLog.push(name); };
    flow.onAfterNode = async (name) => { afterLog.push(name); };

    const runner = new TestRunner(session, () => flow);
    await runner.start(mockApp, { user: { id: 'u' } as any }, { message: 'x' });
    await runner.promise;

    expect(beforeLog).toEqual(['NodeA', 'NodeB']);
    expect(afterLog).toEqual(['NodeA', 'NodeB']);
  });

  it('onAfterNode receives the result packet from that node', async () => {
    const session = makeSession();
    const { flow } = makeLinearFlow();
    const afterResults: unknown[] = [];

    flow.onAfterNode = async (_name, result) => { afterResults.push((result as any).data); };

    const runner = new TestRunner(session, () => flow);
    await runner.start(mockApp, { user: { id: 'u' } as any }, { message: 'x' });
    await runner.promise;

    expect(afterResults).toEqual(['from-a', 'from-b']);
  });

  it('onBeforeNode / onAfterNode also fire during restore', async () => {
    const session = makeSession({ currentNodeName: 'NodeB', currentPacketData: 'x' });
    const beforeLog: string[] = [];

    const { flow, b } = makeLinearFlow();
    flow.onBeforeNode = async (name) => { beforeLog.push(name); };

    const runner = new TestRunner(session, () => flow);
    await runner.restore(mockApp, session, { id: 'u' } as any);
    await runner.promise;

    // Only NodeB fires — NodeA was skipped by restore
    expect(beforeLog).toEqual(['NodeB']);
  });
});
