import type { LLMToolCall } from '../../utils/message.js';
import type { Session } from '../../services/sessionService/index.js';
import { Type, type Static } from '@sinclair/typebox';
import { User } from '../../data/userRepository/types.js';

export const taskSchedulerInputSchema = Type.Object({
  message: Type.String({ description: 'Input message to schedule' }),
});

export type TaskSchedulerInput = Static<typeof taskSchedulerInputSchema>;

export interface TaskSchedulerContext {
  user: User;
  parent?: Session;
  // Flow session
  session?: Session;
  // Flow state
  response?: string;
  toolCalls?: LLMToolCall[];
}
