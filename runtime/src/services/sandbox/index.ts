/**
 * SandboxService — bind-mount-based sandbox for skill execution.
 *
 * Each skill execution gets a per-session host realm folder. Context files and
 * folders are bind-mounted from the host into the container; temp files are
 * synced both ways around every command batch.
 *
 * Public API:
 *   start() / stop()
 *   createSkillSession({ session, skill })
 *   executeSkillCommands({ session, commands })
 *   cleanupSkillSession({ session })
 *   getRuntimeForSkill(skillName)
 *   getRuntimeConfigs()
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import {
  access,
  cp,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import type { RuntimeConfig, SandboxMode } from '../../sandbox/types.js';
import { SANDBOX_REALM_ROOT } from '../../sandbox/constants.js';
import type { App } from '../../app.js';
import type { Skill } from '../../skills/index.js';
import type { Session } from '../sessionService/session.js';

const execFileAsync = promisify(execFile);

// ─── Async lock ──────────────────────────────────────────────────────────────

class AsyncLock {
  private q: Promise<void> = Promise.resolve();
  acquire(): Promise<() => void> {
    let release!: () => void;
    const next = new Promise<void>((r) => (release = r));
    const prev = this.q;
    this.q = this.q.then(() => next);
    return prev.then(() => release);
  }
}

// ─── Internal state types ────────────────────────────────────────────────────

interface Container {
  id: string;
  runtimeName: string;
  mode: SandboxMode;
}

type ContextEntryState = 'mounted' | 'copied';

interface ContextEntry {
  hostPath: string;
  realmName: string;
  type: 'file' | 'folder';
  state: ContextEntryState;
}

interface SkillExecutionState {
  session: Session;
  skill: Skill;
  runtimeName: string;
  mode: SandboxMode;
  container: Container;
  realmHostPath: string;
  containerWorkingDir: string;
  skillFileNames: Set<string>;
  contextEntries: Map<string, ContextEntry>;
  knownTempFileSnapshot: Map<string, Buffer>;
  syncMutex: AsyncLock;
}

interface QueuedExecution {
  runtimeName: string;
  resolve: () => void;
  reject: (e: Error) => void;
}

interface QueuedContainerSpawn {
  runtimeName: string;
  spawn: () => Promise<Container>;
  resolve: (c: Container) => void;
  reject: (e: Error) => void;
}

// ─── Public types ────────────────────────────────────────────────────────────

export interface SkillExecutionSession {
  id: string;
  runtimeName: string;
  mode: SandboxMode;
  realmHostPath: string;
  containerWorkingDir: string;
}

export interface ExecuteCommandsResult {
  results: Array<{ command: string; stdout: string; stderr: string }>;
}

export interface SandboxServiceOptions {
  cwd?: string;
  realmRoot?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toBuffer(content: string | Buffer): Buffer {
  return Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8');
}

function dedupe(name: string, used: Set<string>): string {
  if (!used.has(name)) return name;
  const ext = extname(name);
  const base = ext ? name.slice(0, -ext.length) : name;
  let n = 1;
  for (;;) {
    const candidate = `${base}.dup.${n}${ext}`;
    if (!used.has(candidate)) return candidate;
    n++;
  }
}

async function existsAsync(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function unlinkIfExists(p: string): Promise<void> {
  try {
    await unlink(p);
  } catch (err: any) {
    if (err.code !== 'ENOENT') throw err;
  }
}

async function rmRfIfExists(p: string): Promise<void> {
  await rm(p, { recursive: true, force: true });
}

async function emptyDirectory(dir: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err: any) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
  await Promise.all(entries.map((e) => rm(join(dir, e), { recursive: true, force: true })));
}

/**
 * rsync-style mirror with deletions: dst becomes a copy of src.
 * Pure-Node implementation — additions, modifications, removals all applied.
 */
async function mirrorDirectory(src: string, dst: string): Promise<void> {
  await mkdir(dst, { recursive: true });

  const srcEntries = await readdir(src, { withFileTypes: true });
  const srcNames = new Set(srcEntries.map((e) => e.name));

  // Pass 1: add/update from src into dst
  for (const e of srcEntries) {
    const sPath = join(src, e.name);
    const dPath = join(dst, e.name);
    if (e.isDirectory()) {
      await mirrorDirectory(sPath, dPath);
    } else if (e.isFile()) {
      const sBuf = await readFile(sPath);
      let needsWrite = true;
      try {
        const dBuf = await readFile(dPath);
        if (dBuf.length === sBuf.length && dBuf.compare(sBuf) === 0) needsWrite = false;
      } catch {
        // dst missing — write it
      }
      if (needsWrite) {
        // If dPath is a directory, blow it away first
        try {
          const st = await stat(dPath);
          if (st.isDirectory()) await rm(dPath, { recursive: true, force: true });
        } catch {}
        await writeFile(dPath, sBuf);
      }
    }
  }

  // Pass 2: delete entries in dst that are not in src
  let dstEntries: Array<{ name: string; isDirectory: () => boolean }>;
  try {
    dstEntries = await readdir(dst, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of dstEntries) {
    if (!srcNames.has(e.name)) {
      await rm(join(dst, e.name), { recursive: true, force: true });
    }
  }
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class SandboxService {
  private app: App;
  private sandboxDir: string;
  private skillRuntimesPath: string;
  private realmRoot: string;

  private runtimeConfigs: Map<string, RuntimeConfig> = new Map();
  private skillRuntimes: Record<string, string> = {};

  private sharedContainers: Map<string, Container> = new Map();
  private exclusiveContainers: Map<string, Set<Container>> = new Map();
  private activeExecutions: Map<string, number> = new Map();
  private executionQueue: QueuedExecution[] = [];
  private containerQueue: QueuedContainerSpawn[] = [];
  private sessions: Map<string, SkillExecutionState> = new Map();

  private isStarted = false;

  constructor(app: App, opts: SandboxServiceOptions = {}) {
    this.app = app;
    const cwd = opts.cwd ?? process.cwd();
    this.sandboxDir = resolve(cwd, 'src/sandbox/runtimes');
    this.skillRuntimesPath = resolve(cwd, 'src/skills/skill-runtimes.json');
    this.realmRoot = opts.realmRoot ?? SANDBOX_REALM_ROOT;
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.isStarted) {
      console.warn('[SandboxService] Already started');
      return;
    }

    await this.checkPodman();
    await this.loadRuntimeConfigs();
    await this.loadSkillRuntimes();

    await mkdir(this.realmRoot, { recursive: true });
    for (const [name, config] of this.runtimeConfigs) {
      await mkdir(join(this.realmRoot, name, config.mode), { recursive: true });
      this.activeExecutions.set(name, 0);
      if (config.mode === 'exclusive') this.exclusiveContainers.set(name, new Set());
    }

    this.isStarted = true;
    console.log(`[SandboxService] Started with ${this.runtimeConfigs.size} runtime(s)`);
  }

  async stop(): Promise<void> {
    if (!this.isStarted) {
      console.warn('[SandboxService] Not started');
      return;
    }

    for (const q of this.executionQueue) q.reject(new Error('SandboxService is stopping'));
    this.executionQueue = [];
    for (const q of this.containerQueue) q.reject(new Error('SandboxService is stopping'));
    this.containerQueue = [];

    const stopPromises: Promise<unknown>[] = [];
    for (const c of this.sharedContainers.values()) {
      stopPromises.push(execFileAsync('podman', ['rm', '-f', c.id]).catch(() => {}));
    }
    for (const set of this.exclusiveContainers.values()) {
      for (const c of set) {
        stopPromises.push(execFileAsync('podman', ['rm', '-f', c.id]).catch(() => {}));
      }
    }
    await Promise.allSettled(stopPromises);

    // Remove session subfolders, leave parent dirs intact
    for (const [name, config] of this.runtimeConfigs) {
      const modeDir = join(this.realmRoot, name, config.mode);
      try {
        const entries = await readdir(modeDir);
        await Promise.all(entries.map((e) => rm(join(modeDir, e), { recursive: true, force: true })));
      } catch {
        // dir gone
      }
    }

    this.sharedContainers.clear();
    this.exclusiveContainers.clear();
    this.activeExecutions.clear();
    this.sessions.clear();
    this.isStarted = false;
    console.log('[SandboxService] Stopped');
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  async createSkillSession(opts: { session: Session; skill: Skill }): Promise<SkillExecutionSession> {
    if (!this.isStarted) throw new Error('SandboxService not started. Call start() first.');

    const { session, skill } = opts;
    const runtimeName = skill.runtime;
    if (!runtimeName) throw new Error(`Skill '${skill.name}' has no runtime`);
    const config = this.runtimeConfigs.get(runtimeName);
    if (!config) throw new Error(`Unknown runtime: ${runtimeName}`);
    const mode = config.mode;

    if (this.sessions.has(session.id)) {
      throw new Error(`Session ${session.id} already has a SkillExecutionSession`);
    }

    const realmHostPath = join(this.realmRoot, runtimeName, mode, session.id);
    await mkdir(realmHostPath, { recursive: true });

    // Skill files (flat by basename)
    const skillFiles = await skill.readContent();
    const skillFileNames = new Set<string>();
    for (const f of skillFiles) {
      const name = basename(f.path);
      if (skillFileNames.has(name)) {
        throw new Error(`Skill '${skill.name}' has duplicate file basename: ${name}`);
      }
      await writeFile(join(realmHostPath, name), f.content);
      skillFileNames.add(name);
    }

    // Temp files
    const knownTempFileSnapshot = new Map<string, Buffer>();
    for (const f of session.tempFiles ?? []) {
      const buf = toBuffer(f.content);
      const target = join(realmHostPath, f.name);
      let needsWrite = true;
      try {
        const existing = await readFile(target);
        if (existing.length === buf.length && existing.compare(buf) === 0) needsWrite = false;
      } catch {
        // missing
      }
      if (needsWrite) await writeFile(target, buf);
      knownTempFileSnapshot.set(f.name, buf);
    }

    // Context entries
    const contextEntries = new Map<string, ContextEntry>();
    const usedNames = new Set<string>([...skillFileNames, ...knownTempFileSnapshot.keys()]);

    if (mode === 'shared' && (session.contextFiles.length > 0 || session.contextFoldersInfos.length > 0)) {
      throw new Error(
        `Shared runtime '${runtimeName}' cannot have context mounts (session ${session.id})`,
      );
    }

    for (const cf of session.contextFiles ?? []) {
      const realmName = dedupe(basename(cf.path), usedNames);
      usedNames.add(realmName);
      // Empty placeholder for the bind mount target
      await writeFile(join(realmHostPath, realmName), '');
      contextEntries.set(cf.path, { hostPath: cf.path, realmName, type: 'file', state: 'mounted' });
    }
    for (const cfo of session.contextFoldersInfos ?? []) {
      const realmName = dedupe(basename(cfo.path), usedNames);
      usedNames.add(realmName);
      await mkdir(join(realmHostPath, realmName), { recursive: true });
      contextEntries.set(cfo.path, { hostPath: cfo.path, realmName, type: 'folder', state: 'mounted' });
    }

    // Acquire container
    const container =
      mode === 'shared'
        ? await this.getOrSpawnSharedContainer(runtimeName, config)
        : await this.acquireExclusiveContainer(runtimeName, config, realmHostPath, contextEntries);

    const containerWorkingDir = mode === 'shared' ? `/realm/${session.id}` : '/workspace';

    // path-map.json (host bookkeeping)
    const metaDir = join(realmHostPath, '.meta');
    await mkdir(metaDir, { recursive: true });
    const pathMap: Record<string, string> = {};
    for (const e of contextEntries.values()) {
      pathMap[`${containerWorkingDir}/${e.realmName}`] = e.hostPath;
    }
    await writeFile(join(metaDir, 'path-map.json'), JSON.stringify(pathMap, null, 2));

    // For shared mode, ensure the working dir exists inside the container
    if (mode === 'shared') {
      await execFileAsync('podman', [
        'exec',
        container.id,
        'mkdir',
        '-p',
        containerWorkingDir,
      ]).catch(() => {});
    }

    const state: SkillExecutionState = {
      session,
      skill,
      runtimeName,
      mode,
      container,
      realmHostPath,
      containerWorkingDir,
      skillFileNames,
      contextEntries,
      knownTempFileSnapshot,
      syncMutex: new AsyncLock(),
    };
    this.sessions.set(session.id, state);

    console.log(
      `[SandboxService] Created skill session ${session.id} on ${runtimeName} (${mode}) container ${container.id.slice(0, 12)}`,
    );

    return {
      id: session.id,
      runtimeName,
      mode,
      realmHostPath,
      containerWorkingDir,
    };
  }

  async executeSkillCommands(opts: {
    session: Session;
    commands: string[];
  }): Promise<ExecuteCommandsResult> {
    const state = this.sessions.get(opts.session.id);
    if (!state) throw new Error(`No skill session for ${opts.session.id}`);

    const config = this.runtimeConfigs.get(state.runtimeName)!;

    const release = await state.syncMutex.acquire();
    try {
      await this.syncRealmFromSession(state);

      let executionSlot = false;
      if (state.mode === 'shared') {
        await this.acquireExecutionSlot(state.runtimeName, config);
        executionSlot = true;
      }
      try {
        const results = await this.runCommands(state, opts.commands, config);
        return { results };
      } finally {
        if (executionSlot) this.releaseExecutionSlot(state.runtimeName);
        await this.syncSessionFromRealm(state);
      }
    } finally {
      release();
    }
  }

  async cleanupSkillSession(opts: { session: Session }): Promise<void> {
    const state = this.sessions.get(opts.session.id);
    if (!state) throw new Error(`No skill session for ${opts.session.id}`);

    this.sessions.delete(opts.session.id);

    await rmRfIfExists(state.realmHostPath);

    if (state.mode === 'exclusive') {
      await execFileAsync('podman', ['rm', '-f', state.container.id]).catch(() => {});
      this.exclusiveContainers.get(state.runtimeName)?.delete(state.container);
      this.drainContainerQueue(state.runtimeName);
    }

    console.log(`[SandboxService] Cleaned up skill session ${opts.session.id}`);
  }

  getRuntimeForSkill(skillName: string): string | null {
    return this.skillRuntimes[skillName] ?? null;
  }

  getRuntimeConfigs(): Map<string, RuntimeConfig> {
    return this.runtimeConfigs;
  }

  // ─── Sync: realm ← session ───────────────────────────────────────────────

  private async syncRealmFromSession(state: SkillExecutionState): Promise<void> {
    // Temp files
    const current = new Map<string, Buffer>();
    for (const f of state.session.tempFiles ?? []) current.set(f.name, toBuffer(f.content));

    for (const [name, contentBuf] of current) {
      const realmPath = join(state.realmHostPath, name);
      let needsWrite = true;
      try {
        const existing = await readFile(realmPath);
        if (existing.length === contentBuf.length && existing.compare(contentBuf) === 0) {
          needsWrite = false;
        }
      } catch {
        // missing
      }
      if (needsWrite) await writeFile(realmPath, contentBuf);
    }

    const contextNames = new Set<string>(
      Array.from(state.contextEntries.values()).map((e) => e.realmName),
    );
    for (const name of state.knownTempFileSnapshot.keys()) {
      if (
        !current.has(name) &&
        !state.skillFileNames.has(name) &&
        !contextNames.has(name)
      ) {
        await unlinkIfExists(join(state.realmHostPath, name));
      }
    }
    state.knownTempFileSnapshot = current;

    // Context files (added mid-session → copy)
    const currentCfPaths = new Set<string>((state.session.contextFiles ?? []).map((cf) => cf.path));
    const currentCfoPaths = new Set<string>(
      (state.session.contextFoldersInfos ?? []).map((cfo) => cfo.path),
    );

    const usedNames = (): Set<string> => {
      const s = new Set<string>(state.skillFileNames);
      for (const k of state.knownTempFileSnapshot.keys()) s.add(k);
      for (const e of state.contextEntries.values()) s.add(e.realmName);
      return s;
    };

    for (const cf of state.session.contextFiles ?? []) {
      if (!state.contextEntries.has(cf.path)) {
        const realmName = dedupe(basename(cf.path), usedNames());
        await cp(cf.path, join(state.realmHostPath, realmName));
        state.contextEntries.set(cf.path, {
          hostPath: cf.path,
          realmName,
          type: 'file',
          state: 'copied',
        });
      }
    }

    for (const [hostPath, entry] of [...state.contextEntries.entries()]) {
      if (entry.type === 'file' && !currentCfPaths.has(hostPath)) {
        if (entry.state === 'copied') {
          await unlinkIfExists(join(state.realmHostPath, entry.realmName));
          state.contextEntries.delete(hostPath);
        }
        // mounted: ignore (cannot unmount)
      }
    }

    // Context folders
    for (const cfo of state.session.contextFoldersInfos ?? []) {
      if (!state.contextEntries.has(cfo.path)) {
        const realmName = dedupe(basename(cfo.path), usedNames());
        await cp(cfo.path, join(state.realmHostPath, realmName), { recursive: true });
        state.contextEntries.set(cfo.path, {
          hostPath: cfo.path,
          realmName,
          type: 'folder',
          state: 'copied',
        });
      }
    }

    for (const [hostPath, entry] of [...state.contextEntries.entries()]) {
      if (entry.type === 'folder' && !currentCfoPaths.has(hostPath)) {
        if (entry.state === 'copied') {
          await rmRfIfExists(join(state.realmHostPath, entry.realmName));
          state.contextEntries.delete(hostPath);
        } else {
          // mounted: empty host folder, keep dir mounted
          await emptyDirectory(hostPath);
        }
      }
    }
  }

  // ─── Sync: session ← realm ───────────────────────────────────────────────

  private async syncSessionFromRealm(state: SkillExecutionState): Promise<void> {
    const contextNames = new Set<string>(
      Array.from(state.contextEntries.values()).map((e) => e.realmName),
    );

    // Temp files: realm authoritative for top-level files
    const dirEntries = await readdir(state.realmHostPath, { withFileTypes: true });
    const seen = new Map<string, Buffer>();

    for (const e of dirEntries) {
      if (e.name === '.meta') continue;
      if (state.skillFileNames.has(e.name)) continue;
      if (contextNames.has(e.name)) continue;
      if (e.isDirectory()) {
        console.warn(
          `[SandboxService] Skill created top-level subdirectory '${e.name}' in flat realm; ignored on sync-out`,
        );
        continue;
      }
      if (!e.isFile()) continue;

      const filePath = join(state.realmHostPath, e.name);
      const buf = await readFile(filePath);
      const existing = (state.session.tempFiles ?? []).find((f) => f.name === e.name);
      const existingBuf = existing ? toBuffer(existing.content) : null;
      const differs =
        !existingBuf || existingBuf.length !== buf.length || existingBuf.compare(buf) !== 0;
      if (differs) {
        await state.session.writeTempFile({ name: e.name, content: buf });
      }
      seen.set(e.name, buf);
    }

    // Deletions: anything in session.tempFiles not in `seen` and not skill/context
    for (const f of [...(state.session.tempFiles ?? [])]) {
      if (state.skillFileNames.has(f.name)) continue;
      if (contextNames.has(f.name)) continue;
      if (!seen.has(f.name)) {
        await state.session.removeTempFile(f.name);
      }
    }

    state.knownTempFileSnapshot = seen;

    // Context files (copied state) — flush realm → host if differs
    for (const entry of state.contextEntries.values()) {
      if (entry.state !== 'copied' || entry.type !== 'file') continue;
      const realmPath = join(state.realmHostPath, entry.realmName);
      let realmBuf: Buffer;
      try {
        realmBuf = await readFile(realmPath);
      } catch {
        continue;
      }
      let hostBuf: Buffer | null = null;
      try {
        hostBuf = await readFile(entry.hostPath);
      } catch {
        hostBuf = null;
      }
      const differs =
        !hostBuf || hostBuf.length !== realmBuf.length || hostBuf.compare(realmBuf) !== 0;
      if (differs) await writeFile(entry.hostPath, realmBuf);
    }

    // Context folders (copied state) — rsync mirror back to host
    for (const entry of state.contextEntries.values()) {
      if (entry.state !== 'copied' || entry.type !== 'folder') continue;
      const realmDir = join(state.realmHostPath, entry.realmName);
      await mirrorDirectory(realmDir, entry.hostPath);
    }
  }

  // ─── Command runner ──────────────────────────────────────────────────────

  private async runCommands(
    state: SkillExecutionState,
    commands: string[],
    config: RuntimeConfig,
  ): Promise<Array<{ command: string; stdout: string; stderr: string }>> {
    const results: Array<{ command: string; stdout: string; stderr: string }> = [];
    for (const cmd of commands) {
      try {
        const { stdout, stderr } = await execFileAsync(
          'podman',
          ['exec', '-w', state.containerWorkingDir, state.container.id, 'bash', '-c', cmd],
          { timeout: config.executionTimeout, maxBuffer: 16 * 1024 * 1024 },
        );
        results.push({ command: cmd, stdout, stderr });
      } catch (err: any) {
        const timedOut = err.killed === true;
        results.push({
          command: cmd,
          stdout: err.stdout ?? '',
          stderr: timedOut
            ? `Command killed: exceeded ${config.executionTimeout}ms timeout`
            : err.stderr ?? err.message,
        });
        if (timedOut) break;
      }
    }
    return results;
  }

  // ─── Container acquire / release ─────────────────────────────────────────

  private async getOrSpawnSharedContainer(
    runtimeName: string,
    config: RuntimeConfig,
  ): Promise<Container> {
    const existing = this.sharedContainers.get(runtimeName);
    if (existing) return existing;

    const sharedRoot = join(this.realmRoot, runtimeName, 'shared');
    const args = [
      'run',
      '-d',
      '--name',
      `${runtimeName}-shared-${randomUUID().slice(0, 8)}`,
      `--network=${config.network}`,
      '--userns=keep-id',
      '--mount',
      `type=bind,source=${sharedRoot},target=/realm`,
      config.image,
      'sleep',
      'infinity',
    ];
    const { stdout } = await execFileAsync('podman', args);
    const id = stdout.trim();
    const container: Container = { id, runtimeName, mode: 'shared' };
    this.sharedContainers.set(runtimeName, container);
    console.log(`[SandboxService] Spawned shared ${runtimeName} container: ${id.slice(0, 12)}`);
    return container;
  }

  private async acquireExclusiveContainer(
    runtimeName: string,
    config: RuntimeConfig,
    realmHostPath: string,
    contextEntries: Map<string, ContextEntry>,
  ): Promise<Container> {
    const set = this.exclusiveContainers.get(runtimeName)!;

    const spawn = async (): Promise<Container> => {
      const args = [
        'run',
        '-d',
        '--name',
        `${runtimeName}-exclusive-${randomUUID().slice(0, 8)}`,
        `--network=${config.network}`,
        '--userns=keep-id',
        '--mount',
        `type=bind,source=${realmHostPath},target=/workspace`,
      ];
      for (const e of contextEntries.values()) {
        if (e.state !== 'mounted') continue;
        args.push('--mount', `type=bind,source=${e.hostPath},target=/workspace/${e.realmName}`);
      }
      args.push(config.image, 'sleep', 'infinity');

      const { stdout } = await execFileAsync('podman', args);
      const id = stdout.trim();
      const container: Container = { id, runtimeName, mode: 'exclusive' };
      console.log(
        `[SandboxService] Spawned exclusive ${runtimeName} container: ${id.slice(0, 12)}`,
      );
      return container;
    };

    if (set.size < config.limit) {
      const container = await spawn();
      set.add(container);
      return container;
    }

    return new Promise<Container>((resolve, reject) => {
      this.containerQueue.push({ runtimeName, spawn, resolve, reject });
      const position = this.containerQueue.filter((q) => q.runtimeName === runtimeName).length;
      console.log(
        `[SandboxService] Waiting for ${runtimeName} container slot (queue position ${position})`,
      );
    });
  }

  private drainContainerQueue(runtimeName: string): void {
    const config = this.runtimeConfigs.get(runtimeName);
    if (!config) return;
    const set = this.exclusiveContainers.get(runtimeName)!;

    const idx = this.containerQueue.findIndex((q) => q.runtimeName === runtimeName);
    if (idx === -1) return;
    if (set.size >= config.limit) return;

    const queued = this.containerQueue.splice(idx, 1)[0];
    queued
      .spawn()
      .then((c) => {
        set.add(c);
        queued.resolve(c);
      })
      .catch((err) => queued.reject(err));
  }

  // ─── Execution semaphore (shared mode) ───────────────────────────────────

  private async acquireExecutionSlot(runtimeName: string, config: RuntimeConfig): Promise<void> {
    const active = this.activeExecutions.get(runtimeName) ?? 0;
    if (active < config.limit) {
      this.activeExecutions.set(runtimeName, active + 1);
      return;
    }
    return new Promise<void>((resolve, reject) => {
      this.executionQueue.push({ runtimeName, resolve, reject });
      console.log(
        `[SandboxService] Execution queued for ${runtimeName} (${active}/${config.limit} slots in use)`,
      );
    });
  }

  private releaseExecutionSlot(runtimeName: string): void {
    const idx = this.executionQueue.findIndex((q) => q.runtimeName === runtimeName);
    if (idx !== -1) {
      const queued = this.executionQueue.splice(idx, 1)[0];
      queued.resolve();
    } else {
      const active = this.activeExecutions.get(runtimeName) ?? 0;
      this.activeExecutions.set(runtimeName, Math.max(0, active - 1));
    }
  }

  // ─── Config loading ──────────────────────────────────────────────────────

  private async loadRuntimeConfigs(): Promise<void> {
    if (!(await existsAsync(this.sandboxDir))) {
      console.warn(`[SandboxService] Sandbox runtimes directory not found: ${this.sandboxDir}`);
      return;
    }
    const entries = await readdir(this.sandboxDir);
    for (const entry of entries) {
      const entryPath = resolve(this.sandboxDir, entry);
      const configPath = resolve(entryPath, 'config.json');
      const st = await stat(entryPath);
      if (!st.isDirectory()) continue;
      if (!(await existsAsync(configPath))) continue;
      const content = await readFile(configPath, 'utf-8');
      const config: RuntimeConfig = JSON.parse(content);
      this.runtimeConfigs.set(config.name, config);
    }
  }

  private async loadSkillRuntimes(): Promise<void> {
    if (!(await existsAsync(this.skillRuntimesPath))) {
      console.warn(`[SandboxService] skill-runtimes.json not found: ${this.skillRuntimesPath}`);
      return;
    }
    const content = await readFile(this.skillRuntimesPath, 'utf-8');
    this.skillRuntimes = JSON.parse(content);
  }

  private async checkPodman(): Promise<void> {
    try {
      await execFileAsync('podman', ['--version']);
    } catch {
      throw new Error('Podman is not installed. Install: https://podman.io/getting-started/installation');
    }
  }
}
