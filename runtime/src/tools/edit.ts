import type { AgentTool } from '../types.js';
import { type Static, Type } from '@sinclair/typebox';
import { constants } from 'fs';
import { access as fsAccess, readFile as fsReadFile, writeFile as fsWriteFile } from 'fs/promises';
import {
  detectLineEnding,
  generateDiffString,
  normalizeToLF,
  replace,
  restoreLineEndings,
  stripBom,
} from './edit-diff.js';
import { ToolResultMessage } from '../utils/message.js';
import { resolveToCwd } from './path-utils.js';
import { App } from '../app.js';

const editSchema = Type.Object({
  filePath: Type.String({ description: 'The absolute path to the file to modify' }),
  oldString: Type.String({ description: 'The text to replace' }),
  newString: Type.String({ description: 'The text to replace it with (must be different from oldString)' }),
  replaceAll: Type.Optional(Type.Boolean({ description: 'Replace all occurrences of oldString (default false)' })),
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
  readFile: (p) => fsReadFile(p),
  writeFile: (p, content) => fsWriteFile(p, content, 'utf-8'),
  access: (p) => fsAccess(p, constants.R_OK | constants.W_OK),
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
      'Edit a file by replacing text. The oldString must match exactly (including whitespace) or closely match via fuzzy algorithms. Use this for precise, surgical edits. Provide the absolute path to the file.',
    parameters: editSchema,
    execute: async (
      _app: App,
      _context: any,
      { filePath, oldString, newString, replaceAll },
      { toolCallId, signal }: { toolCallId: string; signal?: AbortSignal },
    ) => {
      if (signal?.aborted) {
        return {
          data: new ToolResultMessage({ toolCallId, content: 'Error: Operation aborted' }),
          details: { diff: '' },
          error: new Error('Operation aborted'),
        };
      }

      if (oldString === newString) {
        return {
          data: new ToolResultMessage({ toolCallId, content: 'Error: No changes to apply: oldString and newString are identical.' }),
          details: { diff: '' },
          error: new Error('No changes to apply: oldString and newString are identical.'),
        };
      }

      const absolutePath = resolveToCwd(filePath, cwd);

      try {
        // Handle empty oldString → create new file
        if (oldString === '') {
          const { access: fsAccessCheck, writeFile: fsWrite } = await import('node:fs/promises');
          let existed = false;
          try {
            await fsAccessCheck(absolutePath);
            existed = true;
          } catch {
            // file does not exist
          }

          const source = existed ? stripBom(await fsReadFile(absolutePath, 'utf-8')) : { bom: '', text: '' };
          const next = stripBom(newString);
          const desiredBom = source.bom || next.bom;
          const contentNew = next.text;

          const diffResult = generateDiffString(source.text, contentNew);

          // Create parent dirs if needed
          const { dirname } = await import('node:path');
          const { mkdir } = await import('node:fs/promises');
          await mkdir(dirname(absolutePath), { recursive: true });
          await fsWriteFile(absolutePath, desiredBom + contentNew, 'utf-8');

          return {
            data: new ToolResultMessage({ toolCallId, content: `Successfully wrote file ${filePath}.` }),
            details: { diff: diffResult.diff, firstChangedLine: diffResult.firstChangedLine },
          };
        }

        // Check if file exists
        try {
          await ops.access(absolutePath);
        } catch {
          throw new Error(`File not found: ${filePath}`);
        }

        // Read the file
        const buffer = await ops.readFile(absolutePath);
        const rawContent = buffer.toString('utf-8');

        // Strip BOM before matching (LLM won't include invisible BOM in oldString)
        const { bom, text: content } = stripBom(rawContent);

        const originalEnding = detectLineEnding(content);
        const normalizedContent = normalizeToLF(content);
        const normalizedOldString = normalizeToLF(oldString);
        const normalizedNewString = normalizeToLF(newString);

        // Use opencode's multi-strategy replace function
        const newContent = replace(normalizedContent, normalizedOldString, normalizedNewString, replaceAll ?? false);

        const finalContent = bom + restoreLineEndings(newContent, originalEnding);
        await ops.writeFile(absolutePath, finalContent);

        const diffResult = generateDiffString(content, restoreLineEndings(newContent, originalEnding));
        return {
          data: new ToolResultMessage({ toolCallId, content: `Successfully replaced text in ${filePath}.` }),
          details: { diff: diffResult.diff, firstChangedLine: diffResult.firstChangedLine },
        };
      } catch (error: any) {
        const err = error instanceof Error ? error : new Error(String(error));
        return {
          data: new ToolResultMessage({ toolCallId, content: `Error: ${err.message}` }),
          details: { diff: '' },
          error: err,
        };
      }
    },
  };
}

/** Default edit tool using process.cwd() - for backwards compatibility */
export const editTool = createEditTool(process.cwd());
