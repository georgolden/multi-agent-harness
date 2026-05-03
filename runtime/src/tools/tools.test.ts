import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import nodePath from 'node:path';
import { createReadTool } from './read.js';
import { createWriteTool } from './write.js';
import { createEditTool } from './edit.js';
import { createBashTool } from './bash.js';

// ── Temp dir helpers ───────────────────────────────────────────────────────────

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(nodePath.join(os.tmpdir(), 'tools-test-'));
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function write(name: string, content: Buffer | string): Promise<string> {
  const path = nodePath.join(tmpDir, name);
  await fs.writeFile(path, content);
  return path;
}

async function mkdirp(name: string): Promise<string> {
  const path = nodePath.join(tmpDir, name);
  await fs.mkdir(path, { recursive: true });
  return path;
}

const ctx = { toolCallId: 'test-call-id' };

// ── Read tool ─────────────────────────────────────────────────────────────────

describe('read tool', () => {
  it('reads a text file with line numbers', async () => {
    const path = await write('hello.txt', 'line1\nline2\nline3\n');
    const tool = createReadTool(tmpDir);
    const result = await tool.execute(null as any, null, { filePath: path }, ctx);

    expect(result.data.content).toContain('<path>');
    expect(result.data.content).toContain('<type>file</type>');
    expect(result.data.content).toContain('1: line1');
    expect(result.data.content).toContain('2: line2');
    expect(result.data.content).toContain('3: line3');
    expect(result.data.content).toContain('End of file - total 3 lines');
    expect(result.details?.truncation?.truncated).toBe(false);
  });

  it('reads with offset and limit', async () => {
    const path = await write('offset.txt', Array.from({ length: 20 }, (_, i) => `line${i + 1}`).join('\n'));
    const tool = createReadTool(tmpDir);
    const result = await tool.execute(null as any, null, { filePath: path, offset: 10, limit: 5 }, ctx);

    expect(result.data.content).toContain('10: line10');
    expect(result.data.content).toContain('14: line14');
    expect(result.data.content).not.toContain('9: line9');
    expect(result.data.content).not.toContain('15: line15');
    expect(result.data.content).toContain('Use offset=15 to continue');
  });

  it('rejects offset beyond file length', async () => {
    const path = await write('short.txt', 'a\nb\nc');
    const tool = createReadTool(tmpDir);
    const result = await tool.execute(null as any, null, { filePath: path, offset: 10 }, ctx);

    expect(result.error).toBeDefined();
    expect(result.error!.message).toContain('out of range');
  });

  it('lists a directory', async () => {
    const dir = await mkdirp('listdir');
    await fs.writeFile(nodePath.join(dir, 'a.txt'), 'a');
    await fs.writeFile(nodePath.join(dir, 'b.txt'), 'b');
    await fs.mkdir(nodePath.join(dir, 'subdir'));

    const tool = createReadTool(tmpDir);
    const result = await tool.execute(null as any, null, { filePath: dir }, ctx);

    expect(result.data.content).toContain('<type>directory</type>');
    expect(result.data.content).toContain('a.txt');
    expect(result.data.content).toContain('b.txt');
    expect(result.data.content).toContain('subdir/');
  });

  it('suggests similar files when path not found', async () => {
    const dir = await mkdirp('suggest');
    await fs.writeFile(nodePath.join(dir, 'actual.txt'), 'x');

    const tool = createReadTool(tmpDir);
    const result = await tool.execute(null as any, null, { filePath: nodePath.join(dir, 'my-actual.txt') }, ctx);

    expect(result.error).toBeDefined();
    expect(result.data.content).toContain('Did you mean one of these?');
    expect(result.data.content).toContain('actual.txt');
  });

  it('rejects binary files', async () => {
    const path = await write('binary.wasm', Buffer.from([0x00, 0x61, 0x73, 0x6d]));
    const tool = createReadTool(tmpDir);
    const result = await tool.execute(null as any, null, { filePath: path }, ctx);

    expect(result.error).toBeDefined();
    expect(result.error!.message).toContain('Cannot read binary file');
  });

  it('rejects text files with null bytes', async () => {
    const path = await write('null.txt', Buffer.from([0x68, 0x65, 0x6c, 0x6c, 0x6f, 0x00, 0x77, 0x6f, 0x72, 0x6c, 0x64]));
    const tool = createReadTool(tmpDir);
    const result = await tool.execute(null as any, null, { filePath: path }, ctx);

    expect(result.error).toBeDefined();
    expect(result.error!.message).toContain('Cannot read binary file');
  });

  it('truncates long lines', async () => {
    const path = await write('longline.txt', 'x'.repeat(3000));
    const tool = createReadTool(tmpDir);
    const result = await tool.execute(null as any, null, { filePath: path }, ctx);

    expect(result.data.content).toContain('(line truncated to 2000 chars)');
  });

  it('truncates large files by bytes', async () => {
    const content = Array.from({ length: 1000 }, () => 'x'.repeat(100)).join('\n');
    const path = await write('large.txt', content);
    const tool = createReadTool(tmpDir);
    const result = await tool.execute(null as any, null, { filePath: path }, ctx);

    expect(result.details?.truncation?.truncated).toBe(true);
    expect(result.data.content).toContain('Output capped at');
    expect(result.data.content).toContain('Use offset=');
  });

  it('reads empty file', async () => {
    const path = await write('empty.txt', '');
    const tool = createReadTool(tmpDir);
    const result = await tool.execute(null as any, null, { filePath: path }, ctx);

    expect(result.details?.truncation?.truncated).toBe(false);
    expect(result.data.content).toContain('End of file - total 0 lines');
  });
});

// ── Write tool ────────────────────────────────────────────────────────────────

describe('write tool', () => {
  it('writes content to new file', async () => {
    const path = nodePath.join(tmpDir, 'newfile.txt');
    const tool = createWriteTool(tmpDir);
    const result = await tool.execute(null as any, null, { filePath: path, content: 'Hello, World!' }, ctx);

    expect(result.data.content).toContain('Wrote file successfully');
    const content = await fs.readFile(path, 'utf-8');
    expect(content).toBe('Hello, World!');
  });

  it('creates parent directories if needed', async () => {
    const path = nodePath.join(tmpDir, 'nested', 'deep', 'file.txt');
    const tool = createWriteTool(tmpDir);
    await tool.execute(null as any, null, { filePath: path, content: 'nested content' }, ctx);

    const content = await fs.readFile(path, 'utf-8');
    expect(content).toBe('nested content');
  });

  it('overwrites existing file content', async () => {
    const path = await write('existing.txt', 'old content');
    const tool = createWriteTool(tmpDir);
    const result = await tool.execute(null as any, null, { filePath: path, content: 'new content' }, ctx);

    expect(result.data.content).toContain('Wrote file successfully');
    expect(result.details?.exists).toBe(true);
    const content = await fs.readFile(path, 'utf-8');
    expect(content).toBe('new content');
  });

  it('preserves BOM when overwriting existing files', async () => {
    const path = await write('bom.txt', '\uFEFFusing System;\n');
    const tool = createWriteTool(tmpDir);
    await tool.execute(null as any, null, { filePath: path, content: 'using Up;\n' }, ctx);

    const content = await fs.readFile(path, 'utf-8');
    expect(content.charCodeAt(0)).toBe(0xfeff);
    expect(content.slice(1)).toBe('using Up;\n');
  });

  it('writes empty content', async () => {
    const path = nodePath.join(tmpDir, 'empty.txt');
    const tool = createWriteTool(tmpDir);
    await tool.execute(null as any, null, { filePath: path, content: '' }, ctx);

    const content = await fs.readFile(path, 'utf-8');
    expect(content).toBe('');
    const stats = await fs.stat(path);
    expect(stats.size).toBe(0);
  });

  it('handles different line endings', async () => {
    const path = nodePath.join(tmpDir, 'crlf.txt');
    const tool = createWriteTool(tmpDir);
    await tool.execute(null as any, null, { filePath: path, content: 'Line 1\r\nLine 2\r\n' }, ctx);

    const buf = await fs.readFile(path);
    expect(buf.toString()).toBe('Line 1\r\nLine 2\r\n');
  });
});

// ── Edit tool ─────────────────────────────────────────────────────────────────

describe('edit tool', () => {
  it('replaces text in existing file', async () => {
    const path = await write('edit.txt', 'old content here');
    const tool = createEditTool(tmpDir);
    const result = await tool.execute(null as any, null, { filePath: path, oldString: 'old content', newString: 'new content' }, ctx);

    expect(result.data.content).toContain('Successfully replaced text');
    const content = await fs.readFile(path, 'utf-8');
    expect(content).toBe('new content here');
  });

  it('creates new file when oldString is empty', async () => {
    const path = nodePath.join(tmpDir, 'new-edit.txt');
    const tool = createEditTool(tmpDir);
    const result = await tool.execute(null as any, null, { filePath: path, oldString: '', newString: 'new content' }, ctx);

    expect(result.data.content).toContain('Successfully wrote file');
    const content = await fs.readFile(path, 'utf-8');
    expect(content).toBe('new content');
  });

  it('throws error when file does not exist', async () => {
    const path = nodePath.join(tmpDir, 'nonexistent.txt');
    const tool = createEditTool(tmpDir);
    const result = await tool.execute(null as any, null, { filePath: path, oldString: 'old', newString: 'new' }, ctx);

    expect(result.error).toBeDefined();
    expect(result.error!.message).toContain('not found');
  });

  it('throws error when oldString equals newString', async () => {
    const path = await write('same.txt', 'content');
    const tool = createEditTool(tmpDir);
    const result = await tool.execute(null as any, null, { filePath: path, oldString: 'same', newString: 'same' }, ctx);

    expect(result.error).toBeDefined();
    expect(result.error!.message).toContain('identical');
  });

  it('throws error when oldString not found in file', async () => {
    const path = await write('missing.txt', 'actual content');
    const tool = createEditTool(tmpDir);
    const result = await tool.execute(null as any, null, { filePath: path, oldString: 'not in file', newString: 'replacement' }, ctx);

    expect(result.error).toBeDefined();
    expect(result.error!.message).toContain('Could not find');
  });

  it('replaces all occurrences with replaceAll option', async () => {
    const path = await write('multi.txt', 'foo bar foo baz foo');
    const tool = createEditTool(tmpDir);
    await tool.execute(null as any, null, { filePath: path, oldString: 'foo', newString: 'qux', replaceAll: true }, ctx);

    const content = await fs.readFile(path, 'utf-8');
    expect(content).toBe('qux bar qux baz qux');
  });

  it('handles multiline replacements', async () => {
    const path = await write('multiline.txt', 'line1\nline2\nline3');
    const tool = createEditTool(tmpDir);
    await tool.execute(null as any, null, { filePath: path, oldString: 'line2', newString: 'new line 2\nextra line' }, ctx);

    const content = await fs.readFile(path, 'utf-8');
    expect(content).toBe('line1\nnew line 2\nextra line\nline3');
  });

  it('handles CRLF line endings', async () => {
    const path = await write('crlf-edit.txt', 'line1\r\nold\r\nline3');
    const tool = createEditTool(tmpDir);
    await tool.execute(null as any, null, { filePath: path, oldString: 'old', newString: 'new' }, ctx);

    const content = await fs.readFile(path, 'utf-8');
    expect(content).toBe('line1\r\nnew\r\nline3');
  });

  it('preserves BOM when editing existing files', async () => {
    const path = await write('bom-edit.txt', '\uFEFFusing System;\nclass Test {}\n');
    const tool = createEditTool(tmpDir);
    const result = await tool.execute(null as any, null, { filePath: path, oldString: 'using System;', newString: 'using Up;' }, ctx);

    expect(result.details?.diff).toContain('-1 using System;');
    expect(result.details?.diff).toContain('+1 using Up;');

    const content = await fs.readFile(path, 'utf-8');
    expect(content.charCodeAt(0)).toBe(0xfeff);
    expect(content.slice(1)).toBe('using Up;\nclass Test {}\n');
  });

  it('uses fuzzy matching for whitespace differences', async () => {
    const path = await write('fuzzy.txt', '  line with trailing   \n  next line');
    const tool = createEditTool(tmpDir);
    await tool.execute(null as any, null, { filePath: path, oldString: 'line with trailing\nnext line', newString: 'replaced' }, ctx);

    const content = await fs.readFile(path, 'utf-8');
    expect(content).toContain('replaced');
  });

  it('uses block anchor matching for large blocks', async () => {
    const original = 'start\nline a\nline b\nline c\nend';
    const path = await write('anchor.txt', original);
    const tool = createEditTool(tmpDir);
    await tool.execute(
      null as any,
      null,
      { filePath: path, oldString: 'start\nline X\nline Y\nend', newString: 'start\nreplaced\nend' },
      ctx,
    );

    const content = await fs.readFile(path, 'utf-8');
    expect(content).toBe('start\nreplaced\nend');
  });
});

// ── Bash tool ─────────────────────────────────────────────────────────────────

describe('bash tool', () => {
  it('executes a simple command', async () => {
    const tool = createBashTool(tmpDir);
    const result = await tool.execute(null as any, null, { command: 'echo hello', description: 'Echo hello' }, ctx);

    expect(result.details?.exitCode).toBe(0);
    expect(result.data.content).toContain('hello');
  });

  it('captures stderr in output', async () => {
    const tool = createBashTool(tmpDir);
    const result = await tool.execute(
      null as any,
      null,
      { command: 'echo stdout_msg && echo stderr_msg >&2', description: 'Stderr test' },
      ctx,
    );

    expect(result.data.content).toContain('stdout_msg');
    expect(result.data.content).toContain('stderr_msg');
    expect(result.details?.exitCode).toBe(0);
  });

  it('returns non-zero exit code', async () => {
    const tool = createBashTool(tmpDir);
    const result = await tool.execute(null as any, null, { command: 'exit 42', description: 'Non-zero exit' }, ctx);

    expect(result.details?.exitCode).toBe(42);
    expect(result.error).toBeDefined();
    expect(result.data.content).toContain('Command exited with code 42');
  });

  it('uses workdir parameter', async () => {
    const subdir = await mkdirp('workdir-sub');
    await fs.writeFile(nodePath.join(subdir, 'file.txt'), 'inside');

    const tool = createBashTool(tmpDir);
    const result = await tool.execute(
      null as any,
      null,
      { command: 'cat file.txt', description: 'Read from workdir', workdir: 'workdir-sub' },
      ctx,
    );

    expect(result.details?.exitCode).toBe(0);
    expect(result.data.content).toContain('inside');
  });

  it('terminates command on timeout', async () => {
    const tool = createBashTool(tmpDir);
    const result = await tool.execute(
      null as any,
      null,
      { command: 'echo started && sleep 60', description: 'Timeout test', timeout: 500 },
      ctx,
    );

    expect(result.data.content).toContain('started');
    expect(result.data.content).toContain('bash tool terminated command after exceeding timeout');
    expect(result.data.content).toContain('retry with a larger timeout value in milliseconds');
  }, 15000);

  it('does not truncate small output', async () => {
    const tool = createBashTool(tmpDir);
    const result = await tool.execute(null as any, null, { command: 'echo hello', description: 'Echo hello' }, ctx);

    expect(result.details?.truncated).toBe(false);
    expect(result.data.content).toContain('hello');
  });

  it('truncates output exceeding line limit', async () => {
    const lines = Array.from({ length: 2500 }, (_, i) => `line${i + 1}`).join('\n');
    const tool = createBashTool(tmpDir);
    const result = await tool.execute(
      null as any,
      null,
      { command: `printf '${lines}'`, description: 'Generate many lines' },
      ctx,
    );

    expect(result.details?.truncated).toBe(true);
    expect(result.data.content).toContain('...output truncated...');
    expect(result.data.content).toContain('Full output saved to:');
  });

  it('reports description in metadata', async () => {
    const tool = createBashTool(tmpDir);
    const result = await tool.execute(null as any, null, { command: 'echo test', description: 'My description' }, ctx);

    expect(result.details?.description).toBe('My description');
  });
});
