/**
 * PocketFlow nodes for the reminder bot.
 * Each node has a clear, single responsibility.
 */
import { Node, ParallelBatchNode } from 'pocketflow';
import { callLlmWithTools } from '../../utils/callLlm.js';
import { createSystemPrompt } from './prompts/index.js';
import { createToolHandler, TOOLS } from './tools.js';
/**
 * PrepareInput: Add user's message to conversation history (runs once)
 */
export class PrepareInput extends Node {
    async prep(shared) {
        const { userId, message } = shared.context;
        console.log(`[PrepareInput.prep] Adding user message to history: "${message}"`);
        const newMessage = {
            role: 'user',
            content: message,
        };
        shared.app.data.messageHistory.addMessage(userId, newMessage);
        return { userId, message };
    }
    async exec(_prepRes) {
        return 'done';
    }
    async post(_shared, _prepRes, execRes) {
        return undefined;
    }
}
/**
 * DecideAction: LLM decides what action to take
 */
export class DecideAction extends Node {
    constructor() {
        super(3, 1); // maxRetries: 3, wait: 1s
    }
    async prep(shared) {
        const { userId } = shared.context;
        const { data } = shared.app;
        const userReminders = await data.reminderRepository.getReminders(userId);
        const timezone = await data.reminderRepository.getUserTimezone(userId);
        console.log(`[DecideAction.prep] Found ${userReminders.length} reminders, timezone: ${timezone}`);
        const conversation = data.messageHistory.getConversation(userId);
        return {
            timezone: timezone,
            currentDate: new Date().toISOString(),
            conversation: conversation,
            userReminders: JSON.stringify(userReminders),
        };
    }
    async exec(prepRes) {
        const { timezone, currentDate, conversation, userReminders } = prepRes;
        const systemPrompt = createSystemPrompt(currentDate, timezone, userReminders);
        const messages = [{ role: 'system', content: systemPrompt }, ...conversation];
        console.log(`[DecideAction.exec] Calling LLM with ${messages.length} messages (user_tz: ${timezone}, ${userReminders.length} reminders)`);
        console.log(conversation);
        // Call LLM with tools
        const response = await callLlmWithTools(messages, TOOLS);
        console.log(`[DecideAction.exec] LLM response:`, JSON.stringify(response[0].message, null, 2));
        return response[0].message;
    }
    async post(shared, _prepRes, execRes) {
        shared.app.data.messageHistory.addMessage(shared.context.userId, execRes);
        const toolCalls = execRes.tool_calls;
        if (!toolCalls || toolCalls.length === 0) {
            const { content, refusal } = execRes;
            let output = '';
            if (content?.trim())
                output = content.trim();
            if (refusal?.trim())
                output = `${output}\n${refusal.trim()}`.trim();
            if (!output)
                output = execRes.reasoning?.trim() || `AI is broken try again later`;
            console.log(`[DecideAction.post] Setting response to: "${output}"`);
            shared.context.response = output;
            return 'ask_user';
        }
        else {
            console.log(`[DecideAction.post] Processing ${toolCalls.length} tool calls`);
            shared.context.toolCalls = toolCalls;
            return 'tool_calls';
        }
    }
    async execFallback(_prepRes, error) {
        console.error('[DecideAction.error] ', error);
        return { role: 'assistant', content: 'AI is broken try again later', refusal: null };
    }
}
/**
 * AskUser: Request missing information from user
 */
export class AskUser extends Node {
    async prep(shared) {
        const { app } = shared;
        const { response, chatId } = shared.context;
        console.log(`[AskUser.prep] chatId: ${chatId}, response: "${response}"`);
        return { app, output: response, chatId };
    }
    async exec({ app, output, chatId }) {
        console.log(`[AskUser.exec] Sending message to chatId: ${chatId}, output: "${output}"`);
        app.infra.bus.emit('telegram.sendMessage', { chatId, message: output });
        return 'sent';
    }
    async post(shared, _prepRes, execRes) {
        console.log(`[AskUser.post] execRes: ${execRes}`);
        return undefined;
    }
}
export class ToolCalls extends ParallelBatchNode {
    async prep(shared) {
        const { toolCalls, userId, chatId } = shared.context;
        console.log(`[ToolCalls.prep] Processing ${toolCalls.length} tool calls for userId: ${userId}, chatId: ${chatId}`);
        toolCalls.forEach((tc, idx) => {
            console.log(`[ToolCalls.prep] Tool ${idx}: ${tc.function.name}, args: ${tc.function.arguments}`);
        });
        return toolCalls.map((tc) => ({ tc, app: shared.app, userId, chatId }));
    }
    async exec({ tc, app, userId, chatId }) {
        const args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
        const { name } = tc.function;
        const handler = createToolHandler(name);
        const content = await handler(app, { userId, chatId }, args);
        console.log(`[ToolCalls.exec] Tool ${name} returned: "${content}"`);
        return { role: 'tool', content, tool_call_id: tc.id };
    }
    async post(shared, _prepRes, execRes) {
        console.log(`[ToolCalls.post] Adding ${execRes.length} tool result messages to history`);
        shared.app.data.messageHistory.addMessages(shared.context.userId, execRes);
        return undefined;
    }
}
