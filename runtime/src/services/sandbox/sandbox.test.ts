import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { SandboxService } from './index.js';
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync, mkdtempSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import type { App } from '../../app.js';
import type { Skill, SkillFile } from '../../skills/index.js';

// ─── Test doubles ────────────────────────────────────────────────────────────

interface InMemoryFile {
  name: string;
  content: string | Buffer;
}

class FakeSession {
  id: string;
  tempFiles: InMemoryFile[] = [];
  contextFiles: Array<{ path: string }> = [];
  contextFoldersInfos: Array<{ path: string }> = [];

  constructor(id: string) {
    this.id = id;
  }

  async writeTempFile(file: { name: string; content: string | Buffer }): Promise<this> {
    const idx = this.tempFiles.findIndex((f) => f.name === file.name);
    if (idx >= 0) this.tempFiles[idx] = file;
    else this.tempFiles.push(file);
    return this;
  }

  async removeTempFile(name: string): Promise<this> {
    this.tempFiles = this.tempFiles.filter((f) => f.name !== name);
    return this;
  }
}

function makeSkill(opts: { name: string; runtime: string; files?: SkillFile[] }): Skill {
  return {
    location: '/fake/location',
    name: opts.name,
    description: `Test skill ${opts.name}`,
    runtime: opts.runtime,
    readSkillMd: async () => '# fake',
    readContent: async () => opts.files ?? [],
  };
}

const mockApp = {} as App;

// ─── Test setup ──────────────────────────────────────────────────────────────

describe('SandboxService', () => {
  let testCwd: string;
  let realmRoot: string;
  let service: SandboxService;

  beforeAll(async () => {
    testCwd = mkdtempSync(join(tmpdir(), 'sandbox-test-'));
    realmRoot = mkdtempSync(join(tmpdir(), 'sandbox-realm-'));

    const sandboxDir = resolve(testCwd, 'src/sandbox/runtimes');
    const skillsDir = resolve(testCwd, 'src/skills');
    mkdirSync(resolve(sandboxDir, 'shared-test'), { recursive: true });
    mkdirSync(resolve(sandboxDir, 'exclusive-test'), { recursive: true });
    mkdirSync(skillsDir, { recursive: true });

    writeFileSync(
      resolve(sandboxDir, 'shared-test/config.json'),
      JSON.stringify({
        name: 'shared-test',
        image: 'generic-runtime:latest',
        mode: 'shared',
        limit: 2,
        network: 'none',
        executionTimeout: 30000,
      }),
    );
    writeFileSync(
      resolve(sandboxDir, 'exclusive-test/config.json'),
      JSON.stringify({
        name: 'exclusive-test',
        image: 'generic-runtime:latest',
        mode: 'exclusive',
        limit: 2,
        network: 'none',
        executionTimeout: 30000,
      }),
    );
    writeFileSync(
      resolve(skillsDir, 'skill-runtimes.json'),
      JSON.stringify({ 'shared-skill': 'shared-test', 'exclusive-skill': 'exclusive-test' }),
    );

    service = new SandboxService(mockApp, { cwd: testCwd, realmRoot });
    await service.start();
  }, 60000);

  afterAll(async () => {
    await service.stop();
    rmSync(testCwd, { recursive: true, force: true });
    rmSync(realmRoot, { recursive: true, force: true });
  }, 60000);

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  describe('Lifecycle', () => {
    it('starts and creates per-runtime mode dirs', () => {
      expect(existsSync(join(realmRoot, 'shared-test/shared'))).toBe(true);
      expect(existsSync(join(realmRoot, 'exclusive-test/exclusive'))).toBe(true);
    });

    it('loads runtime configs', () => {
      const configs = service.getRuntimeConfigs();
      expect(configs.has('shared-test')).toBe(true);
      expect(configs.has('exclusive-test')).toBe(true);
      expect(configs.get('shared-test')!.mode).toBe('shared');
      expect(configs.get('exclusive-test')!.mode).toBe('exclusive');
    });

    it('does NOT spawn containers eagerly', () => {
      // shared container is lazy
      expect(service['sharedContainers'].size).toBe(0);
    });
  });

  // ─── Skill runtime mapping ───────────────────────────────────────────────

  describe('Skill runtime mapping', () => {
    it('returns runtime for known skill', () => {
      expect(service.getRuntimeForSkill('shared-skill')).toBe('shared-test');
      expect(service.getRuntimeForSkill('exclusive-skill')).toBe('exclusive-test');
    });

    it('returns null for unknown skill', () => {
      expect(service.getRuntimeForSkill('unknown')).toBeNull();
    });
  });

  // ─── Shared mode ─────────────────────────────────────────────────────────

  describe('Shared mode', () => {
    let session: FakeSession;
    const skill = makeSkill({ name: 'shared-skill', runtime: 'shared-test' });

    beforeEach(async () => {
      session = new FakeSession(`shared-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
      await service.createSkillSession({ session: session as any, skill });
    }, 60000);

    afterEach(async () => {
      try {
        await service.cleanupSkillSession({ session: session as any });
      } catch {}
    }, 30000);

    it('lazy-spawns the shared container on first session', () => {
      expect(service['sharedContainers'].has('shared-test')).toBe(true);
    });

    it('reuses the shared container across sessions', async () => {
      const firstId = service['sharedContainers'].get('shared-test')!.id;
      const session2 = new FakeSession('shared-second');
      await service.createSkillSession({ session: session2 as any, skill });
      const secondId = service['sharedContainers'].get('shared-test')!.id;
      expect(secondId).toBe(firstId);
      await service.cleanupSkillSession({ session: session2 as any });
    }, 60000);

    it('cleanup removes session realm folder; container stays alive', async () => {
      const realm = join(realmRoot, 'shared-test/shared', session.id);
      expect(existsSync(realm)).toBe(true);
      const containerId = service['sharedContainers'].get('shared-test')!.id;
      await service.cleanupSkillSession({ session: session as any });
      expect(existsSync(realm)).toBe(false);
      expect(service['sharedContainers'].get('shared-test')!.id).toBe(containerId);
    });

    it('runs simple commands', async () => {
      const r = await service.executeSkillCommands({
        session: session as any,
        commands: ['echo hello'],
      });
      expect(r.results[0].stdout).toContain('hello');
    }, 30000);

    it('rejects context files for shared runtime', async () => {
      const blockedSession = new FakeSession('shared-blocked');
      blockedSession.contextFiles = [{ path: '/etc/hostname' }];
      await expect(
        service.createSkillSession({ session: blockedSession as any, skill }),
      ).rejects.toThrow(/cannot have context mounts/);
    });
  });

  // ─── Exclusive mode ──────────────────────────────────────────────────────

  describe('Exclusive mode', () => {
    let session: FakeSession;
    const skill = makeSkill({ name: 'exclusive-skill', runtime: 'exclusive-test' });

    beforeEach(async () => {
      session = new FakeSession(
        `exclusive-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      );
      await service.createSkillSession({ session: session as any, skill });
    }, 60000);

    afterEach(async () => {
      try {
        await service.cleanupSkillSession({ session: session as any });
      } catch {}
    }, 30000);

    it('spawns a fresh container per session', () => {
      const set = service['exclusiveContainers'].get('exclusive-test')!;
      expect(set.size).toBe(1);
    });

    it('cleanup destroys the container', async () => {
      const set = service['exclusiveContainers'].get('exclusive-test')!;
      expect(set.size).toBe(1);
      await service.cleanupSkillSession({ session: session as any });
      expect(set.size).toBe(0);
    }, 30000);

    it('runs simple commands at /workspace', async () => {
      const r = await service.executeSkillCommands({
        session: session as any,
        commands: ['pwd'],
      });
      expect(r.results[0].stdout.trim()).toBe('/workspace');
    }, 30000);
  });

  // ─── Sync-in (realm ← session) ───────────────────────────────────────────

  describe('Sync-in', () => {
    let session: FakeSession;
    const skill = makeSkill({ name: 'shared-skill', runtime: 'shared-test' });

    beforeEach(async () => {
      session = new FakeSession(`sync-in-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
      await service.createSkillSession({ session: session as any, skill });
    }, 60000);

    afterEach(async () => {
      try {
        await service.cleanupSkillSession({ session: session as any });
      } catch {}
    }, 30000);

    it('writes new temp files into the realm before commands', async () => {
      session.tempFiles.push({ name: 'note.txt', content: 'fresh' });
      await service.executeSkillCommands({ session: session as any, commands: ['true'] });
      const realmFile = join(realmRoot, 'shared-test/shared', session.id, 'note.txt');
      expect(readFileSync(realmFile, 'utf-8')).toBe('fresh');
    }, 30000);

    it('removes temp files from realm when session removes them', async () => {
      session.tempFiles.push({ name: 'doomed.txt', content: 'bye' });
      await service.executeSkillCommands({ session: session as any, commands: ['true'] });
      const realmFile = join(realmRoot, 'shared-test/shared', session.id, 'doomed.txt');
      expect(existsSync(realmFile)).toBe(true);

      await session.removeTempFile('doomed.txt');
      await service.executeSkillCommands({ session: session as any, commands: ['true'] });
      expect(existsSync(realmFile)).toBe(false);
    }, 30000);

    it('updates realm temp file content when session changes it', async () => {
      session.tempFiles.push({ name: 'mut.txt', content: 'v1' });
      await service.executeSkillCommands({ session: session as any, commands: ['true'] });
      const realmFile = join(realmRoot, 'shared-test/shared', session.id, 'mut.txt');
      expect(readFileSync(realmFile, 'utf-8')).toBe('v1');

      // Mutate the session's temp file content (e.g., user edit between calls)
      await session.writeTempFile({ name: 'mut.txt', content: 'v2' });
      await service.executeSkillCommands({ session: session as any, commands: ['true'] });
      expect(readFileSync(realmFile, 'utf-8')).toBe('v2');
    }, 30000);
  });

  // ─── Sync-out (session ← realm) ──────────────────────────────────────────

  describe('Sync-out', () => {
    let session: FakeSession;
    const skill = makeSkill({ name: 'shared-skill', runtime: 'shared-test' });

    beforeEach(async () => {
      session = new FakeSession(`sync-out-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
      await service.createSkillSession({ session: session as any, skill });
    }, 60000);

    afterEach(async () => {
      try {
        await service.cleanupSkillSession({ session: session as any });
      } catch {}
    }, 30000);

    it('captures new top-level files written by the skill', async () => {
      await service.executeSkillCommands({
        session: session as any,
        commands: ['echo skill-output > result.txt'],
      });
      const f = session.tempFiles.find((x) => x.name === 'result.txt');
      expect(f).toBeDefined();
      const content = Buffer.isBuffer(f!.content) ? f!.content.toString('utf-8') : f!.content;
      expect(content.trim()).toBe('skill-output');
    }, 30000);

    it('updates an existing temp file modified by the skill', async () => {
      session.tempFiles.push({ name: 'live.txt', content: 'before' });
      await service.executeSkillCommands({ session: session as any, commands: ['true'] });
      await service.executeSkillCommands({
        session: session as any,
        commands: ['echo after > live.txt'],
      });
      const f = session.tempFiles.find((x) => x.name === 'live.txt')!;
      const content = Buffer.isBuffer(f.content) ? f.content.toString('utf-8') : f.content;
      expect(content.trim()).toBe('after');
    }, 30000);

    it('removes temp files deleted by the skill', async () => {
      session.tempFiles.push({ name: 'kill-me.txt', content: 'x' });
      await service.executeSkillCommands({ session: session as any, commands: ['true'] });
      expect(session.tempFiles.find((x) => x.name === 'kill-me.txt')).toBeDefined();

      await service.executeSkillCommands({
        session: session as any,
        commands: ['rm kill-me.txt'],
      });
      expect(session.tempFiles.find((x) => x.name === 'kill-me.txt')).toBeUndefined();
    }, 30000);

    it('round-trips binary content as Buffer', async () => {
      const random = Buffer.alloc(256);
      for (let i = 0; i < 256; i++) random[i] = i;

      // Write a binary blob inside the container so sync-out reads it
      const b64 = random.toString('base64');
      await service.executeSkillCommands({
        session: session as any,
        commands: [`echo '${b64}' | base64 -d > blob.bin`],
      });

      const f = session.tempFiles.find((x) => x.name === 'blob.bin');
      expect(f).toBeDefined();
      expect(Buffer.isBuffer(f!.content)).toBe(true);
      expect((f!.content as Buffer).length).toBe(256);
      expect((f!.content as Buffer).compare(random)).toBe(0);
    }, 30000);

    it('ignores top-level subdirectories created by the skill', async () => {
      await service.executeSkillCommands({
        session: session as any,
        commands: ['mkdir stray-dir', 'echo x > stray-dir/file.txt'],
      });
      // stray-dir is a directory at the realm top; should NOT be in tempFiles
      expect(session.tempFiles.find((x) => x.name === 'stray-dir')).toBeUndefined();
    }, 30000);
  });

  // ─── Context entries (exclusive mode only) ───────────────────────────────

  describe('Context entries (exclusive)', () => {
    let session: FakeSession;
    let hostFilePath: string;
    let hostFolderPath: string;
    const skill = makeSkill({ name: 'exclusive-skill', runtime: 'exclusive-test' });

    beforeEach(async () => {
      const dir = mkdtempSync(join(tmpdir(), 'sandbox-host-'));
      hostFilePath = join(dir, 'doc.txt');
      writeFileSync(hostFilePath, 'host-content');
      hostFolderPath = join(dir, 'project');
      mkdirSync(hostFolderPath, { recursive: true });
      writeFileSync(join(hostFolderPath, 'a.txt'), 'aaa');

      session = new FakeSession(`ctx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
      session.contextFiles = [{ path: hostFilePath }];
      session.contextFoldersInfos = [{ path: hostFolderPath }];

      await service.createSkillSession({ session: session as any, skill });
    }, 60000);

    afterEach(async () => {
      try {
        await service.cleanupSkillSession({ session: session as any });
      } catch {}
    }, 30000);

    it('mounts host file at create time and exposes its content', async () => {
      const r = await service.executeSkillCommands({
        session: session as any,
        commands: ['cat doc.txt'],
      });
      expect(r.results[0].stdout).toContain('host-content');
    }, 30000);

    it('mounts host folder at create time and exposes its contents', async () => {
      const r = await service.executeSkillCommands({
        session: session as any,
        commands: ['cat project/a.txt'],
      });
      expect(r.results[0].stdout).toContain('aaa');
    }, 30000);

    it('skill edits to mounted file flow through to host immediately', async () => {
      await service.executeSkillCommands({
        session: session as any,
        commands: ['echo edited > doc.txt'],
      });
      expect(readFileSync(hostFilePath, 'utf-8').trim()).toBe('edited');
    }, 30000);

    it('skill edits to file in mounted folder flow through to host immediately', async () => {
      await service.executeSkillCommands({
        session: session as any,
        commands: ['echo bbb > project/a.txt', 'echo new > project/b.txt'],
      });
      expect(readFileSync(join(hostFolderPath, 'a.txt'), 'utf-8').trim()).toBe('bbb');
      expect(readFileSync(join(hostFolderPath, 'b.txt'), 'utf-8').trim()).toBe('new');
    }, 30000);

    it('writes path-map.json to .meta', async () => {
      const realm = join(realmRoot, 'exclusive-test/exclusive', session.id);
      const mapPath = join(realm, '.meta/path-map.json');
      expect(existsSync(mapPath)).toBe(true);
      const map = JSON.parse(readFileSync(mapPath, 'utf-8'));
      expect(map['/workspace/doc.txt']).toBe(hostFilePath);
      expect(map['/workspace/project']).toBe(hostFolderPath);
    });

    it('ignores removal of a mounted context file (cannot unmount)', async () => {
      // Removing a mounted file from the session must NOT throw and
      // must NOT change the entry — mount stays live for the container's lifetime.
      session.contextFiles = [];
      await service.executeSkillCommands({ session: session as any, commands: ['true'] });

      // Skill can still read the mounted file via its realm name (still mounted).
      const r = await service.executeSkillCommands({
        session: session as any,
        commands: ['cat doc.txt'],
      });
      expect(r.results[0].stdout).toContain('host-content');

      // The entry is still tracked internally as mounted.
      const state = (service as any).sessions.get(session.id);
      const entries = [...state.contextEntries.values()];
      const docEntry = entries.find((e: any) => e.realmName === 'doc.txt');
      expect(docEntry).toBeDefined();
      expect(docEntry.state).toBe('mounted');
    }, 30000);

    it('empties host folder when a mounted context folder is removed from session', async () => {
      // Pre-condition: host folder has a.txt
      expect(existsSync(join(hostFolderPath, 'a.txt'))).toBe(true);

      session.contextFoldersInfos = [];
      await service.executeSkillCommands({ session: session as any, commands: ['true'] });

      // Host folder still exists (mount is still live), but its children are gone.
      expect(existsSync(hostFolderPath)).toBe(true);
      expect(existsSync(join(hostFolderPath, 'a.txt'))).toBe(false);
    }, 30000);
  });

  // ─── Context entries: copied state (mid-session adds) ────────────────────

  describe('Context entries (copied, mid-session)', () => {
    let session: FakeSession;
    let hostFilePath: string;
    const skill = makeSkill({ name: 'exclusive-skill', runtime: 'exclusive-test' });

    beforeEach(async () => {
      const dir = mkdtempSync(join(tmpdir(), 'sandbox-host-'));
      hostFilePath = join(dir, 'late.txt');
      writeFileSync(hostFilePath, 'late-content');

      session = new FakeSession(
        `copied-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      );
      // No context entries at create time
      await service.createSkillSession({ session: session as any, skill });
    }, 60000);

    afterEach(async () => {
      try {
        await service.cleanupSkillSession({ session: session as any });
      } catch {}
    }, 30000);

    it('copies a context file added mid-session into the realm', async () => {
      session.contextFiles.push({ path: hostFilePath });
      await service.executeSkillCommands({ session: session as any, commands: ['true'] });

      const realm = join(realmRoot, 'exclusive-test/exclusive', session.id, 'late.txt');
      expect(existsSync(realm)).toBe(true);
      expect(readFileSync(realm, 'utf-8')).toBe('late-content');
    }, 30000);

    it('flushes copied context file edits back to host on sync-out', async () => {
      session.contextFiles.push({ path: hostFilePath });
      await service.executeSkillCommands({ session: session as any, commands: ['true'] });
      await service.executeSkillCommands({
        session: session as any,
        commands: ['echo updated > late.txt'],
      });
      expect(readFileSync(hostFilePath, 'utf-8').trim()).toBe('updated');
    }, 30000);

    it('removes the realm copy when a copied context file is removed from session', async () => {
      session.contextFiles.push({ path: hostFilePath });
      await service.executeSkillCommands({ session: session as any, commands: ['true'] });

      const realm = join(realmRoot, 'exclusive-test/exclusive', session.id, 'late.txt');
      expect(existsSync(realm)).toBe(true);

      session.contextFiles = [];
      await service.executeSkillCommands({ session: session as any, commands: ['true'] });
      expect(existsSync(realm)).toBe(false);
    }, 30000);

    it('mirrors copied folder back to host with adds, mods, AND deletions on sync-out', async () => {
      // Build a host folder with two files: keep.txt and gone.txt
      const folderHost = mkdtempSync(join(tmpdir(), 'sandbox-folder-'));
      writeFileSync(join(folderHost, 'keep.txt'), 'original');
      writeFileSync(join(folderHost, 'gone.txt'), 'will-be-deleted');

      try {
        // Add the folder mid-session (after createSkillSession, so it's 'copied')
        session.contextFoldersInfos.push({ path: folderHost });
        await service.executeSkillCommands({ session: session as any, commands: ['true'] });

        const folderName = basename(folderHost);
        const realm = join(
          realmRoot,
          'exclusive-test/exclusive',
          session.id,
          folderName,
        );
        // Realm should now contain both files (copied)
        expect(readFileSync(join(realm, 'keep.txt'), 'utf-8')).toBe('original');
        expect(readFileSync(join(realm, 'gone.txt'), 'utf-8')).toBe('will-be-deleted');

        // Skill: modify keep.txt, delete gone.txt, add new.txt
        await service.executeSkillCommands({
          session: session as any,
          commands: [
            `echo modified > ${folderName}/keep.txt`,
            `rm ${folderName}/gone.txt`,
            `echo brand-new > ${folderName}/new.txt`,
          ],
        });

        // Host folder should mirror all three changes
        expect(readFileSync(join(folderHost, 'keep.txt'), 'utf-8').trim()).toBe('modified');
        expect(existsSync(join(folderHost, 'gone.txt'))).toBe(false);
        expect(readFileSync(join(folderHost, 'new.txt'), 'utf-8').trim()).toBe('brand-new');
      } finally {
        rmSync(folderHost, { recursive: true, force: true });
      }
    }, 60000);
  });

  // ─── Concurrency ─────────────────────────────────────────────────────────

  describe('Concurrency', () => {
    const skill = makeSkill({ name: 'shared-skill', runtime: 'shared-test' });

    it('serializes executeSkillCommands for the same session via syncMutex', async () => {
      const session = new FakeSession(
        `serialize-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      );
      await service.createSkillSession({ session: session as any, skill });

      try {
        const realm = join(realmRoot, 'shared-test/shared', session.id);
        const t0 = Date.now();
        const [a, b] = await Promise.all([
          service.executeSkillCommands({
            session: session as any,
            commands: [`sleep 1 && echo first-$(date +%s%N) > marker.txt`],
          }),
          service.executeSkillCommands({
            session: session as any,
            commands: [`sleep 1 && echo second-$(date +%s%N) >> marker.txt`],
          }),
        ]);
        const elapsed = Date.now() - t0;
        // If serialized: ~2s; if parallel: ~1s. Assert at least 1.8s.
        expect(elapsed).toBeGreaterThanOrEqual(1800);
        expect(a.results[0].stderr).not.toContain('timeout');
        expect(b.results[0].stderr).not.toContain('timeout');
        expect(existsSync(join(realm, 'marker.txt'))).toBe(true);
      } finally {
        await service.cleanupSkillSession({ session: session as any });
      }
    }, 60000);
  });

  // ─── Errors ──────────────────────────────────────────────────────────────

  describe('Errors', () => {
    it('createSkillSession on unknown runtime throws', async () => {
      const session = new FakeSession('err-1');
      const skill = makeSkill({ name: 'mystery', runtime: 'no-such-runtime' });
      await expect(
        service.createSkillSession({ session: session as any, skill }),
      ).rejects.toThrow(/Unknown runtime/);
    });

    it('createSkillSession when skill has no runtime throws', async () => {
      const session = new FakeSession('err-2');
      const skill = makeSkill({ name: 'mystery', runtime: '' });
      // runtime '' is falsy
      (skill as any).runtime = undefined;
      await expect(
        service.createSkillSession({ session: session as any, skill }),
      ).rejects.toThrow(/no runtime/);
    });

    it('executeSkillCommands for unknown session throws', async () => {
      const session = new FakeSession('err-3-unknown');
      await expect(
        service.executeSkillCommands({ session: session as any, commands: ['true'] }),
      ).rejects.toThrow(/No skill session/);
    });

    it('cleanupSkillSession for unknown session throws', async () => {
      const session = new FakeSession('err-4-unknown');
      await expect(service.cleanupSkillSession({ session: session as any })).rejects.toThrow(
        /No skill session/,
      );
    });

    it('createSkillSession before start throws', async () => {
      const fresh = new SandboxService(mockApp, { cwd: testCwd, realmRoot });
      const session = new FakeSession('err-5');
      const skill = makeSkill({ name: 'shared-skill', runtime: 'shared-test' });
      await expect(
        fresh.createSkillSession({ session: session as any, skill }),
      ).rejects.toThrow(/not started/);
    });
  });

  // ─── Timeout ─────────────────────────────────────────────────────────────

  describe('Timeout', () => {
    const skill = makeSkill({ name: 'shared-skill', runtime: 'shared-test' });

    it('kills commands exceeding executionTimeout and still runs sync-out', async () => {
      // Build a fresh service with a very short timeout
      const shortCwd = mkdtempSync(join(tmpdir(), 'sandbox-short-'));
      const shortRealm = mkdtempSync(join(tmpdir(), 'sandbox-short-realm-'));
      const sandboxDir = resolve(shortCwd, 'src/sandbox/runtimes');
      const skillsDir = resolve(shortCwd, 'src/skills');
      mkdirSync(resolve(sandboxDir, 'shared-test'), { recursive: true });
      mkdirSync(skillsDir, { recursive: true });
      writeFileSync(
        resolve(sandboxDir, 'shared-test/config.json'),
        JSON.stringify({
          name: 'shared-test',
          image: 'generic-runtime:latest',
          mode: 'shared',
          limit: 2,
          network: 'none',
          executionTimeout: 1500,
        }),
      );
      writeFileSync(
        resolve(skillsDir, 'skill-runtimes.json'),
        JSON.stringify({ 'shared-skill': 'shared-test' }),
      );

      const shortService = new SandboxService(mockApp, { cwd: shortCwd, realmRoot: shortRealm });
      await shortService.start();

      const session = new FakeSession('timeout-1');
      try {
        await shortService.createSkillSession({ session: session as any, skill });
        const r = await shortService.executeSkillCommands({
          session: session as any,
          commands: ['sleep 30', 'echo unreachable'],
        });
        expect(r.results[0].stderr).toContain('timeout');
        // Subsequent command after a timeout is skipped
        expect(r.results.length).toBe(1);
      } finally {
        await shortService.cleanupSkillSession({ session: session as any }).catch(() => {});
        await shortService.stop();
        rmSync(shortCwd, { recursive: true, force: true });
        rmSync(shortRealm, { recursive: true, force: true });
      }
    }, 60000);
  });

  // ─── Path collisions ─────────────────────────────────────────────────────

  describe('Path collisions', () => {
    const skill = makeSkill({ name: 'exclusive-skill', runtime: 'exclusive-test' });

    it('dedupes context files with the same basename', async () => {
      const dirA = mkdtempSync(join(tmpdir(), 'sb-collide-a-'));
      const dirB = mkdtempSync(join(tmpdir(), 'sb-collide-b-'));
      writeFileSync(join(dirA, 'report.txt'), 'A');
      writeFileSync(join(dirB, 'report.txt'), 'B');

      const session = new FakeSession(
        `collide-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      );
      session.contextFiles = [{ path: join(dirA, 'report.txt') }, { path: join(dirB, 'report.txt') }];

      try {
        await service.createSkillSession({ session: session as any, skill });
        const r = await service.executeSkillCommands({
          session: session as any,
          commands: ['ls', 'cat report.txt', 'cat report.dup.1.txt'],
        });
        expect(r.results[0].stdout).toContain('report.txt');
        expect(r.results[0].stdout).toContain('report.dup.1.txt');
        // The two reads return A and B in some order — both must show up
        const combined = r.results[1].stdout + r.results[2].stdout;
        expect(combined).toContain('A');
        expect(combined).toContain('B');
      } finally {
        await service.cleanupSkillSession({ session: session as any }).catch(() => {});
        rmSync(dirA, { recursive: true, force: true });
        rmSync(dirB, { recursive: true, force: true });
      }
    }, 60000);
  });
});
