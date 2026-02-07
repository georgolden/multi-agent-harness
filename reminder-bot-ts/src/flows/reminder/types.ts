import type { ChatCompletionMessageFunctionToolCall } from '../../types.js';

export interface ReminderContext {
  // Initial input
  userId: string;
  chatId: string;
  message: string;

  // Flow state
  response?: string;
  toolCalls?: ChatCompletionMessageFunctionToolCall[];
}
