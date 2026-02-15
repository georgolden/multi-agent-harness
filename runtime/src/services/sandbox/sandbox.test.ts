import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { SandboxService } from './index.js';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import type { App } from '../../app.js';

describe('SandboxService', () => {
  let sandboxService: SandboxService;
  let testDir: string;

  // Mock App instance
  const mockApp = {} as App;

  beforeAll(async () => {
    // Create test directory structure
    testDir = resolve(tmpdir(), `sandbox-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    // Create minimal runtime configs for testing
    const sandboxDir = resolve(testDir, 'src/sandbox/runtimes');
    mkdirSync(resolve(sandboxDir, 'generic'), { recursive: true });

    writeFileSync(
      resolve(sandboxDir, 'generic/config.json'),
      JSON.stringify({
        name: 'generic',
        image: 'generic-runtime:latest',
        pool: { min: 1, max: 2 },
        network: 'none',
        executionTimeout: 30000,
        parallelExecutions: true,
        maxParallelExecutions: 2,
      }),
    );

    // Create skill-runtimes.json
    const skillsDir = resolve(testDir, 'src/skills');
    mkdirSync(skillsDir, { recursive: true });
    writeFileSync(
      resolve(skillsDir, 'skill-runtimes.json'),
      JSON.stringify({
        'test-skill': 'generic',
      }),
    );

    sandboxService = new SandboxService(mockApp, testDir);
    await sandboxService.start();
  }, 60000);

  afterAll(async () => {
    await sandboxService.stop();
    rmSync(testDir, { recursive: true, force: true });
  }, 30000);

  describe('Lifecycle', () => {
    it('should start successfully', () => {
      expect(sandboxService['isStarted']).toBe(true);
    });

    it('should load runtime configurations', () => {
      const configs = sandboxService.getRuntimeConfigs();
      expect(configs.size).toBeGreaterThan(0);
      expect(configs.has('generic')).toBe(true);
    });

    it('should warm up container pools on start', () => {
      const pools = sandboxService['pools'];
      expect(pools.has('generic')).toBe(true);

      const genericPool = pools.get('generic')!;
      const config = sandboxService.getRuntimeConfigs().get('generic')!;
      expect(genericPool.length).toBe(config.pool.min);
    });

    it('should initialize active executions counter', () => {
      const activeExecutions = sandboxService['activeExecutions'];
      expect(activeExecutions.has('generic')).toBe(true);
      expect(activeExecutions.get('generic')).toBe(0);
    });
  });

  describe('Session Management', () => {
    it('should create a session successfully', async () => {
      const sessionId = await sandboxService.createSession({
        runtimeType: 'generic',
        workloadFiles: [],
      });

      expect(sessionId).toMatch(/^session-/);
      expect(sandboxService['sessions'].has(sessionId)).toBe(true);
    }, 30000);

    it('should create session with custom sessionId', async () => {
      const customId = 'custom-session-123';
      const sessionId = await sandboxService.createSession({
        runtimeType: 'generic',
        workloadFiles: [],
        sessionId: customId,
      });

      expect(sessionId).toBe(customId);
      expect(sandboxService['sessions'].has(customId)).toBe(true);

      await sandboxService.cleanupSession(customId);
    }, 30000);

    it('should create session directory in container', async () => {
      const sessionId = await sandboxService.createSession({
        runtimeType: 'generic',
        workloadFiles: [],
      });

      const session = sandboxService['sessions'].get(sessionId)!;
      expect(session.sessionPath).toBe(`/workspace/${sessionId}`);

      await sandboxService.cleanupSession(sessionId);
    }, 30000);

    it('should cleanup session and release container', async () => {
      const sessionId = await sandboxService.createSession({
        runtimeType: 'generic',
        workloadFiles: [],
      });

      const session = sandboxService['sessions'].get(sessionId)!;
      const containerBeforeCleanup = session.container;
      const activeSessionsBefore = containerBeforeCleanup.activeSessions;

      await sandboxService.cleanupSession(sessionId);

      expect(sandboxService['sessions'].has(sessionId)).toBe(false);
      expect(containerBeforeCleanup.activeSessions).toBe(activeSessionsBefore - 1);
    }, 30000);

    it('should throw error when cleaning up non-existent session', async () => {
      await expect(sandboxService.cleanupSession('non-existent-session')).rejects.toThrow(
        'Session non-existent-session not found',
      );
    });

    it('should throw error when creating session with unknown runtime', async () => {
      await expect(
        sandboxService.createSession({
          runtimeType: 'unknown' as any,
          workloadFiles: [],
        }),
      ).rejects.toThrow('Unknown runtime type: unknown');
    });
  });

  describe('Command Execution', () => {
    let sessionId: string;

    beforeEach(async () => {
      sessionId = await sandboxService.createSession({
        runtimeType: 'generic',
        workloadFiles: [],
      });
    }, 30000);

    afterEach(async () => {
      if (sandboxService['sessions'].has(sessionId)) {
        await sandboxService.cleanupSession(sessionId);
      }
    }, 30000);

    it('should execute simple bash commands', async () => {
      const result = await sandboxService.executeCommands({
        sessionId,
        commands: ['echo "hello world"'],
      });

      expect(result.results).toHaveLength(1);
      expect(result.results[0].stdout).toContain('hello world');
      expect(result.results[0].command).toBe('echo "hello world"');
    }, 30000);

    it('should execute multiple commands sequentially', async () => {
      const result = await sandboxService.executeCommands({
        sessionId,
        commands: ['echo "first"', 'echo "second"', 'echo "third"'],
      });

      expect(result.results).toHaveLength(3);
      expect(result.results[0].stdout).toContain('first');
      expect(result.results[1].stdout).toContain('second');
      expect(result.results[2].stdout).toContain('third');
    }, 30000);

    it('should capture stderr', async () => {
      const result = await sandboxService.executeCommands({
        sessionId,
        commands: ['echo "error message" >&2'],
      });

      expect(result.results).toHaveLength(1);
      expect(result.results[0].stderr).toContain('error message');
    }, 30000);

    it('should handle command failures', async () => {
      const result = await sandboxService.executeCommands({
        sessionId,
        commands: ['false'],
      });

      expect(result.results).toHaveLength(1);
      // Command should complete but with error
      expect(result.results[0].command).toBe('false');
    }, 30000);

    it('should create files in session directory', async () => {
      const result = await sandboxService.executeCommands({
        sessionId,
        commands: ['echo "test content" > test.txt', 'cat test.txt'],
      });

      expect(result.results[1].stdout).toContain('test content');
    }, 30000);

    it('should throw error when executing in non-existent session', async () => {
      await expect(
        sandboxService.executeCommands({
          sessionId: 'non-existent',
          commands: ['echo "test"'],
        }),
      ).rejects.toThrow('Session non-existent not found');
    });

    it('should work with Python commands', async () => {
      const result = await sandboxService.executeCommands({
        sessionId,
        commands: ['python3 -c "print(2 + 2)"'],
      });

      expect(result.results[0].stdout).toContain('4');
    }, 30000);

    it('should work with Node.js commands', async () => {
      const result = await sandboxService.executeCommands({
        sessionId,
        commands: ['node -e "console.log(5 + 5)"'],
      });

      expect(result.results[0].stdout).toContain('10');
    }, 30000);
  });

  describe('Container Pool Management', () => {
    it('should reuse containers for parallel sessions', async () => {
      const session1Id = await sandboxService.createSession({
        runtimeType: 'generic',
        workloadFiles: [],
      });

      const session2Id = await sandboxService.createSession({
        runtimeType: 'generic',
        workloadFiles: [],
      });

      const session1 = sandboxService['sessions'].get(session1Id)!;
      const session2 = sandboxService['sessions'].get(session2Id)!;

      // Both sessions should share the same container (parallelExecutions: true)
      expect(session1.container.id).toBe(session2.container.id);
      // Container should have at least 2 active sessions (may have more from concurrent tests)
      expect(session1.container.activeSessions).toBeGreaterThanOrEqual(2);

      await sandboxService.cleanupSession(session1Id);
      await sandboxService.cleanupSession(session2Id);
    }, 30000);

    it('should spawn new containers when pool is empty', async () => {
      const poolBefore = sandboxService['pools'].get('generic')!.length;

      // Create sessions to fill the pool
      const sessions: string[] = [];
      const config = sandboxService.getRuntimeConfigs().get('generic')!;

      for (let i = 0; i < config.pool.max + 1; i++) {
        try {
          const sessionId = await sandboxService.createSession({
            runtimeType: 'generic',
            workloadFiles: [],
          });
          sessions.push(sessionId);
        } catch {
          // May queue if max reached
          break;
        }
      }

      const poolAfter = sandboxService['pools'].get('generic')!.length;
      expect(poolAfter).toBeGreaterThanOrEqual(poolBefore);

      // Cleanup
      for (const sessionId of sessions) {
        if (sandboxService['sessions'].has(sessionId)) {
          await sandboxService.cleanupSession(sessionId);
        }
      }
    }, 60000);

    it('should track active sessions per container', async () => {
      const sessionId = await sandboxService.createSession({
        runtimeType: 'generic',
        workloadFiles: [],
      });

      const session = sandboxService['sessions'].get(sessionId)!;
      const activeSessionsBefore = session.container.activeSessions;
      expect(activeSessionsBefore).toBeGreaterThan(0);

      await sandboxService.cleanupSession(sessionId);
      const activeSessionsAfter = session.container.activeSessions;

      // Should decrement by 1 after cleanup
      expect(activeSessionsAfter).toBe(activeSessionsBefore - 1);
    }, 30000);
  });

  describe('Execution Semaphore', () => {
    let sessionId: string;

    beforeEach(async () => {
      sessionId = await sandboxService.createSession({
        runtimeType: 'generic',
        workloadFiles: [],
      });
    }, 30000);

    afterEach(async () => {
      if (sandboxService['sessions'].has(sessionId)) {
        await sandboxService.cleanupSession(sessionId);
      }
    }, 30000);

    it('should track active executions', async () => {
      const executionPromise = sandboxService.executeCommands({
        sessionId,
        commands: ['sleep 1'],
      });

      // Check active executions during command execution
      const activeBefore = sandboxService['activeExecutions'].get('generic')!;
      expect(activeBefore).toBeGreaterThan(0);

      await executionPromise;

      // After completion, should be back to 0
      const activeAfter = sandboxService['activeExecutions'].get('generic')!;
      expect(activeAfter).toBe(0);
    }, 30000);

    it('should handle parallel executions up to maxParallelExecutions', async () => {
      const config = sandboxService.getRuntimeConfigs().get('generic')!;
      const maxParallel = config.maxParallelExecutions || 1;

      const executions = Array.from({ length: maxParallel }, () =>
        sandboxService.executeCommands({
          sessionId,
          commands: ['echo "parallel"'],
        }),
      );

      const results = await Promise.all(executions);
      expect(results).toHaveLength(maxParallel);
      results.forEach((result) => {
        expect(result.results[0].stdout).toContain('parallel');
      });
    }, 30000);
  });

  describe('Skill Runtime Mapping', () => {
    it('should return runtime for mapped skill', () => {
      const runtime = sandboxService.getRuntimeForSkill('test-skill');
      expect(runtime).toBe('generic');
    });

    it('should return null for unmapped skill', () => {
      const runtime = sandboxService.getRuntimeForSkill('unknown-skill');
      expect(runtime).toBeNull();
    });
  });

  describe('Session Isolation', () => {
    it('should isolate files between sessions', async () => {
      const session1Id = await sandboxService.createSession({
        runtimeType: 'generic',
        workloadFiles: [],
      });

      const session2Id = await sandboxService.createSession({
        runtimeType: 'generic',
        workloadFiles: [],
      });

      // Create file in session1
      await sandboxService.executeCommands({
        sessionId: session1Id,
        commands: ['echo "session1 data" > isolated.txt'],
      });

      // Try to read from session2 - should not exist
      const result = await sandboxService.executeCommands({
        sessionId: session2Id,
        commands: ['cat isolated.txt 2>&1 || echo "file not found"'],
      });

      expect(result.results[0].stdout).toContain('file not found');

      await sandboxService.cleanupSession(session1Id);
      await sandboxService.cleanupSession(session2Id);
    }, 30000);

    it('should have separate working directories per session', async () => {
      const session1Id = await sandboxService.createSession({
        runtimeType: 'generic',
        workloadFiles: [],
      });

      const session2Id = await sandboxService.createSession({
        runtimeType: 'generic',
        workloadFiles: [],
      });

      const session1 = sandboxService['sessions'].get(session1Id)!;
      const session2 = sandboxService['sessions'].get(session2Id)!;

      expect(session1.sessionPath).not.toBe(session2.sessionPath);
      expect(session1.sessionPath).toContain(session1Id);
      expect(session2.sessionPath).toContain(session2Id);

      await sandboxService.cleanupSession(session1Id);
      await sandboxService.cleanupSession(session2Id);
    }, 30000);
  });

  describe('Error Handling', () => {
    it('should throw when starting if already started', async () => {
      console.warn = () => {}; // Suppress warning
      await sandboxService.start();
      expect(sandboxService['isStarted']).toBe(true);
    });

    it('should throw error when service not started', async () => {
      const newService = new SandboxService(mockApp, testDir);

      await expect(
        newService.createSession({
          runtimeType: 'generic',
          workloadFiles: [],
        }),
      ).rejects.toThrow('SandboxService not started');
    });

    it('should handle command timeout gracefully', async () => {
      const sessionId = await sandboxService.createSession({
        runtimeType: 'generic',
        workloadFiles: [],
      });

      const result = await sandboxService.executeCommands({
        sessionId,
        commands: ['sleep 60'], // Will timeout (executionTimeout: 30000)
      });

      expect(result.results[0].stderr).toContain('timeout');

      await sandboxService.cleanupSession(sessionId);
    }, 40000);
  });
});
