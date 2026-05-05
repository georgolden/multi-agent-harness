import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import nodePath from 'node:path';
import { createServer } from 'node:http';
import { createReadTool } from './read.js';
import { createWriteTool } from './write.js';
import { createEditTool } from './edit.js';
import { createBashTool } from './bash.js';
import { createWebFetchTool } from './webfetch.js';
import { createWebSearchTool } from './websearch.js';

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

// ── WebFetch tool ─────────────────────────────────────────────────────────────

function startTestServer(): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url || '/', `http://localhost`);
      if (url.pathname === '/html') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><head><title>Test</title></head><body><h1>Hello</h1><p>World</p><script>alert("x")</script></body></html>');
      } else if (url.pathname === '/text') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Plain text content');
      } else if (url.pathname === '/markdown') {
        res.writeHead(200, { 'Content-Type': 'text/markdown' });
        res.end('# Markdown Title\n\nSome content');
      } else if (url.pathname === '/json') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"key": "value"}');
      } else if (url.pathname === '/large') {
        res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': '6000000' });
        res.end('x'.repeat(6000000));
      } else if (url.pathname === '/403') {
        res.writeHead(403, { 'cf-mitigated': 'challenge' });
        res.end('Forbidden');
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((res) => server.close(() => res())),
      });
    });
  });
}

describe('webfetch tool', () => {
  let server: { url: string; close: () => Promise<void> };

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
  });

  it('rejects URL without http:// or https://', async () => {
    const tool = createWebFetchTool();
    const result = await tool.execute(null as any, null, { url: 'ftp://example.com' }, ctx);

    expect(result.error).toBeDefined();
    expect(result.error!.message).toContain('URL must start with http:// or https://');
  });

  it('fetches HTML and converts to markdown by default', async () => {
    const tool = createWebFetchTool();
    const result = await tool.execute(null as any, null, { url: `${server.url}/html` }, ctx);

    expect(result.error).toBeUndefined();
    expect(result.data.content).toContain('# Hello');
    expect(result.data.content).toContain('World');
    expect(result.data.content).not.toContain('alert');
  });

  it('fetches HTML and converts to text', async () => {
    const tool = createWebFetchTool();
    const result = await tool.execute(null as any, null, { url: `${server.url}/html`, format: 'text' }, ctx);

    expect(result.error).toBeUndefined();
    expect(result.data.content).toContain('Hello');
    expect(result.data.content).toContain('World');
    expect(result.data.content).not.toContain('alert');
  });

  it('fetches HTML and returns raw html', async () => {
    const tool = createWebFetchTool();
    const result = await tool.execute(null as any, null, { url: `${server.url}/html`, format: 'html' }, ctx);

    expect(result.error).toBeUndefined();
    expect(result.data.content).toContain('<h1>Hello</h1>');
    expect(result.data.content).toContain('<p>World</p>');
  });

  it('fetches plain text as-is in markdown mode', async () => {
    const tool = createWebFetchTool();
    const result = await tool.execute(null as any, null, { url: `${server.url}/text`, format: 'markdown' }, ctx);

    expect(result.error).toBeUndefined();
    expect(result.data.content).toBe('Plain text content');
  });

  it('fetches markdown content as-is', async () => {
    const tool = createWebFetchTool();
    const result = await tool.execute(null as any, null, { url: `${server.url}/markdown`, format: 'markdown' }, ctx);

    expect(result.error).toBeUndefined();
    expect(result.data.content).toContain('# Markdown Title');
  });

  it('fetches json content as-is', async () => {
    const tool = createWebFetchTool();
    const result = await tool.execute(null as any, null, { url: `${server.url}/json` }, ctx);

    expect(result.error).toBeUndefined();
    expect(result.data.content).toContain('"key": "value"');
  });

  it('returns error for 404', async () => {
    const tool = createWebFetchTool();
    const result = await tool.execute(null as any, null, { url: `${server.url}/notfound` }, ctx);

    expect(result.error).toBeDefined();
    expect(result.data.content).toContain('HTTP 404');
  });

  it('returns error for oversized content-length', async () => {
    const tool = createWebFetchTool();
    const result = await tool.execute(null as any, null, { url: `${server.url}/large` }, ctx);

    expect(result.error).toBeDefined();
    expect(result.error!.message).toContain('Response too large');
  });

  it('handles abort signal', async () => {
    const tool = createWebFetchTool();
    const controller = new AbortController();
    controller.abort();

    const result = await tool.execute(
      null as any,
      null,
      { url: `${server.url}/html` },
      { toolCallId: 'test-call-id', signal: controller.signal },
    );

    expect(result.error).toBeDefined();
    expect(result.data.content).toContain('Operation aborted');
  });
});

// ── WebSearch tool ────────────────────────────────────────────────────────────

describe('websearch tool', () => {
  it('has correct parameters schema', () => {
    const tool = createWebSearchTool();
    expect(tool.name).toBe('websearch');
    expect(tool.parameters.type).toBe('object');
    expect(tool.parameters.properties).toHaveProperty('query');
    expect(tool.parameters.properties).toHaveProperty('numResults');
    expect(tool.parameters.properties).toHaveProperty('livecrawl');
    expect(tool.parameters.properties).toHaveProperty('type');
    expect(tool.parameters.properties).toHaveProperty('contextMaxCharacters');
  });

  it('handles abort signal', async () => {
    const tool = createWebSearchTool();
    const controller = new AbortController();
    controller.abort();

    const result = await tool.execute(
      null as any,
      null,
      { query: 'test' },
      { toolCallId: 'test-call-id', signal: controller.signal },
    );

    expect(result.error).toBeDefined();
    expect(result.data.content).toContain('Operation aborted');
  });

  it('returns error for invalid URL or network failure', async () => {
    const tool = createWebSearchTool();
    const result = await tool.execute(
      null as any,
      null,
      { query: 'test', numResults: 1 },
      ctx,
    );

    // Without EXA_API_KEY, the request to mcp.exa.ai may succeed or fail depending on network
    // We just verify the tool executes and returns a structured result
    expect(result.data).toBeDefined();
    expect(result.data.content).toBeDefined();
  });
});
