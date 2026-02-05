/**
 * PocketFlow nodes for the reminder bot.
 * Each node has a clear, single responsibility.
 */
import { Node, ParallelBatchNode } from 'pocketflow';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import type {
  SharedStore,
  Reminder,
  ChatCompletionMessage,
  ChatCompletionMessageParam,
  ChatCompletion,
  ChatCompletionMessageFunctionToolCall,
} from '../../types.js';

dayjs.extend(utc);
dayjs.extend(timezone);

import { callLlmWithTools } from '../../utils/callLlm.js';
import { createSystemPrompt } from './prompts.js';
import { TOOLS } from '../../tools.js';
import { ConversationMessage } from '../../data/messageHistory.js';
import { TelegramService } from '../../services/telegram.js';

/**
 * DecideAction: LLM decides what action to take
 */
export class DecideAction extends Node<SharedStore> {
  constructor() {
    super(3, 1); // maxRetries: 3, wait: 1s
  }

  async prep(shared: SharedStore) {
    const { userId, chatId, message } = shared.context;
    const { data } = shared.app;
    const userReminders = await data.storage.getReminders(userId);
    const timezone = await data.storage.getUserTimezone(userId);
    const newMessage = {
      role: 'user',
      content: message,
    };
    data.messageHistory.addMessage(userId, newMessage);
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
      `[DecideAction] Calling LLM with ${messages.length} messages (user_tz: ${timezone}, ${userReminders.length} reminders)`,
    );

    // Call LLM with tools
    const response = await callLlmWithTools(messages, TOOLS);

    return response[0].message;
  }

  async post(shared: SharedStore, _prepRes: unknown, execRes: any) {
    const toolCalls = execRes.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      const { content, refusal } = execRes;
      let output = '';
      if (content) output = `${output}${content}`;
      if (refusal) output = `${output}\n${refusal}`;
      if (!output) output = `AI is broken try again later`;
      shared.context.response = output;
      return 'ask_user';
    } else {
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
    const { telegram } = shared.app.services;
    const { output, chatId } = shared.context;
    return { telegram, output, chatId };
  }

  async exec({ telegram, output, chatId }: { telegram: TelegramService; output: string; chatId: string }) {
    await telegram.sendMessage(chatId, output);
    return 'sent';
  }

  async post(shared: SharedStore, _prepRes: unknown, execRes: string) {
    return undefined;
  }
}

export class ToolCalls extends ParallelBatchNode<SharedStore> {
  async prep(shared: SharedStore) {
    const { toolCalls } = shared.context;
    return toolCalls;
  }

  async exec(toolCall: ChatCompletionMessageFunctionToolCall) {
    const args = JSON.parse(toolCall.function.arguments);
    const { name } = toolCall.function;

  }

  async post(shared: SharedStore, prepRes: ChatCompletionMessageFunctionToolCall[], execRes) {
    return undefined;
  }
}
