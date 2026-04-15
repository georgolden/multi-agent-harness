import type { App } from '../../app.js';
import type { Session } from '../../services/sessionService/index.js';
import type { RuntimeUser } from '../../services/userService/index.js';
import type { FileInfo, FolderInfo } from '../../services/sessionService/types.js';
import type { SubmitResult } from './tools.js';
import type { LLMToolCall } from '../../utils/message.js';
import { Type, type Static } from '@sinclair/typebox';

export type { Session };

export const exploreInputSchema = Type.Object({
  message: Type.String({ description: "User's message" }),
});

export type ExploreInput = Static<typeof exploreInputSchema>;

export interface ExploreResult {
  args: SubmitResult;
  contextFiles: FileInfo[];
  contextFoldersInfos: FolderInfo[];
}

export interface ExploreContext {
  session: Session;
  parent?: Session;
  user: RuntimeUser;
}
export interface ToolResult {
  output: string;
  toolCallId: string;
  name: string;
  args: Record<string, unknown>;
}
