import type { LLMToolCall } from '../../utils/message.js';
import type { Session } from '../../services/sessionService/index.js';
import { Type, type Static } from '@sinclair/typebox';

export const taskSchedulerInputSchema = Type.Object({
  userId: Type.String({ description: 'User ID' }),
  message: Type.String({ description: "User's message" }),
});

export type TaskSchedulerInput = Static<typeof taskSchedulerInputSchema>;

export interface TaskSchedulerContext extends TaskSchedulerInput {
  // Flow session
  session?: Session;
  // Flow state
  response?: string;
  toolCalls?: LLMToolCall[];
}

export type AskUserContext = TaskSchedulerContext & { response: string; session: Session };
export type ToolCallsContext = TaskSchedulerContext & {
  toolCalls: LLMToolCall[];
  session: Session;
};
