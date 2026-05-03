import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import nodePath from 'node:path';
import { createFindTool, type FindOperations } from './find.js';
import { createGrepTool, type GrepOperations } from './grep.js';
import { createTreeTool, DEFAULT_TREE_IGNORE, runTreeCommand } from './tree.js';
import { truncateHead, truncateTail, truncateLine, formatSize, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from './truncate.js';

// ── Temp dir helpers ───────────────────────────────────────────────────────────

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(nodePath.join(os.tmpdir(), 'tools-test-'));
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function write(name: string, content: Buffer | string): Promise<string> {
  const p = nodePath.join(tmpDir, name);
  await fs.writeFile(p, content);
  return p;
}

async function mkdirp(name: string): Promise<string> {
  const p = nodePath.join(tmpDir, name);
  await fs.mkdir(p, { recursive: true });
  return p;
}

const ctx = { toolCallId: 'test-call-id' };

// ── Truncate utilities ────────────────────────────────────────────────────────

describe('truncate utilities', () => {
  describe('formatSize', () => {
    it('formats bytes', () => {
      expect(formatSize(0)).toBe('0B');
      expect(formatSize(512)).toBe('512B');
      expect(formatSize(1023)).toBe('1023B');
    });

    it('formats kilobytes', () => {
      expect(formatSize(1024)).toBe('1.0KB');
      expect(formatSize(1536)).toBe('1.5KB');
      expect(formatSize(50 * 1024)).toBe('50.0KB');
    });

    it('formats megabytes', () => {
      expect(formatSize(1024 * 1024)).toBe('1.0MB');
      expect(formatSize(2.5 * 1024 * 1024)).toBe('2.5MB');
    });
  });

  describe('truncateHead', () => {
    it('returns unchanged when under limits', () => {
      const text = 'line1\nline2\nline3';
      const result = truncateHead(text);
      expect(result.truncated).toBe(false);
      expect(result.content).toBe(text);
      expect(result.totalLines).toBe(3);
      expect(result.truncatedBy).toBeNull();
    });

    it('truncates by line limit', () => {
      const lines = Array.from({ length: DEFAULT_MAX_LINES + 10 }, (_, i) => `line${i + 1}`);
      const text = lines.join('\n');
      const result = truncateHead(text, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES * 10 });
      expect(result.truncated).toBe(true);
      expect(result.truncatedBy).toBe('lines');
      expect(result.outputLines).toBe(DEFAULT_MAX_LINES);
      expect(result.content).not.toContain(`line${DEFAULT_MAX_LINES + 1}`);
    });

    it('truncates by byte limit', () => {
      const text = 'x'.repeat(DEFAULT_MAX_BYTES + 100);
      const result = truncateHead(text, { maxLines: Number.MAX_SAFE_INTEGER, maxBytes: DEFAULT_MAX_BYTES });
      expect(result.truncated).toBe(true);
      expect(result.truncatedBy).toBe('bytes');
      expect(result.outputBytes).toBeLessThanOrEqual(DEFAULT_MAX_BYTES);
    });

    it('handles first line exceeding byte limit', () => {
      const text = 'x'.repeat(DEFAULT_MAX_BYTES + 100) + '\nline2';
      const result = truncateHead(text, { maxLines: Number.MAX_SAFE_INTEGER, maxBytes: DEFAULT_MAX_BYTES });
      expect(result.truncated).toBe(true);
      expect(result.firstLineExceedsLimit).toBe(true);
      expect(result.content).toBe('');
      expect(result.outputLines).toBe(0);
    });

    it('handles multi-byte UTF-8 correctly', () => {
      const text = '🎉'.repeat(1000) + '\n' + 'x'.repeat(1000);
      const result = truncateHead(text, { maxLines: Number.MAX_SAFE_INTEGER, maxBytes: 100 });
      expect(result.truncated).toBe(true);
      // Should include complete multi-byte characters only
      expect(Buffer.byteLength(result.content, 'utf-8')).toBeLessThanOrEqual(100);
    });

    it('respects custom limits', () => {
      const text = 'a\nb\nc\nd\ne';
      const result = truncateHead(text, { maxLines: 3, maxBytes: DEFAULT_MAX_BYTES });
      expect(result.truncated).toBe(true);
      expect(result.outputLines).toBe(3);
      expect(result.content).toBe('a\nb\nc');
    });
  });

  describe('truncateTail', () => {
    it('returns unchanged when under limits', () => {
      const text = 'line1\nline2\nline3';
      const result = truncateTail(text);
      expect(result.truncated).toBe(false);
      expect(result.content).toBe(text);
    });

    it('truncates by line limit keeping last lines', () => {
      const lines = Array.from({ length: DEFAULT_MAX_LINES + 10 }, (_, i) => `line${i + 1}`);
      const text = lines.join('\n');
      const result = truncateTail(text, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES * 10 });
      expect(result.truncated).toBe(true);
      expect(result.truncatedBy).toBe('lines');
    expect(result.content).toContain(`line${DEFAULT_MAX_LINES + 10}`);
    expect(result.content).not.toMatch(/\bline1\b/);
    });

    it('truncates by byte limit keeping last bytes', () => {
      const text = 'prefix_' + 'x'.repeat(DEFAULT_MAX_BYTES + 100);
      const result = truncateTail(text, { maxLines: Number.MAX_SAFE_INTEGER, maxBytes: DEFAULT_MAX_BYTES });
      expect(result.truncated).toBe(true);
      expect(result.truncatedBy).toBe('bytes');
      expect(result.content).not.toContain('prefix_');
      expect(result.outputBytes).toBeLessThanOrEqual(DEFAULT_MAX_BYTES);
    });

    it('handles partial line when single line exceeds byte limit', () => {
      const text = 'x'.repeat(DEFAULT_MAX_BYTES + 100);
      const result = truncateTail(text, { maxLines: Number.MAX_SAFE_INTEGER, maxBytes: DEFAULT_MAX_BYTES });
      expect(result.truncated).toBe(true);
      expect(result.lastLinePartial).toBe(true);
      expect(result.outputLines).toBe(1);
    });

    it('handles multi-byte UTF-8 correctly from end', () => {
      const text = 'x'.repeat(1000) + '\n' + '🎉'.repeat(1000);
      const result = truncateTail(text, { maxLines: Number.MAX_SAFE_INTEGER, maxBytes: 100 });
      expect(result.truncated).toBe(true);
      expect(Buffer.byteLength(result.content, 'utf-8')).toBeLessThanOrEqual(100);
    });
  });

  describe('truncateLine', () => {
    it('returns unchanged when under limit', () => {
      const result = truncateLine('short line', 100);
      expect(result.wasTruncated).toBe(false);
      expect(result.text).toBe('short line');
    });

    it('truncates long lines with suffix', () => {
      const result = truncateLine('x'.repeat(600), 500);
      expect(result.wasTruncated).toBe(true);
      expect(result.text).toBe('x'.repeat(500) + '... [truncated]');
    });

    it('uses default GREP_MAX_LINE_LENGTH', () => {
      const result = truncateLine('x'.repeat(600));
      expect(result.wasTruncated).toBe(true);
      expect(result.text.endsWith('... [truncated]')).toBe(true);
    });
  });
});

// ── Tree tool ─────────────────────────────────────────────────────────────────

describe('tree tool', () => {
  it('lists directory structure', async () => {
    const dir = await mkdirp('tree-test');
    await fs.writeFile(nodePath.join(dir, 'a.txt'), 'a');
    await fs.writeFile(nodePath.join(dir, 'b.txt'), 'b');
    await fs.mkdir(nodePath.join(dir, 'subdir'));
    await fs.writeFile(nodePath.join(dir, 'subdir', 'c.txt'), 'c');

    const tool = createTreeTool(tmpDir);
    const result = await tool.execute(null as any, null, { path: 'tree-test' }, ctx);

    expect(result.error).toBeUndefined();
    expect(result.data.content).toContain('a.txt');
    expect(result.data.content).toContain('b.txt');
    expect(result.data.content).toContain('subdir');
    expect(result.data.content).toContain('c.txt');
    expect(result.details?.command).toContain('tree');
  });

  it('returns error for nonexistent path', async () => {
    const tool = createTreeTool(tmpDir);
    const result = await tool.execute(null as any, null, { path: 'nonexistent-dir-12345' }, ctx);

    expect(result.error).toBeDefined();
    expect(result.error!.message).toContain('not found');
  });

  it('respects level limit', async () => {
    const dir = await mkdirp('tree-level');
    await fs.mkdir(nodePath.join(dir, 'l1', 'l2', 'l3'), { recursive: true });
    await fs.writeFile(nodePath.join(dir, 'l1', 'l2', 'l3', 'deep.txt'), 'deep');

    const tool = createTreeTool(tmpDir);
    const result = await tool.execute(null as any, null, { path: 'tree-level', level: 2 }, ctx);

    expect(result.error).toBeUndefined();
    expect(result.data.content).toContain('l1');
    expect(result.data.content).not.toContain('deep.txt');
  });

  it('ignores default patterns', async () => {
    const dir = await mkdirp('tree-ignore');
    await fs.writeFile(nodePath.join(dir, 'keep.txt'), 'keep');
    await fs.mkdir(nodePath.join(dir, 'node_modules'));
    await fs.writeFile(nodePath.join(dir, 'node_modules', 'pkg.json'), '{}');

    const tool = createTreeTool(tmpDir);
    const result = await tool.execute(null as any, null, { path: 'tree-ignore' }, ctx);

    expect(result.data.content).toContain('keep.txt');
    expect(result.data.content).not.toContain('node_modules');
    expect(result.data.content).not.toContain('pkg.json');
  });

  it('respects custom ignore patterns', async () => {
    const dir = await mkdirp('tree-custom-ignore');
    await fs.writeFile(nodePath.join(dir, 'keep.txt'), 'keep');
    await fs.writeFile(nodePath.join(dir, 'secret.txt'), 'secret');

    const tool = createTreeTool(tmpDir);
    const result = await tool.execute(null as any, null, { path: 'tree-custom-ignore', ignore: ['secret.txt'] }, ctx);

    expect(result.data.content).toContain('keep.txt');
    expect(result.data.content).not.toContain('secret.txt');
  });

  it('truncates output exceeding byte limit', async () => {
    const dir = await mkdirp('tree-large');
    for (let i = 0; i < 1000; i++) {
      await fs.writeFile(nodePath.join(dir, `file${i}.txt`), 'x'.repeat(100));
    }

    const tool = createTreeTool(tmpDir);
    const result = await tool.execute(null as any, null, { path: 'tree-large' }, ctx);

    expect(result.data.content).toMatch(/exceeds filelimit|limit reached/);
    expect(Buffer.byteLength(result.data.content, 'utf-8')).toBeLessThanOrEqual(DEFAULT_MAX_BYTES + 200);
  });

  it('runTreeCommand returns tree output', async () => {
    const dir = await mkdirp('tree-run');
    await fs.writeFile(nodePath.join(dir, 'file.txt'), 'x');

    const output = await runTreeCommand(dir);
    expect(output).toContain('file.txt');
  });

  it('runTreeCommand respects abort signal', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(runTreeCommand(tmpDir, { signal: controller.signal })).rejects.toThrow('aborted');
  });
});

// ── Find tool ─────────────────────────────────────────────────────────────────

describe('find tool', () => {
  it('finds files by glob pattern', async () => {
    const dir = await mkdirp('find-test');
    await fs.writeFile(nodePath.join(dir, 'a.ts'), 'a');
    await fs.writeFile(nodePath.join(dir, 'b.ts'), 'b');
    await fs.writeFile(nodePath.join(dir, 'c.js'), 'c');

    const tool = createFindTool(tmpDir);
    const result = await tool.execute(null as any, null, { pattern: '*.ts', path: 'find-test' }, ctx);

    expect(result.error).toBeUndefined();
    expect(result.data.content).toContain('a.ts');
    expect(result.data.content).toContain('b.ts');
    expect(result.data.content).not.toContain('c.js');
  });

  it('finds files recursively', async () => {
    const dir = await mkdirp('find-deep');
    await fs.mkdir(nodePath.join(dir, 'sub'), { recursive: true });
    await fs.writeFile(nodePath.join(dir, 'root.txt'), 'root');
    await fs.writeFile(nodePath.join(dir, 'sub', 'nested.txt'), 'nested');

    const tool = createFindTool(tmpDir);
    const result = await tool.execute(null as any, null, { pattern: '**/*.txt', path: 'find-deep' }, ctx);

    expect(result.error).toBeUndefined();
    expect(result.data.content).toContain('root.txt');
    expect(result.data.content).toContain('nested.txt');
  });

  it('returns message when no files match', async () => {
    const dir = await mkdirp('find-empty');
    await fs.writeFile(nodePath.join(dir, 'a.txt'), 'a');

    const tool = createFindTool(tmpDir);
    const result = await tool.execute(null as any, null, { pattern: '*.nonexistent', path: 'find-empty' }, ctx);

    expect(result.error).toBeUndefined();
    expect(result.data.content).toContain('No files found');
  });

  it('returns error for nonexistent path', async () => {
    const tool = createFindTool(tmpDir);
    const result = await tool.execute(null as any, null, { pattern: '*', path: 'nonexistent-find-12345' }, ctx);

    expect(result.error).toBeDefined();
    expect(result.error!.message).toMatch(/not found|not a directory|No valid search paths/);
  });

  it('respects limit parameter', async () => {
    const dir = await mkdirp('find-limit');
    for (let i = 0; i < 20; i++) {
      await fs.writeFile(nodePath.join(dir, `file${i}.txt`), 'x');
    }

    const tool = createFindTool(tmpDir);
    const result = await tool.execute(null as any, null, { pattern: '*.txt', path: 'find-limit', limit: 5 }, ctx);

    expect(result.error).toBeUndefined();
    expect(result.data.content).toContain('limit reached');
    // Should have at most 5 lines of results
    const lines = result.data.content.split('\n').filter((l: string) => l.includes('.txt'));
    expect(lines.length).toBeLessThanOrEqual(5);
  });

  it('works with custom operations', async () => {
    const dir = await mkdirp('find-custom');
    await fs.writeFile(nodePath.join(dir, 'a.txt'), 'a');

    const ops: FindOperations = {
      exists: () => true,
      glob: async (_pattern, _cwd, _opts) => [nodePath.join(tmpDir, 'find-custom', 'a.txt')],
    };

    const tool = createFindTool(tmpDir, { operations: ops });
    const result = await tool.execute(null as any, null, { pattern: '*.txt', path: 'find-custom' }, ctx);

    expect(result.error).toBeUndefined();
    expect(result.data.content).toContain('a.txt');
  });

  it('respects abort signal', async () => {
    const controller = new AbortController();
    controller.abort();

    const tool = createFindTool(tmpDir);
    const result = await tool.execute(null as any, null, { pattern: '*' }, { ...ctx, signal: controller.signal });

    expect(result.error).toBeDefined();
    expect(result.error!.message).toContain('aborted');
  });
});

// ── Grep tool ─────────────────────────────────────────────────────────────────

describe('grep tool', () => {
  it('finds matches by pattern', async () => {
    const dir = await mkdirp('grep-test');
    await fs.writeFile(nodePath.join(dir, 'a.ts'), 'export const foo = 1;\nexport const bar = 2;');

    const tool = createGrepTool(tmpDir);
    const result = await tool.execute(null as any, null, { pattern: 'export', path: 'grep-test' }, ctx);

    expect(result.error).toBeUndefined();
    expect(result.data.content).toContain('foo');
    expect(result.data.content).toContain('bar');
    expect(result.data.content).toContain('a.ts');
  });

  it('returns message when no matches found', async () => {
    const dir = await mkdirp('grep-empty');
    await fs.writeFile(nodePath.join(dir, 'a.ts'), 'const x = 1;');

    const tool = createGrepTool(tmpDir);
    const result = await tool.execute(null as any, null, { pattern: 'nonexistent', path: 'grep-empty' }, ctx);

    expect(result.error).toBeUndefined();
    expect(result.data.content).toBe('No matches found');
  });

  it('returns error for nonexistent path', async () => {
    const tool = createGrepTool(tmpDir);
    const result = await tool.execute(null as any, null, { pattern: 'test', path: 'nonexistent-grep-12345' }, ctx);

    expect(result.error).toBeDefined();
    expect(result.error!.message).toContain('not found');
  });

  it('supports glob filter', async () => {
    const dir = await mkdirp('grep-glob');
    await fs.writeFile(nodePath.join(dir, 'a.ts'), 'export const foo = 1;');
    await fs.writeFile(nodePath.join(dir, 'b.js'), 'export const bar = 2;');

    const tool = createGrepTool(tmpDir);
    const result = await tool.execute(null as any, null, { pattern: 'export', path: 'grep-glob', glob: '*.ts' }, ctx);

    expect(result.error).toBeUndefined();
    expect(result.data.content).toContain('foo');
    expect(result.data.content).not.toContain('bar');
  });

  it('supports ignoreCase', async () => {
    const dir = await mkdirp('grep-case');
    await fs.writeFile(nodePath.join(dir, 'a.ts'), 'CONST FOO = 1;');

    const tool = createGrepTool(tmpDir);
    const result = await tool.execute(null as any, null, { pattern: 'const', path: 'grep-case', ignoreCase: true }, ctx);

    expect(result.error).toBeUndefined();
    expect(result.data.content).toContain('FOO');
  });

  it('supports literal search', async () => {
    const dir = await mkdirp('grep-literal');
    await fs.writeFile(nodePath.join(dir, 'a.ts'), 'const x = /foo.bar/;');

    const tool = createGrepTool(tmpDir);
    const result = await tool.execute(null as any, null, { pattern: 'foo.bar', path: 'grep-literal', literal: true }, ctx);

    expect(result.error).toBeUndefined();
    expect(result.data.content).toContain('foo.bar');
  });

  it('supports context lines', async () => {
    const dir = await mkdirp('grep-context');
    await fs.writeFile(
      nodePath.join(dir, 'a.ts'),
      'line1\nline2\nTARGET\nline4\nline5',
    );

    const tool = createGrepTool(tmpDir);
    const result = await tool.execute(null as any, null, { pattern: 'TARGET', path: 'grep-context', context: 2 }, ctx);

    expect(result.error).toBeUndefined();
    expect(result.data.content).toContain('line1');
    expect(result.data.content).toContain('line5');
    // Context lines should have dash separator
    expect(result.data.content).toContain('-1-');
    expect(result.data.content).toContain('-5-');
    // Match line should have colon separator
    expect(result.data.content).toContain(':3: TARGET');
  });

  it('respects match limit', async () => {
    const dir = await mkdirp('grep-limit');
    const lines = Array.from({ length: 50 }, (_, i) => `line${i}`).join('\n');
    await fs.writeFile(nodePath.join(dir, 'a.ts'), lines);

    const tool = createGrepTool(tmpDir);
    const result = await tool.execute(null as any, null, { pattern: 'line', path: 'grep-limit', limit: 10 }, ctx);

    expect(result.error).toBeUndefined();
    expect(result.data.content).toContain('matches limit reached');
  });

  it('works with custom operations', async () => {
    const dir = await mkdirp('grep-custom');
    const filePath = nodePath.join(dir, 'a.ts');
    await fs.writeFile(filePath, 'export const foo = 1;\nexport const bar = 2;');

    const ops: GrepOperations = {
      isDirectory: () => false,
      readFile: async () => 'export const foo = 1;\nexport const bar = 2;',
    };

    const tool = createGrepTool(tmpDir, { operations: ops });
    const result = await tool.execute(null as any, null, { pattern: 'foo', path: filePath }, ctx);

    expect(result.error).toBeUndefined();
    expect(result.data.content).toContain('foo');
  });

  it('truncates long lines', async () => {
    const dir = await mkdirp('grep-longline');
    await fs.writeFile(nodePath.join(dir, 'a.ts'), 'x'.repeat(1000));

    const tool = createGrepTool(tmpDir);
    const result = await tool.execute(null as any, null, { pattern: 'x', path: 'grep-longline' }, ctx);

    expect(result.error).toBeUndefined();
    expect(result.data.content).toContain('[truncated]');
  });

  it('respects abort signal during search', async () => {
    const dir = await mkdirp('grep-abort');
    const lines = Array.from({ length: 1000 }, (_, i) => `line${i}`).join('\n');
    await fs.writeFile(nodePath.join(dir, 'a.ts'), lines);

    const controller = new AbortController();
    // Abort immediately
    controller.abort();

    const tool = createGrepTool(tmpDir);
    const result = await tool.execute(null as any, null, { pattern: 'line', path: 'grep-abort' }, { ...ctx, signal: controller.signal });

    expect(result.error).toBeDefined();
    expect(result.error!.message).toContain('aborted');
  });
});
