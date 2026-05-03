import { randomBytes } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentTool, AgentToolResult, AgentToolUpdateCallback } from '../types.js';
import { type Static, Type } from '@sinclair/typebox';
import { spawn } from 'child_process';
import { getShellConfig, getShellEnv, killProcessTree } from '../utils/shell.js';
import { ToolResultMessage } from '../utils/message.js';
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from './truncate.js';
import { App } from '../app.js';

/**
 * Generate a unique temp file path for bash output
 */
function getTempFilePath(): string {
  const id = randomBytes(8).toString('hex');
  return join(tmpdir(), `pi-bash-${id}.log`);
}

const MAX_METADATA_LENGTH = 30_000;
const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

const bashSchema = Type.Object({
  command: Type.String({ description: 'The command to execute' }),
  timeout: Type.Optional(Type.Number({ description: 'Optional timeout in milliseconds' })),
  workdir: Type.Optional(
    Type.String({
      description: `The working directory to run the command in. Defaults to the current directory. Use this instead of 'cd' commands.`,
    }),
  ),
  description: Type.String({
    description:
      "Clear, concise description of what this command does in 5-10 words. Examples:\nInput: ls\nOutput: Lists files in current directory\n\nInput: git status\nOutput: Shows working tree status\n\nInput: npm install\nOutput: Installs package dependencies\n\nInput: mkdir foo\nOutput: Creates directory 'foo'",
  }),
});

export type BashToolInput = Static<typeof bashSchema>;

export interface BashToolDetails {
  exitCode: number | null;
  description: string;
  truncated: boolean;
  outputPath?: string;
}

type Chunk = {
  text: string;
  size: number;
};

function preview(text: string): string {
  if (text.length <= MAX_METADATA_LENGTH) return text;
  return '...\n\n' + text.slice(-MAX_METADATA_LENGTH);
}

function tail(text: string, maxLines: number, maxBytes: number): { text: string; cut: boolean } {
  const lines = text.split('\n');
  if (lines.length <= maxLines && Buffer.byteLength(text, 'utf-8') <= maxBytes) {
    return { text, cut: false };
  }

  const out: string[] = [];
  let bytes = 0;
  for (let i = lines.length - 1; i >= 0 && out.length < maxLines; i--) {
    const size = Buffer.byteLength(lines[i], 'utf-8') + (out.length > 0 ? 1 : 0);
    if (bytes + size > maxBytes) {
      if (out.length === 0) {
        const buf = Buffer.from(lines[i], 'utf-8');
        let start = buf.length - maxBytes;
        if (start < 0) start = 0;
        while (start < buf.length && (buf[start] & 0xc0) === 0x80) start++;
        out.unshift(buf.subarray(start).toString('utf-8'));
      }
      break;
    }
    out.unshift(lines[i]);
    bytes += size;
  }
  return { text: out.join('\n'), cut: true };
}

/**
 * Pluggable operations for the bash tool.
 * Override these to delegate command execution to remote systems (e.g., SSH).
 */
export interface BashOperations {
  /**
   * Execute a command and stream output.
   * @param command - The command to execute
   * @param cwd - Working directory
   * @param options - Execution options
   * @returns Promise resolving to exit code (null if killed)
   */
  exec: (
    command: string,
    cwd: string,
    options: {
      onData: (data: Buffer) => void;
      signal?: AbortSignal;
      timeout?: number;
      env?: NodeJS.ProcessEnv;
    },
  ) => Promise<{ exitCode: number | null }>;
}

/**
 * Default bash operations using local shell
 */
const defaultBashOperations: BashOperations = {
  exec: (command, cwd, { onData, signal, timeout, env }) => {
    return new Promise((resolve, reject) => {
      const { shell, args } = getShellConfig();

      if (!existsSync(cwd)) {
        reject(new Error(`Working directory does not exist: ${cwd}\nCannot execute bash commands.`));
        return;
      }

      const child = spawn(shell, [...args, command], {
        cwd,
        detached: true,
        env: env ?? getShellEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let timedOut = false;

      // Set timeout if provided (in milliseconds)
      let timeoutHandle: NodeJS.Timeout | undefined;
      if (timeout !== undefined && timeout > 0) {
        timeoutHandle = setTimeout(() => {
          timedOut = true;
          if (child.pid) {
            killProcessTree(child.pid);
          }
        }, timeout);
      }

      // Stream stdout and stderr
      if (child.stdout) {
        child.stdout.on('data', onData);
      }
      if (child.stderr) {
        child.stderr.on('data', onData);
      }

      // Handle shell spawn errors
      child.on('error', (err) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (signal) signal.removeEventListener('abort', onAbort);
        reject(err);
      });

      // Handle abort signal - kill entire process tree
      const onAbort = () => {
        if (child.pid) {
          killProcessTree(child.pid);
        }
      };

      if (signal) {
        if (signal.aborted) {
          onAbort();
        } else {
          signal.addEventListener('abort', onAbort, { once: true });
        }
      }

      // Handle process exit
      child.on('close', (code) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (signal) signal.removeEventListener('abort', onAbort);

        if (signal?.aborted) {
          reject(new Error('aborted'));
          return;
        }

        if (timedOut) {
          reject(new Error(`timeout:${timeout}`));
          return;
        }

        resolve({ exitCode: code });
      });
    });
  },
};

export interface BashSpawnContext {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export type BashSpawnHook = (context: BashSpawnContext) => BashSpawnContext;

function resolveSpawnContext(command: string, cwd: string, spawnHook?: BashSpawnHook): BashSpawnContext {
  const baseContext: BashSpawnContext = {
    command,
    cwd,
    env: { ...getShellEnv() },
  };

  return spawnHook ? spawnHook(baseContext) : baseContext;
}

export interface BashToolOptions {
  /** Custom operations for command execution. Default: local shell */
  operations?: BashOperations;
  /** Command prefix prepended to every command (e.g., "shopt -s expand_aliases" for alias support) */
  commandPrefix?: string;
  /** Hook to adjust command, cwd, or env before execution */
  spawnHook?: BashSpawnHook;
}

export function createBashTool(cwd: string, options?: BashToolOptions): AgentTool<typeof bashSchema, BashToolDetails> {
  const ops = options?.operations ?? defaultBashOperations;
  const commandPrefix = options?.commandPrefix;
  const spawnHook = options?.spawnHook;

  // Detect shell name for description
  const { shell } = getShellConfig();
  const shellName = shell.toLowerCase().includes('powershell')
    ? 'powershell'
    : shell.toLowerCase().includes('bash')
      ? 'bash'
      : 'sh';

  const chainingHint =
    shellName === 'powershell'
      ? "If the commands depend on each other and must run sequentially, avoid '&&' in this shell because Windows PowerShell 5.1 does not support it. Use PowerShell conditionals such as `cmd1; if ($?) { cmd2 }` when later commands must depend on earlier success."
      : "If the commands depend on each other and must run sequentially, use a single Bash call with '&&' to chain them together (e.g., `git add . && git commit -m \"message\" && git push`). For instance, if one operation must complete before another starts (like mkdir before cp, Write before Bash for git operations, or git add before git commit), run these operations sequentially instead.";

  return {
    name: 'bash',
    label: 'bash',
    description: `Execute a bash command in the current working directory. Returns stdout and stderr. Output is truncated to last ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). If truncated, full output is saved to a temp file. Optionally provide a timeout in milliseconds (default: ${DEFAULT_TIMEOUT_MS}ms). ${chainingHint}`,
    parameters: bashSchema,
    execute: async (
      _app: App,
      _context: unknown,
      { command, timeout, workdir, description },
      {
        toolCallId,
        signal,
        onUpdate,
      }: {
        toolCallId: string;
        signal?: AbortSignal;
        onUpdate?: AgentToolUpdateCallback<BashToolDetails>;
      },
    ) => {
      // Resolve working directory
      const targetCwd = workdir ? join(cwd, workdir) : cwd;

      // Apply command prefix if configured
      const resolvedCommand = commandPrefix ? `${commandPrefix}\n${command}` : command;
      const spawnContext = resolveSpawnContext(resolvedCommand, targetCwd, spawnHook);

      // Validate timeout
      const effectiveTimeout = timeout ?? DEFAULT_TIMEOUT_MS;
      if (effectiveTimeout < 0) {
        return {
          data: new ToolResultMessage({
            toolCallId,
            content: `Error: Invalid timeout value: ${effectiveTimeout}. Timeout must be a positive number.`,
          }),
          details: { exitCode: null, description: description || command, truncated: false },
          error: new Error(`Invalid timeout value: ${effectiveTimeout}. Timeout must be a positive number.`),
        };
      }

      return new Promise<AgentToolResult<BashToolDetails>>((resolve) => {
        const keep = DEFAULT_MAX_BYTES * 2;
        const list: Chunk[] = [];
        let used = 0;
        let file = '';
        let sink: ReturnType<typeof createWriteStream> | undefined;
        let cut = false;
        let last = '';

        const handleData = (data: Buffer) => {
          const chunk = data.toString('utf-8');
          const size = Buffer.byteLength(chunk, 'utf-8');
          list.push({ text: chunk, size });
          used += size;
          while (used > keep && list.length > 1) {
            const item = list.shift();
            if (!item) break;
            used -= item.size;
            cut = true;
          }

          last = preview(last + chunk);

          if (sink) {
            sink.write(chunk);
          } else {
            const fullText = list.map((item) => item.text).join('');
            if (Buffer.byteLength(fullText, 'utf-8') > DEFAULT_MAX_BYTES) {
              file = getTempFilePath();
              cut = true;
              sink = createWriteStream(file, { flags: 'a' });
              const full = list.map((item) => item.text).join('');
              sink.write(full);
            }
          }

          // Stream partial output to callback
          if (onUpdate) {
            const raw = list.map((item) => item.text).join('');
            const end = tail(raw, DEFAULT_MAX_LINES, DEFAULT_MAX_BYTES);
            onUpdate({
              data: new ToolResultMessage({ toolCallId, content: end.text || '' }),
              details: {
                exitCode: null,
                description: description || command,
                truncated: end.cut || cut,
                outputPath: file || undefined,
              },
            });
          }
        };

        ops
          .exec(spawnContext.command, spawnContext.cwd, {
            onData: handleData,
            signal,
            timeout: effectiveTimeout,
            env: spawnContext.env,
          })
          .then(({ exitCode }) => {
            // Close temp file stream
            if (sink) {
              sink.end();
            }

            const raw = list.map((item) => item.text).join('');
            const end = tail(raw, DEFAULT_MAX_LINES, DEFAULT_MAX_BYTES);
            if (end.cut) cut = true;
            if (!file && end.cut) {
              file = getTempFilePath();
              cut = true;
              const stream = createWriteStream(file);
              stream.write(raw);
              stream.end();
            }

            let output = end.text;
            if (!output) output = '(no output)';

            const meta: string[] = [];
            if (cut && file) {
              output = `...output truncated...\n\nFull output saved to: ${file}\n\n` + output;
            }

            if (exitCode !== 0 && exitCode !== null) {
              meta.push(`Command exited with code ${exitCode}`);
            }

            if (meta.length > 0) {
              output += '\n\n<bash_metadata>\n' + meta.join('\n') + '\n</bash_metadata>';
            }

            const details: BashToolDetails = {
              exitCode,
              description: description || command,
              truncated: cut,
              ...(file ? { outputPath: file } : {}),
            };

            if (exitCode !== 0 && exitCode !== null) {
              const error = new Error(output);
              resolve({
                data: new ToolResultMessage({ toolCallId, content: output }),
                details,
                error,
              });
            } else {
              resolve({
                data: new ToolResultMessage({ toolCallId, content: output }),
                details,
              });
            }
          })
          .catch((err: Error) => {
            // Close temp file stream
            if (sink) {
              sink.end();
            }

            const raw = list.map((item) => item.text).join('');
            let output = tail(raw, DEFAULT_MAX_LINES, DEFAULT_MAX_BYTES).text;
            const meta: string[] = [];

            if (err.message === 'aborted') {
              meta.push('User aborted the command');
              if (output) output += '\n\n';
              output += 'Command aborted';
            } else if (err.message.startsWith('timeout:')) {
              const timeoutMs = err.message.split(':')[1];
              meta.push(
                `bash tool terminated command after exceeding timeout ${timeoutMs} ms. If this command is expected to take longer and is not waiting for interactive input, retry with a larger timeout value in milliseconds.`,
              );
              if (output) output += '\n\n';
              output += `Command timed out after ${timeoutMs} milliseconds`;
            } else {
              if (output) output += '\n\n';
              output += err.message;
            }

            if (meta.length > 0) {
              output += '\n\n<bash_metadata>\n' + meta.join('\n') + '\n</bash_metadata>';
            }

            const error = new Error(output);

            resolve({
              data: new ToolResultMessage({ toolCallId, content: `Error: ${output}` }),
              details: {
                exitCode: null,
                description: description || command,
                truncated: cut,
                ...(file ? { outputPath: file } : {}),
              },
              error,
            });
          });
      });
    },
  };
}

/** Default bash tool using process.cwd() - for backwards compatibility */
export const bashTool = createBashTool(process.cwd());
