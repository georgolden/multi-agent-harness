import type { ChatCompletionMessageFunctionToolCall } from '../../types.js';
import type { Session } from '../../services/sessionService/index.js';
import { Type, type Static } from '@sinclair/typebox';
import { User } from '../../data/userRepository/types.js';
import type { ContextFile, ContextFolderInfo } from '../../data/flowSessionRepository/types.js';
import type { SubmitResult } from './tools.js';

export const exploreInputSchema = Type.Object({
  message: Type.String({ description: "User's message" }),
});

export type ExploreInput = Static<typeof exploreInputSchema>;

export interface ExploreResult {
  args: SubmitResult;
  contextFiles: ContextFile[];
  contextFoldersInfos: ContextFolderInfo[];
}

export interface ExploreContext extends ExploreInput {
  parent?: Session;
  user: User;
  iterations: number;
  response?: string;
  result?: ExploreResult;
}

export type DecideActionContext = ExploreContext & { session: Session };

export type ToolCallsContext = DecideActionContext & {
  toolCalls: ChatCompletionMessageFunctionToolCall[];
  session: Session;
};
