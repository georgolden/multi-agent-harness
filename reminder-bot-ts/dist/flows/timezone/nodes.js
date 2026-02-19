import { Node, ParallelBatchNode } from 'pocketflow';
import { callLlmWithTools } from '../../utils/callLlm.js';
import { TOOLS, createToolHandler } from './tools.js';
import path from 'path';
import { readFile } from 'fs/promises';
const systemPrompt = await readFile(path.join(process.cwd(), 'src/flows/timezone/prompts/SYSTEM_PROMPT.MD'), 'utf-8');
// Use a namespaced history key to keep timezone conversation isolated
const historyKey = (userId) => `tz_${userId}`;
export class PrepareInput extends Node {
    async prep(shared) {
        const { userId, message } = shared.context;
        const newMessage = { role: 'user', content: message };
        shared.app.data.messageHistory.addMessage(historyKey(userId), newMessage);
        return { userId, message };
    }
    async exec(_prepRes) {
        return 'done';
    }
    async post(_shared, _prepRes, _execRes) {
        return undefined;
    }
}
export class DecideAction extends Node {
    constructor() {
        super(3, 1);
    }
    async prep(shared) {
        const { userId } = shared.context;
        const conversation = shared.app.data.messageHistory.getConversation(historyKey(userId));
        return { conversation };
    }
    async exec({ conversation }) {
        const messages = [{ role: 'system', content: systemPrompt }, ...conversation];
        const response = await callLlmWithTools(messages, TOOLS);
        return response[0].message;
    }
    async post(shared, _prepRes, execRes) {
        const { userId } = shared.context;
        shared.app.data.messageHistory.addMessage(historyKey(userId), execRes);
        const toolCalls = execRes.tool_calls;
        if (!toolCalls || toolCalls.length === 0) {
            const { content, refusal } = execRes;
            let output = '';
            if (content)
                output = content;
            if (refusal)
                output = `${output}\n${refusal}`;
            if (!output)
                output = 'Something went wrong, please try again.';
            shared.context.response = output;
            return 'ask_user';
        }
        else {
            shared.context.toolCalls = toolCalls;
            return 'tool_calls';
        }
    }
    async execFallback(_prepRes, error) {
        console.error('[timezone/DecideAction.error]', error);
        return { role: 'assistant', content: 'Something went wrong, please try again.', refusal: null };
    }
}
export class AskUser extends Node {
    async prep(shared) {
        return { app: shared.app, output: shared.context.response, chatId: shared.context.chatId };
    }
    async exec({ app, output, chatId }) {
        app.infra.bus.emit('telegram.sendMessage', { chatId, message: output });
        return 'sent';
    }
    async post(_shared, _prepRes, _execRes) {
        return undefined;
    }
}
export class ToolCalls extends ParallelBatchNode {
    async prep(shared) {
        const { toolCalls, userId, chatId } = shared.context;
        return toolCalls.map((tc) => ({ tc, app: shared.app, userId, chatId }));
    }
    async exec({ tc, app, userId, chatId }) {
        const args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
        const handler = createToolHandler(tc.function.name);
        const content = await handler(app, { userId, chatId }, args);
        return { role: 'tool', content, tool_call_id: tc.id };
    }
    async post(shared, _prepRes, execRes) {
        shared.app.data.messageHistory.addMessages(historyKey(shared.context.userId), execRes);
        return undefined;
    }
}
