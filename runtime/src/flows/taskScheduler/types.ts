import type { ChatCompletionMessageFunctionToolCall } from '../../types.js';
import type { FlowSession } from '../../data/flowSessionRepository/types.js';
import { Type, type Static } from '@sinclair/typebox';

export const taskSchedulerInputSchema = Type.Object({
  userId: Type.String({ description: 'User ID' }),
  message: Type.String({ description: "User's message" }),
});

export type TaskSchedulerInput = Static<typeof taskSchedulerInputSchema>;

export interface TaskSchedulerContext extends TaskSchedulerInput {
  // Flow session
  session?: FlowSession;
  // Flow state
  response?: string;
  toolCalls?: ChatCompletionMessageFunctionToolCall[];
}

export type AskUserContext = TaskSchedulerContext & { response: string };
export type ToolCallsContext = TaskSchedulerContext & { toolCalls: ChatCompletionMessageFunctionToolCall[] };
