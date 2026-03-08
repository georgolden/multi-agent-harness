import type { AgentTool } from '../types.js';
import { type Static, Type } from '@sinclair/typebox';
import { mkdir as fsMkdir, writeFile as fsWriteFile } from 'fs/promises';
import { dirname } from 'path';
import { ToolResultMessage } from '../utils/message.js';
import { resolveToCwd } from './path-utils.js';
import { App } from '../app.js';

const writeSchema = Type.Object({
  path: Type.String({ description: 'Path to the file to write (relative or absolute)' }),
  content: Type.String({ description: 'Content to write to the file' }),
});

export type WriteToolInput = Static<typeof writeSchema>;

/**
 * Pluggable operations for the write tool.
 * Override these to delegate file writing to remote systems (e.g., SSH).
 */
export interface WriteOperations {
  /** Write content to a file */
  writeFile: (absolutePath: string, content: string) => Promise<void>;
  /** Create directory (recursively) */
  mkdir: (dir: string) => Promise<void>;
}

const defaultWriteOperations: WriteOperations = {
  writeFile: (path, content) => fsWriteFile(path, content, 'utf-8'),
  mkdir: (dir) => fsMkdir(dir, { recursive: true }).then(() => {}),
};

export interface WriteToolOptions {
  /** Custom operations for file writing. Default: local filesystem */
  operations?: WriteOperations;
}

export function createWriteTool(cwd: string, options?: WriteToolOptions): AgentTool<typeof writeSchema> {
  const ops = options?.operations ?? defaultWriteOperations;

  return {
    name: 'write',
    label: 'write',
    description:
      "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
    parameters: writeSchema,
    execute: async (
      _app: App,
      _context: any,
      { path, content },
      { toolCallId, signal }: { toolCallId: string; signal?: AbortSignal },
    ) => {
      const absolutePath = resolveToCwd(path, cwd);
      const dir = dirname(absolutePath);

      return new Promise<any>((resolve) => {
        // Check if already aborted
        if (signal?.aborted) {
          const error = new Error('Operation aborted');
          resolve({
            data: new ToolResultMessage({ toolCallId, content: `Error: ${error.message}` }),
            details: undefined,
            error,
          });
          return;
        }

        let aborted = false;

        // Set up abort handler
        const onAbort = () => {
          aborted = true;
        };

        if (signal) {
          signal.addEventListener('abort', onAbort, { once: true });
        }

        // Perform the write operation
        (async () => {
          try {
            // Create parent directories if needed
            await ops.mkdir(dir);

            // Check if aborted before writing
            if (aborted) {
              return;
            }

            // Write the file
            await ops.writeFile(absolutePath, content);

            // Check if aborted after writing
            if (aborted) {
              return;
            }

            // Clean up abort handler
            if (signal) {
              signal.removeEventListener('abort', onAbort);
            }

            resolve({
              data: new ToolResultMessage({ toolCallId, content: `Successfully wrote ${content.length} bytes to ${path}` }),
              details: undefined,
            });
          } catch (error: any) {
            // Clean up abort handler
            if (signal) {
              signal.removeEventListener('abort', onAbort);
            }

            if (!aborted) {
              const err = error instanceof Error ? error : new Error(String(error));
              resolve({
                data: new ToolResultMessage({ toolCallId, content: `Error: ${err.message}` }),
                details: undefined,
                error: err,
              });
            }
          }
        })();
      });
    },
  };
}

/** Default write tool using process.cwd() - for backwards compatibility */
export const writeTool = createWriteTool(process.cwd());
