import type { ChatCompletionMessageFunctionToolCall } from '../../types.js';

export interface TimezoneContext {
  userId: string;
  chatId: string;
  message: string;

  response?: string;
  toolCalls?: ChatCompletionMessageFunctionToolCall[];
}

export type AskUserContext = TimezoneContext & { response: string };
export type ToolCallsContext = TimezoneContext & { toolCalls: ChatCompletionMessageFunctionToolCall[] };
