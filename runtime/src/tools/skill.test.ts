import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSkillTool } from './skill.js';
import type { Skills, Skill } from '../skills/index.js';
import type { SandboxService } from '../services/sandbox/index.js';
import type { Session } from '../services/sessionService/session.js';

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
    addOrReplaceAgentTools: vi.fn(),
    updateEnabledSkillSandbox: vi.fn(),
  } as unknown as Session;
  return session;
}

const ctx = { toolCallId: 'test-call-id' };

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('createSkillTool', () => {
  it('returns error when skill not found', async () => {
    const skill = makeSkill();
    const tool = createSkillTool(makeSkills(skill), makeSandbox(), makeSession());

    const result = await tool.execute(null as any, null, { name: 'unknown' }, ctx);

    expect(result.error).toBeDefined();
    expect(result.error!.message).toContain("'unknown' not found");
    expect(result.data.content as string).toContain('Available skills: foo');
  });

  it('returns early when skill already active', async () => {
    const skill = makeSkill();
    const session = makeSession();
    // Pre-enable the skill
    (session.getEnabledSkill as any).mockReturnValue({ skill, sandboxSession: null });
    const tool = createSkillTool(makeSkills(skill), makeSandbox(), session);

    const result = await tool.execute(null as any, null, { name: 'foo' }, ctx);

    expect(result.error).toBeUndefined();
    expect(result.data.content as string).toContain('already active');
    expect(session.upsertSystemPrompt).not.toHaveBeenCalled();
  });

  it('injects SKILL.md into system prompt', async () => {
    const skill = makeSkill();
    const session = makeSession('initial prompt');
    const tool = createSkillTool(makeSkills(skill), makeSandbox(), session);

    await tool.execute(null as any, null, { name: 'foo' }, ctx);

    expect(session.upsertSystemPrompt).toHaveBeenCalledOnce();
    const newPrompt: string = (session.upsertSystemPrompt as any).mock.calls[0][0];
    expect(newPrompt).toContain('initial prompt');
    expect(newPrompt).toContain('<skill name="foo">');
    expect(newPrompt).toContain('# Foo');
    expect(newPrompt).toContain('</skill>');
  });

  it('persists enabled skill via session.enableSkill', async () => {
    const skill = makeSkill();
    const session = makeSession();
    const tool = createSkillTool(makeSkills(skill), makeSandbox(), session);

    await tool.execute(null as any, null, { name: 'foo' }, ctx);

    expect(session.enableSkill).toHaveBeenCalledWith('foo', { skill, sandboxSession: null });
  });

  it('includes skill content and file list in result', async () => {
    const skill = makeSkill();
    const session = makeSession();
    const tool = createSkillTool(makeSkills(skill), makeSandbox(), session);

    const result = await tool.execute(null as any, null, { name: 'foo' }, ctx);

    expect(result.data.content as string).toContain('<skill_content name="foo"');
    expect(result.data.content as string).toContain('# Foo');
    expect(result.data.content as string).toContain('foo.py');
  });

  it('does not create sandbox when skill has no runtime', async () => {
    const skill = makeSkill({ runtime: undefined });
    const sandbox = makeSandbox();
    const session = makeSession();
    const tool = createSkillTool(makeSkills(skill), sandbox, session);

    await tool.execute(null as any, null, { name: 'foo' }, ctx);

    expect(sandbox.createSkillSession).not.toHaveBeenCalled();
    expect(session.addOrReplaceAgentTools).not.toHaveBeenCalled();
  });

  it('creates sandbox and replaces tools when skill has runtime', async () => {
    const skill = makeSkill({ runtime: 'node' });
    const sandbox = makeSandbox();
    const execSession = { id: 'sess-1', runtimeName: 'node', mode: 'exclusive', realmHostPath: '/tmp/realm', containerWorkingDir: '/workspace' };
    const sandboxedTools = { bash: { name: 'bash' }, read: { name: 'read' }, edit: { name: 'edit' }, write: { name: 'write' } };
    (sandbox.createSkillSession as any).mockResolvedValue(execSession);
    (sandbox.createSandboxedTools as any).mockReturnValue(sandboxedTools);

    const session = makeSession();
    const tool = createSkillTool(makeSkills(skill), sandbox, session);

    const result = await tool.execute(null as any, null, { name: 'foo' }, ctx);

    expect(sandbox.createSkillSession).toHaveBeenCalledWith({ session, skill });
    expect(sandbox.createSandboxedTools).toHaveBeenCalledWith(execSession);
    expect(session.addOrReplaceAgentTools).toHaveBeenCalledWith([
      sandboxedTools.bash, sandboxedTools.read, sandboxedTools.edit, sandboxedTools.write,
    ]);
    expect(session.updateEnabledSkillSandbox).toHaveBeenCalledWith('foo', execSession);
    expect(result.data.content as string).toContain('bash, read, edit, and write now operate inside the skill sandbox');
  });

  it('notes sandbox failure but still activates skill', async () => {
    const skill = makeSkill({ runtime: 'node' });
    const sandbox = makeSandbox();
    (sandbox.createSkillSession as any).mockRejectedValue(new Error('podman not found'));

    const session = makeSession();
    const tool = createSkillTool(makeSkills(skill), sandbox, session);

    const result = await tool.execute(null as any, null, { name: 'foo' }, ctx);

    expect(result.error).toBeUndefined();
    expect(result.data.content as string).toContain('podman not found');
    expect(session.enableSkill).toHaveBeenCalled();
  });

  it('caps file list at 10 entries', async () => {
    const files = Array.from({ length: 15 }, (_, i) => ({ path: `file${i}.py`, content: '' }));
    const skill = makeSkill({ readContent: async () => files });
    const session = makeSession();
    const tool = createSkillTool(makeSkills(skill), makeSandbox(), session);

    const result = await tool.execute(null as any, null, { name: 'foo' }, ctx);

    const matches = (result.data.content as string).match(/<file path=/g) ?? [];
    expect(matches.length).toBe(10);
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
