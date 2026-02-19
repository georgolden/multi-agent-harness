import { Node, ParallelBatchNode } from 'pocketflow';
import type { SharedStore, ChatCompletionMessage, ChatCompletionMessageFunctionToolCall } from '../../types.js';
import type { App } from '../../app.js';
import type { TimezoneContext, AskUserContext, ToolCallsContext } from './types.js';
type PrepareInputPrepResult = {
    userId: string;
    message: string;
};
export declare class PrepareInput extends Node<SharedStore<TimezoneContext>> {
    prep(shared: SharedStore<TimezoneContext>): Promise<PrepareInputPrepResult>;
    exec(_prepRes: PrepareInputPrepResult): Promise<"done">;
    post(_shared: SharedStore<TimezoneContext>, _prepRes: PrepareInputPrepResult, _execRes: 'done'): Promise<undefined>;
}
type DecideActionPrepResult = {
    conversation: any[];
};
type DecideActionExecResult = ChatCompletionMessage;
export declare class DecideAction extends Node<SharedStore<TimezoneContext>> {
    constructor();
    prep(shared: SharedStore<TimezoneContext>): Promise<DecideActionPrepResult>;
    exec({ conversation }: DecideActionPrepResult): Promise<DecideActionExecResult>;
    post(shared: SharedStore<TimezoneContext>, _prepRes: DecideActionPrepResult, execRes: DecideActionExecResult): Promise<"ask_user" | "tool_calls">;
    execFallback(_prepRes: DecideActionPrepResult, error: Error): Promise<DecideActionExecResult>;
}
type AskUserPrepResult = {
    app: App;
    output: string;
    chatId: string;
};
export declare class AskUser extends Node<SharedStore<AskUserContext>> {
    prep(shared: SharedStore<AskUserContext>): Promise<AskUserPrepResult>;
    exec({ app, output, chatId }: AskUserPrepResult): Promise<'sent'>;
    post(_shared: SharedStore<AskUserContext>, _prepRes: AskUserPrepResult, _execRes: 'sent'): Promise<undefined>;
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
    post(shared: SharedStore<ToolCallsContext>, _prepRes: ToolCallsPrepResult[], execRes: ToolCallsExecResult[]): Promise<undefined>;
}
export {};
