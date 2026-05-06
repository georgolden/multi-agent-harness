import { describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { enforceFsScope, isPathInScope, isSecretPath } from './fs-scope.js';
import { createReadTool } from './read.js';
import { createWriteTool } from './write.js';

describe('isSecretPath', () => {
  it('flags common secret files', () => {
    expect(isSecretPath('/home/u/project/.env')).toBe(true);
    expect(isSecretPath('/home/u/project/.env.production')).toBe(true);
    expect(isSecretPath('/home/u/.aws/credentials')).toBe(true);
    expect(isSecretPath('/home/u/.ssh/id_rsa')).toBe(true);
    expect(isSecretPath('/srv/private-key.pem')).toBe(true);
    expect(isSecretPath('/etc/kubeconfig')).toBe(true);
  });

  it('does not flag normal source files', () => {
    expect(isSecretPath('/home/u/project/src/index.ts')).toBe(false);
    expect(isSecretPath('/home/u/project/README.md')).toBe(false);
    expect(isSecretPath('/home/u/project/package.json')).toBe(false);
  });
});

describe('isPathInScope', () => {
  it('admits a file at or under an allowed root', () => {
    expect(isPathInScope('/work/proj/src/x.ts', ['/work/proj'])).toBe(true);
    expect(isPathInScope('/work/proj', ['/work/proj'])).toBe(true);
  });

  it('rejects a file outside any allowed root', () => {
    expect(isPathInScope('/work/other/x.ts', ['/work/proj'])).toBe(false);
    expect(isPathInScope('/etc/passwd', ['/work/proj'])).toBe(false);
  });

  it('does not treat a sibling prefix as an ancestor', () => {
    expect(isPathInScope('/work/proj-evil/x.ts', ['/work/proj'])).toBe(false);
  });

  it('skips relative entries in the allowed list', () => {
    expect(isPathInScope('/work/proj/x.ts', ['relative/path'])).toBe(false);
  });
});

describe('enforceFsScope', () => {
  it('blocks secret paths regardless of scope', () => {
    const r = enforceFsScope({
      absolutePath: '/work/proj/.env',
      mode: 'read',
      security: { fsScope: { allowedReadPaths: ['/work/proj'], allowedWritePaths: [], outOfScopePolicy: 'deny' } },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('secret-blocklist');
  });

  it('blocks secret paths even when no scope is configured', () => {
    const r = enforceFsScope({ absolutePath: '/home/u/.aws/credentials', mode: 'read' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('secret-blocklist');
  });

  it('allows paths in scope when scope is configured', () => {
    const r = enforceFsScope({
      absolutePath: '/work/proj/src/x.ts',
      mode: 'read',
      security: { fsScope: { allowedReadPaths: ['/work/proj'], allowedWritePaths: [], outOfScopePolicy: 'deny' } },
    });
    expect(r.ok).toBe(true);
  });

  it('blocks out-of-scope paths under deny policy', () => {
    const r = enforceFsScope({
      absolutePath: '/etc/hosts',
      mode: 'read',
      security: { fsScope: { allowedReadPaths: ['/work/proj'], allowedWritePaths: [], outOfScopePolicy: 'deny' } },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('out-of-scope');
  });

  it('uses allowedWritePaths in write mode', () => {
    const sec = {
      fsScope: {
        allowedReadPaths: ['/work/proj'],
        allowedWritePaths: ['/work/proj/src'],
        outOfScopePolicy: 'deny' as const,
      },
    };
    expect(enforceFsScope({ absolutePath: '/work/proj/src/x.ts', mode: 'write', security: sec }).ok).toBe(true);
    expect(enforceFsScope({ absolutePath: '/work/proj/README.md', mode: 'write', security: sec }).ok).toBe(false);
  });

  it('passes through when no scope and not a secret', () => {
    const r = enforceFsScope({ absolutePath: '/some/random/path.txt', mode: 'read' });
    expect(r.ok).toBe(true);
  });
});

describe('fs tools honor security config end-to-end', () => {
  it('read returns an error message when given an out-of-scope path', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fs-scope-read-'));
    try {
      const file = path.join(tmp, 'note.txt');
      await fs.writeFile(file, 'hello');

      const allowedRoot = path.join(tmp, 'allowed');
      await fs.mkdir(allowedRoot);
      const readTool = createReadTool(tmp, {
        security: {
          fsScope: { allowedReadPaths: [allowedRoot], allowedWritePaths: [], outOfScopePolicy: 'deny' },
        },
      });
      const result = await readTool.execute({} as any, {} as any, { filePath: file } as any, { toolCallId: 't1' });
      expect(result.error).toBeInstanceOf(Error);
      expect(String(result.error?.message)).toContain('outside the allowed read paths');
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('write refuses to overwrite a secret-pattern path', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fs-scope-write-'));
    try {
      const writeTool = createWriteTool(tmp);
      const target = path.join(tmp, '.env');
      const result = await writeTool.execute(
        {} as any,
        {} as any,
        { filePath: target, content: 'API_KEY=hax' } as any,
        { toolCallId: 't2' },
      );
      expect(result.error).toBeInstanceOf(Error);
      expect(String(result.error?.message)).toContain('secret pattern blocklist');
      // Confirm the file was not actually written.
      await expect(fs.access(target)).rejects.toBeTruthy();
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
