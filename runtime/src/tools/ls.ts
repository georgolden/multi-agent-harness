import type { AgentTool } from '../types.js';
import { type Static, Type } from '@sinclair/typebox';
import { existsSync, readdirSync, statSync } from 'fs';
import nodePath from 'path';
import { ToolResultMessage } from '../utils/message.js';
import { resolveToCwd } from './path-utils.js';
import { DEFAULT_MAX_BYTES, formatSize, type TruncationResult, truncateHead } from './truncate.js';
import { App } from '../app.js';

const lsSchema = Type.Object({
  path: Type.Optional(Type.String({ description: 'Directory to list (default: current directory)' })),
  limit: Type.Optional(Type.Number({ description: 'Maximum number of entries to return (default: 500)' })),
});

export type LsToolInput = Static<typeof lsSchema>;

const DEFAULT_LIMIT = 500;

export interface LsToolDetails {
  truncation?: TruncationResult;
  entryLimitReached?: number;
}

/**
 * Pluggable operations for the ls tool.
 * Override these to delegate directory listing to remote systems (e.g., SSH).
 */
export interface LsOperations {
  /** Check if path exists */
  exists: (absolutePath: string) => Promise<boolean> | boolean;
  /** Get file/directory stats. Throws if not found. */
  stat: (absolutePath: string) => Promise<{ isDirectory: () => boolean }> | { isDirectory: () => boolean };
  /** Read directory entries */
  readdir: (absolutePath: string) => Promise<string[]> | string[];
}

const defaultLsOperations: LsOperations = {
  exists: existsSync,
  stat: statSync,
  readdir: readdirSync,
};

export interface LsToolOptions {
  /** Custom operations for directory listing. Default: local filesystem */
  operations?: LsOperations;
}

export function createLsTool(cwd: string, options?: LsToolOptions): AgentTool<typeof lsSchema> {
  const ops = options?.operations ?? defaultLsOperations;

  return {
    name: 'ls',
    label: 'ls',
    description: `List directory contents. Returns entries sorted alphabetically, with '/' suffix for directories. Includes dotfiles. Output is truncated to ${DEFAULT_LIMIT} entries or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first).`,
    parameters: lsSchema,
    execute: async (
      _app: App,
      _context: any,
      { path, limit },
      { toolCallId, signal }: { toolCallId: string; signal?: AbortSignal },
    ) => {
      return new Promise<any>((resolve) => {
        if (signal?.aborted) {
          const error = new Error('Operation aborted');
          resolve({
            data: new ToolResultMessage({ toolCallId, content: `Error: ${error.message}` }),
            details: undefined,
            error,
          });
          return;
        }

        const onAbort = () => {
          const error = new Error('Operation aborted');
          resolve({
            data: new ToolResultMessage({ toolCallId, content: `Error: ${error.message}` }),
            details: undefined,
            error,
          });
        };
        signal?.addEventListener('abort', onAbort, { once: true });

        (async () => {
          try {
            const dirPath = resolveToCwd(path || '.', cwd);
            const effectiveLimit = limit ?? DEFAULT_LIMIT;

            // Check if path exists
            if (!(await ops.exists(dirPath))) {
              const error = new Error(`Path not found: ${dirPath}`);
              resolve({
                data: new ToolResultMessage({ toolCallId, content: `Error: ${error.message}` }),
                details: undefined,
                error,
              });
              return;
            }

            // Check if path is a directory
            const stat = await ops.stat(dirPath);
            if (!stat.isDirectory()) {
              const error = new Error(`Not a directory: ${dirPath}`);
              resolve({
                data: new ToolResultMessage({ toolCallId, content: `Error: ${error.message}` }),
                details: undefined,
                error,
              });
              return;
            }

            // Read directory entries
            let entries: string[];
            try {
              entries = await ops.readdir(dirPath);
            } catch (e: any) {
              const error = new Error(`Cannot read directory: ${e.message}`);
              resolve({
                data: new ToolResultMessage({ toolCallId, content: `Error: ${error.message}` }),
                details: undefined,
                error,
              });
              return;
            }

            // Sort alphabetically (case-insensitive)
            entries.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

            // Format entries with directory indicators
            const results: string[] = [];
            let entryLimitReached = false;

            for (const entry of entries) {
              if (results.length >= effectiveLimit) {
                entryLimitReached = true;
                break;
              }

              const fullPath = nodePath.join(dirPath, entry);
              let suffix = '';

              try {
                const entryStat = await ops.stat(fullPath);
                if (entryStat.isDirectory()) {
                  suffix = '/';
                }
              } catch {
                // Skip entries we can't stat
                continue;
              }

              results.push(entry + suffix);
            }

            signal?.removeEventListener('abort', onAbort);

            if (results.length === 0) {
              resolve({
                data: new ToolResultMessage({ toolCallId, content: '(empty directory)' }),
                details: undefined,
              });
              return;
            }

            // Apply byte truncation (no line limit since we already have entry limit)
            const rawOutput = results.join('\n');
            const truncation = truncateHead(rawOutput, { maxLines: Number.MAX_SAFE_INTEGER });

            let output = truncation.content;
            const details: LsToolDetails = {};

            // Build notices
            const notices: string[] = [];

            if (entryLimitReached) {
              notices.push(`${effectiveLimit} entries limit reached. Use limit=${effectiveLimit * 2} for more`);
              details.entryLimitReached = effectiveLimit;
            }

            if (truncation.truncated) {
              notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
              details.truncation = truncation;
            }

            if (notices.length > 0) {
              output += `\n\n[${notices.join('. ')}]`;
            }

            resolve({
              data: new ToolResultMessage({ toolCallId, content: output }),
              details: Object.keys(details).length > 0 ? details : undefined,
            });
          } catch (e: any) {
            signal?.removeEventListener('abort', onAbort);
            const error = e instanceof Error ? e : new Error(String(e));
            resolve({
              data: new ToolResultMessage({ toolCallId, content: `Error: ${error.message}` }),
              details: undefined,
              error,
            });
          }
        })();
      });
    },
  };
}

/** Default ls tool using process.cwd() - for backwards compatibility */
export const lsTool = createLsTool(process.cwd());
