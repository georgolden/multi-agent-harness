import type { AgentTool } from '../types.js';
import { type Static, Type } from '@sinclair/typebox';
import { mkdir as fsMkdir, readFile as fsReadFile, writeFile as fsWriteFile } from 'fs/promises';
import { dirname } from 'path';
import { ToolResultMessage } from '../utils/message.js';
import { resolveToCwd } from './path-utils.js';
import { App } from '../app.js';

const writeSchema = Type.Object({
  filePath: Type.String({ description: 'The absolute path to the file to write (must be absolute, not relative)' }),
  content: Type.String({ description: 'The content to write to the file' }),
});

export type WriteToolInput = Static<typeof writeSchema>;

/** Strip UTF-8 BOM if present, return both the BOM (if any) and the text without it */
function splitBom(content: string): { bom: boolean; text: string } {
  return content.startsWith('\uFEFF') ? { bom: true, text: content.slice(1) } : { bom: false, text: content };
}

function joinBom(text: string, hasBom: boolean): string {
  return hasBom ? '\uFEFF' + text : text;
}

/**
 * Pluggable operations for the write tool.
 * Override these to delegate file writing to remote systems (e.g., SSH).
 */
export interface WriteOperations {
  /** Write content to a file */
  writeFile: (absolutePath: string, content: string) => Promise<void>;
  /** Create directory (recursively) */
  mkdir: (dir: string) => Promise<void>;
  /** Check if file exists */
  exists: (absolutePath: string) => Promise<boolean>;
  /** Read file contents as string */
  readFileString: (absolutePath: string) => Promise<string>;
}

const defaultWriteOperations: WriteOperations = {
  writeFile: (p, content) => fsWriteFile(p, content, 'utf-8'),
  mkdir: (dir) => fsMkdir(dir, { recursive: true }).then(() => {}),
  exists: async (p) => {
    const { access } = await import('node:fs/promises');
    try {
      await access(p);
      return true;
    } catch {
      return false;
    }
  },
  readFileString: (p) => fsReadFile(p, 'utf-8'),
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
      "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories. Provide the absolute path to the file.",
    parameters: writeSchema,
    execute: async (
      _app: App,
      _context: any,
      { filePath, content },
      { toolCallId, signal }: { toolCallId: string; signal?: AbortSignal },
    ) => {
      if (signal?.aborted) {
        return {
          data: new ToolResultMessage({ toolCallId, content: 'Error: Operation aborted' }),
          details: undefined,
          error: new Error('Operation aborted'),
        };
      }

      const absolutePath = resolveToCwd(filePath, cwd);
      const dir = dirname(absolutePath);

      try {
        // Create parent directories if needed
        await ops.mkdir(dir);

        const exists = await ops.exists(absolutePath);
        const source = exists ? splitBom(await ops.readFileString(absolutePath)) : { bom: false, text: '' };
        const next = splitBom(content);
        const desiredBom = source.bom || next.bom;
        const contentNew = next.text;

        // Write the file preserving BOM
        await ops.writeFile(absolutePath, joinBom(contentNew, desiredBom));

        return {
          data: new ToolResultMessage({
            toolCallId,
            content: `Wrote file successfully.`,
          }),
          details: { filepath: absolutePath, exists },
        };
      } catch (error: any) {
        const err = error instanceof Error ? error : new Error(String(error));
        return {
          data: new ToolResultMessage({ toolCallId, content: `Error: ${err.message}` }),
          details: undefined,
          error: err,
        };
      }
    },
  };
}

/** Default write tool using process.cwd() - for backwards compatibility */
export const writeTool = createWriteTool(process.cwd());
