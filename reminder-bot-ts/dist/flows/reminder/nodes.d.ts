/**
 * PocketFlow nodes for the reminder bot.
 * Each node has a clear, single responsibility.
 */
import { Node, ParallelBatchNode } from 'pocketflow';
import type { SharedStore, ChatCompletionMessage, ChatCompletionMessageFunctionToolCall } from '../../types.js';
import type { ConversationMessage } from '../../data/messageHistory/index.js';
import type { App } from '../../app.js';
import type { ReminderContext, AskUserContext, ToolCallsContext } from './types.js';
type PrepareInputPrepResult = {
    userId: string;
    message: string;
};
type PrepareInputExecResult = 'done';
/**
 * PrepareInput: Add user's message to conversation history (runs once)
 */
export declare class PrepareInput extends Node<SharedStore<ReminderContext>> {
    prep(shared: SharedStore<ReminderContext>): Promise<PrepareInputPrepResult>;
    exec(_prepRes: PrepareInputPrepResult): Promise<PrepareInputExecResult>;
    post(_shared: SharedStore<ReminderContext>, _prepRes: PrepareInputPrepResult, execRes: PrepareInputExecResult): Promise<undefined>;
}
type DecideActionPrepResult = {
    timezone: string;
    currentDate: string;
    conversation: ConversationMessage[];
    userReminders: string;
};
type DecideActionExecResult = ChatCompletionMessage;
/**
 * DecideAction: LLM decides what action to take
 */
export declare class DecideAction extends Node<SharedStore<ReminderContext>> {
    constructor();
    prep(shared: SharedStore<ReminderContext>): Promise<DecideActionPrepResult>;
    exec(prepRes: DecideActionPrepResult): Promise<DecideActionExecResult>;
    post(shared: SharedStore<ReminderContext>, _prepRes: DecideActionPrepResult, execRes: DecideActionExecResult): Promise<"ask_user" | "tool_calls">;
    execFallback(_prepRes: DecideActionPrepResult, error: Error): Promise<DecideActionExecResult>;
}
type AskUserPrepResult = {
    app: App;
    output: string;
    chatId: string;
};
type AskUserExecResult = 'sent';
/**
 * AskUser: Request missing information from user
 */
export declare class AskUser extends Node<SharedStore<AskUserContext>> {
    prep(shared: SharedStore<AskUserContext>): Promise<AskUserPrepResult>;
    exec({ app, output, chatId }: AskUserPrepResult): Promise<AskUserExecResult>;
    post(shared: SharedStore<ReminderContext>, _prepRes: AskUserPrepResult, execRes: AskUserExecResult): Promise<undefined>;
}
type ToolCallsPrepResult = {
    tc: ChatCompletionMessageFunctionToolCall;
    app: App;
    userId: string;
    chatId: string;
};
type ToolCallsExecResult = {
    role: 'tool';
    content: string;
    tool_call_id: string;
};
export declare class ToolCalls extends ParallelBatchNode<SharedStore<ToolCallsContext>> {
    prep(shared: SharedStore<ToolCallsContext>): Promise<ToolCallsPrepResult[]>;
    exec({ tc, app, userId, chatId }: ToolCallsPrepResult): Promise<ToolCallsExecResult>;
    post(shared: SharedStore<ReminderContext>, _prepRes: ToolCallsPrepResult[], execRes: ToolCallsExecResult[]): Promise<undefined>;
}
export {};
