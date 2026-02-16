/**
 * PocketFlow nodes for the reminder bot.
 * Each node has a clear, single responsibility.
 */
import { Node, ParallelBatchNode } from 'pocketflow';
import type {
  SharedStore,
  ChatCompletionMessage,
  ChatCompletionMessageParam,
  ChatCompletionMessageFunctionToolCall,
} from '../../types.js';

import { callLlmWithTools } from '../../utils/callLlm.js';
import { createSystemPrompt } from './prompts/index.js';
import { createToolHandler, TOOLS } from './tools.js';
import type { ConversationMessage } from '../../data/messageHistory/index.js';
import type { App } from '../../app.js';
import type { TaskSchedulerContext, AskUserContext, ToolCallsContext } from './types.js';

// PrepareInput Types
type PrepareInputPrepResult = { userId: string; message: string };
type PrepareInputExecResult = 'done';

/**
 * PrepareInput: Add user's message to conversation history (runs once)
 */
export class PrepareInput extends Node<SharedStore<TaskSchedulerContext>> {
  async prep(shared: SharedStore<TaskSchedulerContext>): Promise<PrepareInputPrepResult> {
    const { userId, message } = shared.context;
    console.log(`[PrepareInput.prep] Adding user message to history: "${message}"`);

    const newMessage: ChatCompletionMessageParam = {
      role: 'user',
      content: message,
    };
    shared.app.data.messageHistory.addMessage(userId, newMessage);

    return { userId, message };
  }

  async exec(_prepRes: PrepareInputPrepResult): Promise<PrepareInputExecResult> {
    return 'done';
  }

  async post(_shared: SharedStore<TaskSchedulerContext>, _prepRes: PrepareInputPrepResult, execRes: PrepareInputExecResult) {
    return undefined;
  }
}

// DecideAction Types
type DecideActionPrepResult = {
  timezone: string;
  currentDate: string;
  conversation: ConversationMessage[];
  userTaskSchedulers: string;
  tasksTypes: string;
};
type DecideActionExecResult = ChatCompletionMessage;

/**
 * DecideAction: LLM decides what action to take
 */
export class DecideAction extends Node<SharedStore<TaskSchedulerContext>> {
  constructor() {
    super(3, 1); // maxRetries: 3, wait: 1s
  }

  async prep(shared: SharedStore<TaskSchedulerContext>): Promise<DecideActionPrepResult> {
    const { userId } = shared.context;

    const { data } = shared.app;
    const userTaskSchedulers = await data.taskRepository.getTasks(userId);
    const timezone = await data.taskRepository.getUserTimezone(userId);
    console.log(`[DecideAction.prep] Found ${userTaskSchedulers.length} reminders, timezone: ${timezone}`);

    const conversation = data.messageHistory.getConversation(userId);
    const tasksTypes = shared.app.tasks.getTasksSchema();
    return {
      timezone: timezone,
      currentDate: new Date().toISOString(),
      conversation: conversation,
      userTaskSchedulers: JSON.stringify(userTaskSchedulers),
      tasksTypes,
    };
  }

  async exec(prepRes: DecideActionPrepResult): Promise<DecideActionExecResult> {
    const { timezone, currentDate, conversation, userTaskSchedulers, tasksTypes } = prepRes;

    const systemPrompt = createSystemPrompt(currentDate, timezone, userTaskSchedulers, tasksTypes);

    const messages: ConversationMessage[] = [{ role: 'system', content: systemPrompt }, ...conversation];

    console.log(
      `[DecideAction.exec] Calling LLM with ${messages.length} messages (user_tz: ${timezone}, ${userTaskSchedulers.length} reminders)`,
    );
    console.log(conversation);

    // Call LLM with tools
    const response = await callLlmWithTools(messages, TOOLS);

    console.log(`[DecideAction.exec] LLM response:`, JSON.stringify(response[0].message, null, 2));

    return response[0].message;
  }

  async post(shared: SharedStore<TaskSchedulerContext>, _prepRes: DecideActionPrepResult, execRes: DecideActionExecResult) {
    shared.app.data.messageHistory.addMessage(shared.context.userId, execRes);
    const toolCalls = execRes.tool_calls as ChatCompletionMessageFunctionToolCall[];

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

  async execFallback(_prepRes: DecideActionPrepResult, error: Error): Promise<DecideActionExecResult> {
    console.error('[DecideAction.error] ', error);
    return { role: 'assistant', content: 'AI is broken try again later', refusal: null };
  }
}

// AskUser Types
type AskUserPrepResult = { app: App; output: string; userId: string };
type AskUserExecResult = 'sent';

/**
 * AskUser: Request missing information from user
 */
export class AskUser extends Node<SharedStore<AskUserContext>> {
  async prep(shared: SharedStore<AskUserContext>): Promise<AskUserPrepResult> {
    const { app } = shared;
    const { response, userId } = shared.context;

    return { app, output: response, userId };
  }

  async exec({ app, output, userId }: AskUserPrepResult): Promise<AskUserExecResult> {
    console.log(`[AskUser.exec] Sending message to userId: ${userId}, output: "${output}"`);
    app.infra.bus.emit('askUser', { userId, message: output });
    return 'sent';
  }

  async post(shared: SharedStore<TaskSchedulerContext>, _prepRes: AskUserPrepResult, execRes: AskUserExecResult) {
    console.log(`[AskUser.post] execRes: ${execRes}`);
    return undefined;
  }
}

// ToolCalls Types
type ToolCallsPrepResult = {
  tc: ChatCompletionMessageFunctionToolCall;
  app: App;
  userId: string;
};
type ToolCallsExecResult = {
  role: 'tool';
  content: string;
  tool_call_id: string;
};

export class ToolCalls extends ParallelBatchNode<SharedStore<ToolCallsContext>> {
  async prep(shared: SharedStore<ToolCallsContext>): Promise<ToolCallsPrepResult[]> {
    const { toolCalls,  userId } = shared.context;

    console.log(`[ToolCalls.prep] Processing ${toolCalls.length} tool calls for userId: ${userId}, userId: ${userId}`);
    toolCalls.forEach((tc: ChatCompletionMessageFunctionToolCall, idx: number) => {
      console.log(`[ToolCalls.prep] Tool ${idx}: ${tc.function.name}, args: ${tc.function.arguments}`);
    });
    return toolCalls.map((tc: ChatCompletionMessageFunctionToolCall) => ({ tc, app: shared.app, userId }));
  }

  async exec({ tc, app, userId }: ToolCallsPrepResult): Promise<ToolCallsExecResult> {
    const args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
    const { name } = tc.function;

    const handler = createToolHandler(name);
    const content = await handler(app, { userId }, args);

    console.log(`[ToolCalls.exec] Tool ${name} returned: "${content}"`);

    return { role: 'tool', content, tool_call_id: tc.id };
  }

  async post(shared: SharedStore<TaskSchedulerContext>, _prepRes: ToolCallsPrepResult[], execRes: ToolCallsExecResult[]) {
    console.log(`[ToolCalls.post] Adding ${execRes.length} tool result messages to history`);
    shared.app.data.messageHistory.addMessages(shared.context.userId, execRes);
    return undefined;
  }
}
