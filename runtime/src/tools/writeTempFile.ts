import type { AgentTool } from '../types.js';
import { Type, type Static } from '@sinclair/typebox';
import { ToolResultMessage } from '../utils/message.js';
import { App } from '../app.js';
import { ToolCallContext } from './index.js';

export const writeTempFileSchema = Type.Object({
  name: Type.String({ description: 'File name (e.g. "report.md", "data.json")' }),
  content: Type.String({ description: 'Full file content to write' }),
});

export type WriteTempFileInput = Static<typeof writeTempFileSchema>;

export interface WriteTempFileDetails {
  name: string;
  contentLength: number;
}

export function createWriteTempFileTool(): AgentTool<
  typeof writeTempFileSchema,
  WriteTempFileDetails | undefined,
  ToolCallContext
> {
  return {
    name: 'writeTempFile',
    label: 'writeTempFile',
    description: `Write a temporary file to the current session.
Provide the complete file content — existing files with the same name are replaced.
Temp files are scoped to the session and can be referenced by other agents or tools.
Returns the file name and byte size of the written content.`,
    parameters: writeTempFileSchema,
    execute: async (
      app: App,
      { session }: ToolCallContext,
      { name, content }: WriteTempFileInput,
      { toolCallId, signal }: { toolCallId: string; signal?: AbortSignal },
    ) => {
      try {
        if (signal?.aborted) {
          const error = new Error('Operation aborted');
          return {
            data: new ToolResultMessage({ toolCallId, content: `Error: ${error.message}` }),
            details: undefined,
            error,
          };
        }

        await session.writeTempFile({ name, content });

        const details: WriteTempFileDetails = { name, contentLength: content.length };

        return {
          data: new ToolResultMessage({
            toolCallId,
            content: JSON.stringify({ success: true, name, contentLength: content.length }),
          }),
          details,
        };
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        const errorMsg = `writeTempFile failed: ${err.message}`;
        return {
          data: new ToolResultMessage({ toolCallId, content: `Error: ${errorMsg}` }),
          details: undefined,
          error: new Error(errorMsg),
        };
      }
    },
  };
}

/** Default writeTempFile tool */
export const writeTempFileTool = createWriteTempFileTool();
