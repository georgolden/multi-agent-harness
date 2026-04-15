import type { LLMToolCall } from '../../utils/message.js';
import type { Session } from '../../services/sessionService/index.js';
import { Type, type Static } from '@sinclair/typebox';
import type { RuntimeUser } from '../../services/userService/index.js';

export const taskSchedulerInputSchema = Type.Object({
  message: Type.String({ description: 'Input message to schedule' }),
});

export type TaskSchedulerInput = Static<typeof taskSchedulerInputSchema>;

export interface TaskSchedulerContext {
  user: RuntimeUser;
  parent?: Session;
  // Flow session
  session: Session;
  // Flow state
}
