/**
 * SandboxService - manages container pools, sessions, and execution for sandboxed workloads.
 *
 * Public API:
 *   createSession(opts)          - acquire container, create session dir, copy files, return sessionId
 *   executeCommands(opts)        - run commands in an existing session (semaphore-gated)
 *   cleanupSession(sessionId)    - remove session dir, release container
 *   getRuntimeForSkill(name)     - resolve skill name → runtime type
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, basename, extname } from 'node:path';
import type { RuntimeConfig, RuntimeType } from '../../sandbox/types.js';
import type { App } from '../../app.js';
import type { SkillFile } from '../../skills/index.js';

const execFileAsync = promisify(execFile);

// ─── Types ───────────────────────────────────────────────────────────────────

interface Container {
  id: string;
  runtimeType: RuntimeType;
  activeSessions: number;
}

interface Session {
  sessionId: string;
  runtimeType: RuntimeType;
  container: Container;
  sessionPath: string;
  createdAt: number;
}

interface QueuedContainerRequest {
  runtimeType: RuntimeType;
  resolve: (container: Container) => void;
  reject: (error: Error) => void;
}

interface QueuedExecution {
  runtimeType: RuntimeType;
  resolve: () => void;
  reject: (error: Error) => void;
}

export interface CreateSessionOptions {
  runtimeType: RuntimeType;
  /** Skill/workload files to copy into the session */
  workloadFiles: SkillFile[];
  /** Host paths of user input files to copy into the session */
  inputFiles?: string[];
  /** Optional session ID; random if omitted */
  sessionId?: string;
}

export interface ExecuteCommandsOptions {
  sessionId: string;
  commands: string[];
  /** Optional additional input files to copy before executing */
  inputFiles?: string[];
}

export interface ExecuteCommandsResult {
  /** stdout/stderr per command */
  results: { command: string; stdout: string; stderr: string }[];
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class SandboxService {
  private app: App;
  private runtimeConfigs: Map<RuntimeType, RuntimeConfig> = new Map();
  private pools: Map<RuntimeType, Container[]> = new Map();
  private sessions: Map<string, Session> = new Map();
  private containerQueue: QueuedContainerRequest[] = [];
  /** Semaphore: how many executeCommands calls are currently running per runtime */
  private activeExecutions: Map<RuntimeType, number> = new Map();
  private executionQueue: QueuedExecution[] = [];
  private isStarted = false;
  private sandboxDir: string;
  private skillRuntimesPath: string;
  private skillRuntimes: Record<string, string> = {};

  constructor(app: App, cwd: string = process.cwd()) {
    this.app = app;
    this.sandboxDir = resolve(cwd, 'src/sandbox/runtimes');
    this.skillRuntimesPath = resolve(cwd, 'src/skills/skill-runtimes.json');
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.isStarted) {
      console.warn('[SandboxService] Already started');
      return;
    }

    await this.checkPodman();
    this.loadRuntimeConfigs();
    this.loadSkillRuntimes();

    for (const runtimeType of this.runtimeConfigs.keys()) {
      this.activeExecutions.set(runtimeType, 0);
    }

    await this.warmUpPools();

    this.isStarted = true;
    console.log(`[SandboxService] Started with ${this.runtimeConfigs.size} runtime(s)`);
  }

  async stop(): Promise<void> {
    if (!this.isStarted) {
      console.warn('[SandboxService] Not started');
      return;
    }

    // Reject all queued requests
    for (const req of this.containerQueue) {
      req.reject(new Error('SandboxService is stopping'));
    }
    this.containerQueue = [];
    for (const req of this.executionQueue) {
      req.reject(new Error('SandboxService is stopping'));
    }
    this.executionQueue = [];

    // Clean up all active sessions
    for (const [sessionId] of this.sessions) {
      await this.cleanupSession(sessionId).catch(() => {});
    }

    // Stop all containers
    const stopPromises: Promise<void>[] = [];
    for (const [, containers] of this.pools) {
      for (const container of containers) {
        stopPromises.push(this.stopContainer(container));
      }
    }
    await Promise.allSettled(stopPromises);

    this.pools.clear();
    this.activeExecutions.clear();
    this.isStarted = false;
    console.log('[SandboxService] Stopped');
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Create a session: acquire a container, create session directory, copy workload and input files.
   * Returns the sessionId.
   */
  async createSession(options: CreateSessionOptions): Promise<string> {
    if (!this.isStarted) {
      throw new Error('SandboxService not started. Call start() first.');
    }

    const config = this.runtimeConfigs.get(options.runtimeType);
    if (!config) {
      throw new Error(`Unknown runtime type: ${options.runtimeType}`);
    }

    const sessionId = options.sessionId ?? `session-${randomUUID().slice(0, 12)}`;
    if (this.sessions.has(sessionId)) {
      return sessionId;
    }

    const container = await this.acquireContainer(options.runtimeType);
    const sessionPath = `/workspace/${sessionId}`;

    // Create session directory
    await this.podmanExec(container.id, ['mkdir', '-p', sessionPath]);

    // Copy workload files
    for (const file of options.workloadFiles) {
      await this.copyToContainer(container.id, file.path, `${sessionPath}/`);
    }

    // Copy input files
    if (options.inputFiles) {
      for (const hostPath of options.inputFiles) {
        await this.copyToContainer(container.id, hostPath, `${sessionPath}/`);
      }
    }

    this.sessions.set(sessionId, {
      sessionId,
      runtimeType: options.runtimeType,
      container,
      sessionPath,
      createdAt: Date.now(),
    });

    console.log(
      `[SandboxService] Session ${sessionId} created on ${options.runtimeType} container ${container.id.slice(0, 12)}`,
    );
    return sessionId;
  }

  /**
   * Execute commands in an existing session.
   * Gated by the runtime's maxParallelExecutions semaphore.
   * Input files that conflict with existing files are renamed with .old.N pattern.
   */
  async executeCommands(options: ExecuteCommandsOptions): Promise<ExecuteCommandsResult> {
    const session = this.sessions.get(options.sessionId);
    if (!session) {
      throw new Error(`Session ${options.sessionId} not found`);
    }

    const config = this.runtimeConfigs.get(session.runtimeType)!;

    // Acquire execution slot (semaphore)
    await this.acquireExecutionSlot(session.runtimeType, config);

    try {
      // Copy additional input files with conflict renaming
      if (options.inputFiles) {
        for (const hostPath of options.inputFiles) {
          await this.copyInputWithRename(session.container.id, hostPath, session.sessionPath);
        }
      }

      // Run commands sequentially, each gated by executionTimeout
      const results: { command: string; stdout: string; stderr: string }[] = [];
      for (const cmd of options.commands) {
        try {
          const { stdout, stderr } = await execFileAsync(
            'podman',
            ['exec', '-w', session.sessionPath, session.container.id, 'bash', '-c', cmd],
            { timeout: config.executionTimeout },
          );
          results.push({ command: cmd, stdout, stderr });
        } catch (err: any) {
          const timedOut = err.killed === true;
          results.push({
            command: cmd,
            stdout: err.stdout ?? '',
            stderr: timedOut
              ? `Command killed: exceeded ${config.executionTimeout}ms timeout`
              : (err.stderr ?? err.message),
          });
          // Stop executing further commands if one timed out
          if (timedOut) break;
        }
      }

      return { results };
    } finally {
      this.releaseExecutionSlot(session.runtimeType);
    }
  }

  /**
   * Clean up a session: remove session directory, release container back to pool.
   */
  async cleanupSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    this.sessions.delete(sessionId);

    // Remove session directory
    await this.podmanExec(session.container.id, ['rm', '-rf', session.sessionPath]).catch((err) =>
      console.error(`[SandboxService] Cleanup failed for ${sessionId}:`, err),
    );

    // Release container back to pool
    this.releaseContainer(session.container, session.runtimeType);

    console.log(`[SandboxService] Session ${sessionId} cleaned up`);
  }

  /**
   * Get the runtime type for a skill name.
   * Returns null if the skill runs on host (not in sandbox).
   */
  getRuntimeForSkill(skillName: string): RuntimeType | null {
    return (this.skillRuntimes[skillName] as RuntimeType) ?? null;
  }

  /**
   * Get all loaded runtime configurations
   */
  getRuntimeConfigs(): Map<RuntimeType, RuntimeConfig> {
    return this.runtimeConfigs;
  }

  // ─── Runtime Config Loading ──────────────────────────────────────────────

  private loadRuntimeConfigs(): void {
    if (!existsSync(this.sandboxDir)) {
      console.warn(`[SandboxService] Sandbox runtimes directory not found: ${this.sandboxDir}`);
      return;
    }

    const entries = readdirSync(this.sandboxDir);
    for (const entry of entries) {
      const entryPath = resolve(this.sandboxDir, entry);
      const configPath = resolve(entryPath, 'config.json');

      if (statSync(entryPath).isDirectory() && existsSync(configPath)) {
        const config: RuntimeConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
        this.runtimeConfigs.set(config.name as RuntimeType, config);
        this.pools.set(config.name as RuntimeType, []);
      }
    }
  }

  private loadSkillRuntimes(): void {
    if (!existsSync(this.skillRuntimesPath)) {
      console.warn(`[SandboxService] skill-runtimes.json not found: ${this.skillRuntimesPath}`);
      return;
    }

    this.skillRuntimes = JSON.parse(readFileSync(this.skillRuntimesPath, 'utf-8'));
  }

  // ─── Container Pool Management ──────────────────────────────────────────

  private async warmUpPools(): Promise<void> {
    const warmUpPromises: Promise<void>[] = [];

    for (const [runtimeType, config] of this.runtimeConfigs) {
      for (let i = 0; i < config.pool.min; i++) {
        warmUpPromises.push(
          this.spawnContainer(runtimeType).then((container) => {
            this.pools.get(runtimeType)!.push(container);
          }),
        );
      }
    }

    await Promise.allSettled(warmUpPromises);
  }

  private async acquireContainer(runtimeType: RuntimeType): Promise<Container> {
    const config = this.runtimeConfigs.get(runtimeType)!;
    const pool = this.pools.get(runtimeType)!;

    if (config.parallelExecutions) {
      // Any container can accept more sessions
      const container = pool[0];
      if (container) {
        container.activeSessions++;
        return container;
      }
    } else {
      // Exclusive: find a container with no active sessions
      const idle = pool.find((c) => c.activeSessions === 0);
      if (idle) {
        idle.activeSessions++;
        return idle;
      }
    }

    // Can we spawn a new one?
    if (pool.length < config.pool.max) {
      const container = await this.spawnContainer(runtimeType);
      container.activeSessions = 1;
      pool.push(container);
      return container;
    }

    // Pool full - queue
    return new Promise<Container>((resolve, reject) => {
      this.containerQueue.push({ runtimeType, resolve, reject });
      const position = this.containerQueue.filter((t) => t.runtimeType === runtimeType).length;
      console.log(`[SandboxService] Waiting for available ${runtimeType} container (position ${position} in queue)`);
    });
  }

  private releaseContainer(container: Container, runtimeType: RuntimeType): void {
    container.activeSessions--;

    // Check if there's a queued container request for this runtime type
    const queuedIndex = this.containerQueue.findIndex((t) => t.runtimeType === runtimeType);
    if (queuedIndex !== -1) {
      const queued = this.containerQueue.splice(queuedIndex, 1)[0];
      container.activeSessions++;
      queued.resolve(container);
    }
  }

  // ─── Execution Semaphore ────────────────────────────────────────────────

  private async acquireExecutionSlot(runtimeType: RuntimeType, config: RuntimeConfig): Promise<void> {
    const maxSlots = config.parallelExecutions ? config.maxParallelExecutions : 1;
    const active = this.activeExecutions.get(runtimeType)!;

    if (active < maxSlots) {
      this.activeExecutions.set(runtimeType, active + 1);
      return;
    }

    // At limit - queue
    return new Promise<void>((resolve, reject) => {
      this.executionQueue.push({ runtimeType, resolve, reject });
      console.log(`[SandboxService] Execution queued for ${runtimeType} (${active}/${maxSlots} slots in use)`);
    });
  }

  private releaseExecutionSlot(runtimeType: RuntimeType): void {
    const active = this.activeExecutions.get(runtimeType)!;

    // Check if there's a queued execution for this runtime type
    const queuedIndex = this.executionQueue.findIndex((e) => e.runtimeType === runtimeType);
    if (queuedIndex !== -1) {
      // Hand slot directly to next in queue (count stays the same)
      const queued = this.executionQueue.splice(queuedIndex, 1)[0];
      queued.resolve();
    } else {
      this.activeExecutions.set(runtimeType, active - 1);
    }
  }

  // ─── Container Operations ───────────────────────────────────────────────

  private async spawnContainer(runtimeType: RuntimeType): Promise<Container> {
    const config = this.runtimeConfigs.get(runtimeType)!;

    const args = [
      'run',
      '-d',
      '--name',
      `${runtimeType}-runtime-${randomUUID().slice(0, 8)}`,
      `--network=${config.network}`,
      config.image,
      'sleep',
      'infinity',
    ];

    const { stdout } = await execFileAsync('podman', args);
    const id = stdout.trim();

    console.log(`[SandboxService] Spawned ${runtimeType} container: ${id.slice(0, 12)}`);
    return { id, runtimeType, activeSessions: 0 };
  }

  private async stopContainer(container: Container): Promise<void> {
    try {
      await execFileAsync('podman', ['rm', '-f', container.id]);
      console.log(`[SandboxService] Stopped container: ${container.id.slice(0, 12)}`);
    } catch (err) {
      console.error(`[SandboxService] Failed to stop container ${container.id.slice(0, 12)}:`, err);
    }
  }

  private async podmanExec(containerId: string, command: string[]): Promise<string> {
    const { stdout } = await execFileAsync('podman', ['exec', containerId, ...command]);
    return stdout;
  }

  private async copyToContainer(containerId: string, hostPath: string, containerPath: string): Promise<void> {
    await execFileAsync('podman', ['cp', hostPath, `${containerId}:${containerPath}`]);
  }

  // ─── Input File Conflict Resolution ─────────────────────────────────────

  /**
   * Copy a host file into the session, renaming any existing file with the same name
   * using the pattern: filename.old.1.ext, filename.old.2.ext, etc.
   */
  private async copyInputWithRename(containerId: string, hostPath: string, sessionPath: string): Promise<void> {
    const fileName = basename(hostPath);
    const containerFilePath = `${sessionPath}/${fileName}`;

    // Check if file already exists in session
    const exists = await this.fileExistsInContainer(containerId, containerFilePath);

    if (exists) {
      const ext = extname(fileName);
      const nameWithoutExt = fileName.slice(0, fileName.length - ext.length);

      // Find the next available .old.N suffix
      let n = 1;
      while (true) {
        const oldName = `${nameWithoutExt}.old.${n}${ext}`;
        const oldPath = `${sessionPath}/${oldName}`;
        const oldExists = await this.fileExistsInContainer(containerId, oldPath);
        if (!oldExists) {
          // Rename existing file to .old.N
          await this.podmanExec(containerId, ['mv', containerFilePath, oldPath]);
          break;
        }
        n++;
      }
    }

    await this.copyToContainer(containerId, hostPath, `${sessionPath}/`);
  }

  private async fileExistsInContainer(containerId: string, filePath: string): Promise<boolean> {
    try {
      await execFileAsync('podman', ['exec', containerId, 'test', '-e', filePath]);
      return true;
    } catch {
      return false;
    }
  }

  // ─── Utilities ──────────────────────────────────────────────────────────

  private async checkPodman(): Promise<void> {
    try {
      await execFileAsync('podman', ['--version']);
    } catch {
      throw new Error('Podman is not installed. Install: https://podman.io/getting-started/installation');
    }
  }
}
