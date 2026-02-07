/**
 * PocketFlow nodes for the reminder bot.
 * Each node has a clear, single responsibility.
 */
import { Node, ParallelBatchNode } from 'pocketflow';
import type {
  SharedStore,
  Reminder,
  ChatCompletionMessage,
  ChatCompletionMessageParam,
  ChatCompletion,
  ChatCompletionMessageFunctionToolCall,
} from '../../types.js';

import { callLlmWithTools } from '../../utils/callLlm.js';
import { createSystemPrompt } from './prompts.js';
import { createToolHandler, TOOLS } from './tools.js';
import { ConversationMessage } from '../../data/messageHistory.js';
import { App } from '../../app.js';

/**
 * PrepareInput: Add user's message to conversation history (runs once)
 */
export class PrepareInput extends Node<SharedStore> {
  async prep(shared: SharedStore) {
    const { userId, message } = shared.context;
    console.log(`[PrepareInput.prep] Adding user message to history: "${message}"`);

    const newMessage: ChatCompletionMessageParam = {
      role: 'user',
      content: message,
    };
    shared.app.data.messageHistory.addMessage(userId, newMessage);

    return { userId, message };
  }

  async exec(inputs: any) {
    return 'done';
  }

  async post(shared: SharedStore, _prepRes: unknown, execRes: string) {
    return undefined;
  }
}

/**
 * DecideAction: LLM decides what action to take
 */
export class DecideAction extends Node<SharedStore> {
  constructor() {
    super(3, 1); // maxRetries: 3, wait: 1s
  }

  async prep(shared: SharedStore) {
    const { userId } = shared.context;

    const { data } = shared.app;
    const userReminders = await data.storage.getReminders(userId);
    const timezone = await data.storage.getUserTimezone(userId);
    console.log(`[DecideAction.prep] Found ${userReminders.length} reminders, timezone: ${timezone}`);

    const conversation = data.messageHistory.getConversation(userId);
    return {
      timezone: timezone,
      currentDate: new Date().toISOString(),
      conversation: conversation,
      userReminders: JSON.stringify(userReminders),
    };
  }

  async exec(inputs: any) {
    const { timezone, currentDate, conversation, userReminders } = inputs;

    const systemPrompt = createSystemPrompt(currentDate, timezone, userReminders);

    const messages: ConversationMessage[] = [{ role: 'system', content: systemPrompt }, ...conversation];

    console.log(
      `[DecideAction.exec] Calling LLM with ${messages.length} messages (user_tz: ${timezone}, ${userReminders.length} reminders)`,
    );
    console.log(conversation);

    // Call LLM with tools
    const response = await callLlmWithTools(messages, TOOLS);

    console.log(`[DecideAction.exec] LLM response:`, JSON.stringify(response[0].message, null, 2));

    return response[0].message;
  }

  async post(shared: SharedStore, _prepRes: unknown, execRes: any) {
    shared.app.data.messageHistory.addMessage(shared.context.userId, execRes);
    const toolCalls = execRes.tool_calls;

    if (!toolCalls || toolCalls.length === 0) {
      const { content, refusal } = execRes;

      let output = '';
      if (content) output = `${output}${content}`;
      if (refusal) output = `${output}\n${refusal}`;
      if (!output) output = `AI is broken try again later`;

      console.log(`[DecideAction.post] Setting response to: "${output}"`);
      shared.context.response = output;
      return 'ask_user';
    } else {
      console.log(`[DecideAction.post] Processing ${toolCalls.length} tool calls`);
      shared.context.toolCalls = toolCalls;
      return 'tool_calls';
    }
  }
}

/**
 * AskUser: Request missing information from user
 */
export class AskUser extends Node<SharedStore> {
  async prep(shared: SharedStore) {
    const { app } = shared;
    const { response, chatId } = shared.context;
    console.log(`[AskUser.prep] chatId: ${chatId}, response: "${response}"`);

    if (!response) {
      console.error(`[AskUser.prep] ERROR: response is undefined!`);
    }

    return { app, output: response, chatId };
  }

  async exec({ app, output, chatId }: { app: App; output: string; chatId: string }) {
    console.log(`[AskUser.exec] Sending message to chatId: ${chatId}, output: "${output}"`);
    await app.services.telegram.sendMessage(chatId, output);
    return 'sent';
  }

  async post(shared: SharedStore, _prepRes: unknown, execRes: string) {
    console.log(`[AskUser.post] execRes: ${execRes}`);
    return undefined;
  }
}

export class ToolCalls extends ParallelBatchNode<SharedStore> {
  async prep(shared: SharedStore) {
    const { toolCalls, userId, chatId } = shared.context;
    console.log(`[ToolCalls.prep] Processing ${toolCalls.length} tool calls for userId: ${userId}, chatId: ${chatId}`);
    toolCalls.forEach((tc: ChatCompletionMessageFunctionToolCall, idx: number) => {
      console.log(`[ToolCalls.prep] Tool ${idx}: ${tc.function.name}, args: ${tc.function.arguments}`);
    });
    return toolCalls.map((tc: ChatCompletionMessageFunctionToolCall) => ({ tc, app: shared.app, userId, chatId }));
  }

  async exec({
    tc,
    app,
    userId,
    chatId,
  }: {
    tc: ChatCompletionMessageFunctionToolCall;
    app: App;
    userId: string;
    chatId: string;
  }) {
    const args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
    const { name } = tc.function;

    const handler = createToolHandler(name);
    const content = await handler(app, userId, chatId, args);

    console.log(`[ToolCalls.exec] Tool ${name} returned: "${content}"`);

    return { role: 'tool', content, id: tc.id, name };
  }

  async post(
    shared: SharedStore,
    _prepRes: ChatCompletionMessageFunctionToolCall[],
    execRes: ChatCompletionMessageParam[],
  ) {
    console.log(`[ToolCalls.post] Adding ${execRes.length} tool result messages to history`);
    shared.app.data.messageHistory.addMessages(shared.context.userId, execRes);
    return undefined;
  }
}
