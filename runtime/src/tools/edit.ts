import type { AgentTool } from '../types.js';
import { type Static, Type } from '@sinclair/typebox';
import { constants } from 'fs';
import { access as fsAccess, readFile as fsReadFile, writeFile as fsWriteFile } from 'fs/promises';
import {
  detectLineEnding,
  fuzzyFindText,
  generateDiffString,
  normalizeForFuzzyMatch,
  normalizeToLF,
  restoreLineEndings,
  stripBom,
} from './edit-diff.js';
import { ToolResultMessage } from '../utils/message.js';
import { resolveToCwd } from './path-utils.js';
import { App } from '../app.js';

const editSchema = Type.Object({
  path: Type.String({ description: 'Path to the file to edit (relative or absolute)' }),
  oldText: Type.String({ description: 'Exact text to find and replace (must match exactly)' }),
  newText: Type.String({ description: 'New text to replace the old text with' }),
});

export type EditToolInput = Static<typeof editSchema>;

export interface EditToolDetails {
  /** Unified diff of the changes made */
  diff: string;
  /** Line number of the first change in the new file (for editor navigation) */
  firstChangedLine?: number;
}

/**
 * Pluggable operations for the edit tool.
 * Override these to delegate file editing to remote systems (e.g., SSH).
 */
export interface EditOperations {
  /** Read file contents as a Buffer */
  readFile: (absolutePath: string) => Promise<Buffer>;
  /** Write content to a file */
  writeFile: (absolutePath: string, content: string) => Promise<void>;
  /** Check if file is readable and writable (throw if not) */
  access: (absolutePath: string) => Promise<void>;
}

const defaultEditOperations: EditOperations = {
  readFile: (path) => fsReadFile(path),
  writeFile: (path, content) => fsWriteFile(path, content, 'utf-8'),
  access: (path) => fsAccess(path, constants.R_OK | constants.W_OK),
};

export interface EditToolOptions {
  /** Custom operations for file editing. Default: local filesystem */
  operations?: EditOperations;
}

export function createEditTool(cwd: string, options?: EditToolOptions): AgentTool<typeof editSchema> {
  const ops = options?.operations ?? defaultEditOperations;

  return {
    name: 'edit',
    label: 'edit',
    description:
      'Edit a file by replacing exact text. The oldText must match exactly (including whitespace). Use this for precise, surgical edits.',
    parameters: editSchema,
    execute: async (
      _app: App,
      _context: any,
      { path, oldText, newText },
      { toolCallId, signal }: { toolCallId: string; signal?: AbortSignal },
    ) => {
      const absolutePath = resolveToCwd(path, cwd);

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

        // Perform the edit operation
        (async () => {
          try {
            // Check if file exists
            try {
              await ops.access(absolutePath);
            } catch {
              if (signal) {
                signal.removeEventListener('abort', onAbort);
              }
              const error = new Error(`File not found: ${path}`);
              resolve({
                data: new ToolResultMessage({ toolCallId, content: `Error: ${error.message}` }),
                details: undefined,
                error,
              });
              return;
            }

            // Check if aborted before reading
            if (aborted) {
              return;
            }

            // Read the file
            const buffer = await ops.readFile(absolutePath);
            const rawContent = buffer.toString('utf-8');

            // Check if aborted after reading
            if (aborted) {
              return;
            }

            // Strip BOM before matching (LLM won't include invisible BOM in oldText)
            const { bom, text: content } = stripBom(rawContent);

            const originalEnding = detectLineEnding(content);
            const normalizedContent = normalizeToLF(content);
            const normalizedOldText = normalizeToLF(oldText);
            const normalizedNewText = normalizeToLF(newText);

            // Find the old text using fuzzy matching (tries exact match first, then fuzzy)
            const matchResult = fuzzyFindText(normalizedContent, normalizedOldText);

            if (!matchResult.found) {
              if (signal) {
                signal.removeEventListener('abort', onAbort);
              }
              const error = new Error(
                `Could not find the exact text in ${path}. The old text must match exactly including all whitespace and newlines.`,
              );
              resolve({
                data: new ToolResultMessage({ toolCallId, content: `Error: ${error.message}` }),
                details: undefined,
                error,
              });
              return;
            }

            // Count occurrences using fuzzy-normalized content for consistency
            const fuzzyContent = normalizeForFuzzyMatch(normalizedContent);
            const fuzzyOldText = normalizeForFuzzyMatch(normalizedOldText);
            const occurrences = fuzzyContent.split(fuzzyOldText).length - 1;

            if (occurrences > 1) {
              if (signal) {
                signal.removeEventListener('abort', onAbort);
              }
              const error = new Error(
                `Found ${occurrences} occurrences of the text in ${path}. The text must be unique. Please provide more context to make it unique.`,
              );
              resolve({
                data: new ToolResultMessage({ toolCallId, content: `Error: ${error.message}` }),
                details: undefined,
                error,
              });
              return;
            }

            // Check if aborted before writing
            if (aborted) {
              return;
            }

            // Perform replacement using the matched text position
            // When fuzzy matching was used, contentForReplacement is the normalized version
            const baseContent = matchResult.contentForReplacement;
            const newContent =
              baseContent.substring(0, matchResult.index) +
              normalizedNewText +
              baseContent.substring(matchResult.index + matchResult.matchLength);

            // Verify the replacement actually changed something
            if (baseContent === newContent) {
              if (signal) {
                signal.removeEventListener('abort', onAbort);
              }
              const error = new Error(
                `No changes made to ${path}. The replacement produced identical content. This might indicate an issue with special characters or the text not existing as expected.`,
              );
              resolve({
                data: new ToolResultMessage({ toolCallId, content: `Error: ${error.message}` }),
                details: undefined,
                error,
              });
              return;
            }

            const finalContent = bom + restoreLineEndings(newContent, originalEnding);
            await ops.writeFile(absolutePath, finalContent);

            // Check if aborted after writing
            if (aborted) {
              return;
            }

            // Clean up abort handler
            if (signal) {
              signal.removeEventListener('abort', onAbort);
            }

            const diffResult = generateDiffString(baseContent, newContent);
            resolve({
              data: new ToolResultMessage({ toolCallId, content: `Successfully replaced text in ${path}.` }),
              details: { diff: diffResult.diff, firstChangedLine: diffResult.firstChangedLine },
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

/** Default edit tool using process.cwd() - for backwards compatibility */
export const editTool = createEditTool(process.cwd());
