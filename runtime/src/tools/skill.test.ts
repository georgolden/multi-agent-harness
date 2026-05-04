import { describe, it, expect, vi } from 'vitest';
import { createSkillTool } from './skill.js';
import type { Skills, Skill } from '../skills/index.js';
import type { SandboxService } from '../services/sandbox/index.js';
import type { Session } from '../services/sessionService/session.js';
import type { App } from '../app.js';
import type { ToolCallContext } from './index.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    location: '/skills/foo',
    name: 'foo',
    description: 'Foo skill',
    runtime: undefined,
    readSkillMd: async () => '# Foo\nDo foo things.',
    readContent: async () => [{ path: 'foo.py', content: 'print("foo")' }],
    ...overrides,
  };
}

function makeSkills(skill: Skill): Skills {
  return {
    getSkill: (name: string) => (name === skill.name ? skill : undefined),
    getSkills: () => [skill],
  } as unknown as Skills;
}

function makeSandbox(): SandboxService {
  return {
    createSkillSession: vi.fn(),
    createSandboxedTools: vi.fn(),
    cleanupSkillSession: vi.fn(),
  } as unknown as SandboxService;
}

function makeSession(initialPrompt = 'base prompt'): Session {
  const enabledMap = new Map<string, any>();
  let _systemPrompt = initialPrompt;
  const session = {
    get systemPrompt() { return _systemPrompt; },
    upsertSystemPrompt: vi.fn(async (p: string) => { _systemPrompt = p; return session; }),
    enableSkill: vi.fn(async (name: string, entry: any) => { enabledMap.set(name, entry); return session; }),
    getEnabledSkill: vi.fn((name: string) => enabledMap.get(name)),
    activateSkill: vi.fn(async (name: string, skill: any, md: string) => {
      _systemPrompt = `${_systemPrompt}\n\n<skill name="${name}">\n${md}\n</skill>`;
      enabledMap.set(name, { skill, sandboxSession: null });
      return session;
    }),
    ensureSkillSandbox: vi.fn(async () => ({ sandboxToolNames: [] })),
    addOrReplaceAgentTools: vi.fn(),
  } as unknown as Session;
  return session;
}

function makeApp(skill: Skill, sandbox: SandboxService): App {
  return {
    skills: makeSkills(skill),
    services: { sandbox },
  } as unknown as App;
}

function makeCtx(session: Session): ToolCallContext {
  return { session } as unknown as ToolCallContext;
}

const callCtx = { toolCallId: 'test-call-id' };

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('createSkillTool', () => {
  it('returns error when skill not found', async () => {
    const skill = makeSkill();
    const sandbox = makeSandbox();
    const session = makeSession();
    const tool = createSkillTool();

    const result = await tool.execute(makeApp(skill, sandbox), makeCtx(session), { name: 'unknown' }, callCtx);

    expect(result.error).toBeDefined();
    expect(result.error!.message).toContain("'unknown' not found");
    const parsed = JSON.parse(result.data.content as string);
    expect(parsed.error).toContain("'unknown' not found");
    expect(parsed.error).toContain('foo');
  });

  it('returns error when skill already active', async () => {
    const skill = makeSkill();
    const sandbox = makeSandbox();
    const session = makeSession();
    (session.getEnabledSkill as any).mockReturnValue({ skill, sandboxSession: null });
    const tool = createSkillTool();

    const result = await tool.execute(makeApp(skill, sandbox), makeCtx(session), { name: 'foo' }, callCtx);

    expect(result.error).toBeDefined();
    const parsed = JSON.parse(result.data.content as string);
    expect(parsed.error).toContain('already active');
    expect(session.activateSkill).not.toHaveBeenCalled();
  });

  it('injects SKILL.md into system prompt via activateSkill', async () => {
    const skill = makeSkill();
    const sandbox = makeSandbox();
    const session = makeSession('initial prompt');
    const tool = createSkillTool();

    await tool.execute(makeApp(skill, sandbox), makeCtx(session), { name: 'foo' }, callCtx);

    expect(session.activateSkill).toHaveBeenCalledOnce();
    const [calledName, , calledMd] = (session.activateSkill as any).mock.calls[0];
    expect(calledName).toBe('foo');
    expect(calledMd).toContain('# Foo');
  });

  it('includes skill content and file list in result', async () => {
    const skill = makeSkill();
    const sandbox = makeSandbox();
    const session = makeSession();
    const tool = createSkillTool();

    const result = await tool.execute(makeApp(skill, sandbox), makeCtx(session), { name: 'foo' }, callCtx);

    const parsed = JSON.parse(result.data.content as string);
    expect(parsed.skill).toBe('foo');
    expect(parsed.instructions).toContain('# Foo');
    expect(parsed.files).toContain('foo.py');
  });

  it('does not call ensureSkillSandbox when skill has no runtime', async () => {
    const skill = makeSkill({ runtime: undefined });
    const sandbox = makeSandbox();
    const session = makeSession();
    const tool = createSkillTool();

    await tool.execute(makeApp(skill, sandbox), makeCtx(session), { name: 'foo' }, callCtx);

    expect(session.ensureSkillSandbox).not.toHaveBeenCalled();
  });

  it('calls ensureSkillSandbox and returns namespaced tools when skill has runtime', async () => {
    const skill = makeSkill({ runtime: 'node' });
    const sandbox = makeSandbox();
    const session = makeSession();
    (session.ensureSkillSandbox as any).mockResolvedValue({
      sandboxToolNames: ['foo_bash', 'foo_read', 'foo_edit', 'foo_write'],
    });
    const tool = createSkillTool();

    const result = await tool.execute(makeApp(skill, sandbox), makeCtx(session), { name: 'foo' }, callCtx);

    expect(session.ensureSkillSandbox).toHaveBeenCalledWith('foo', sandbox);
    const parsed = JSON.parse(result.data.content as string);
    expect(parsed.sandbox.sandboxed_tools).toEqual(['foo_bash', 'foo_read', 'foo_edit', 'foo_write']);
  });

  it('returns error when sandbox fails', async () => {
    const skill = makeSkill({ runtime: 'node' });
    const sandbox = makeSandbox();
    const session = makeSession();
    (session.ensureSkillSandbox as any).mockResolvedValue({ error: new Error('podman not found') });
    const tool = createSkillTool();

    const result = await tool.execute(makeApp(skill, sandbox), makeCtx(session), { name: 'foo' }, callCtx);

    expect(result.error).toBeDefined();
    const parsed = JSON.parse(result.data.content as string);
    expect(parsed.error).toContain('podman not found');
    expect(session.activateSkill).toHaveBeenCalled();
  });

  it('caps file list at 10 entries', async () => {
    const files = Array.from({ length: 15 }, (_, i) => ({ path: `file${i}.py`, content: '' }));
    const skill = makeSkill({ readContent: async () => files });
    const sandbox = makeSandbox();
    const session = makeSession();
    const tool = createSkillTool();

    const result = await tool.execute(makeApp(skill, sandbox), makeCtx(session), { name: 'foo' }, callCtx);

    const parsed = JSON.parse(result.data.content as string);
    expect(parsed.files).toHaveLength(10);
  });
});

// ── Session.addOrReplaceAgentTools ────────────────────────────────────────────

describe('Session.addOrReplaceAgentTools logic', () => {
  it('adds tool when name not present', () => {
    const tools: any[] = [{ name: 'bash' }];
    const add = (incoming: any[]) => {
      for (const t of incoming) {
        const idx = tools.findIndex((x) => x.name === t.name);
        if (idx >= 0) tools[idx] = t;
        else tools.push(t);
      }
    };
    add([{ name: 'read' }]);
    expect(tools).toHaveLength(2);
    expect(tools[1].name).toBe('read');
  });

  it('replaces existing tool by name', () => {
    const original = { name: 'bash', label: 'original' };
    const replacement = { name: 'bash', label: 'sandboxed' };
    const tools: any[] = [original];
    const add = (incoming: any[]) => {
      for (const t of incoming) {
        const idx = tools.findIndex((x) => x.name === t.name);
        if (idx >= 0) tools[idx] = t;
        else tools.push(t);
      }
    };
    add([replacement]);
    expect(tools).toHaveLength(1);
    expect(tools[0].label).toBe('sandboxed');
  });
});
