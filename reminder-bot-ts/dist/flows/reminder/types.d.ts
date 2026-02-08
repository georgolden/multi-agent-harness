import type { ChatCompletionMessageFunctionToolCall } from '../../types.js';
export interface ReminderContext {
    userId: string;
    chatId: string;
    message: string;
    response?: string;
    toolCalls?: ChatCompletionMessageFunctionToolCall[];
}
export type AskUserContext = ReminderContext & {
    response: string;
};
export type ToolCallsContext = ReminderContext & {
    toolCalls: ChatCompletionMessageFunctionToolCall[];
};
