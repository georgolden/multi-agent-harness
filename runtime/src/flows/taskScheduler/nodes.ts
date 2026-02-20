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
import type { App } from '../../app.js';
import type { TaskSchedulerContext, AskUserContext, ToolCallsContext } from './types.js';
import type { FlowSession } from '../../data/flowSessionRepository/types.js';

// PrepareInput Types
type PrepareInputPrepResult = FlowSession;
type PrepareInputExecResult = 'done';

/**
 * PrepareInput: Prepare all context and create flow session with user's message (runs once)
 */
export class PrepareInput extends Node<SharedStore<TaskSchedulerContext>> {
  async prep(shared: SharedStore<TaskSchedulerContext>): Promise<PrepareInputPrepResult> {
    const { userId, message } = shared.context;
    console.log(`[PrepareInput.prep] Preparing context and creating flow session for user message: "${message}"`);

    const { data } = shared.app;

    // Fetch all required context
    const userTaskSchedulers = await data.taskRepository.getTasks(userId);
    const timezone = await data.taskRepository.getUserTimezone(userId);
    const currentDate = new Date().toISOString();
    const tasksTypes = shared.app.tasks.getTasksSchema();

    console.log(`[PrepareInput.prep] Found ${userTaskSchedulers.length} tasks, timezone: ${timezone}`);

    // Create system prompt with all context
    const systemPrompt = createSystemPrompt(currentDate, timezone, JSON.stringify(userTaskSchedulers), tasksTypes);

    // Create flow session with complete system prompt
    const session = await shared.app.data.flowSessionRepository.createSession({
      userId,
      flowName: 'taskScheduler',
      systemPrompt,
    });

    // Add user message to session
    const userMessage: ChatCompletionMessageParam = {
      role: 'user',
      content: message,
    };

    await shared.app.data.flowSessionRepository.addMessages(session.id, [{ message: userMessage }]);

    console.log(`[PrepareInput.prep] Created session '${session.id}' with system prompt and user message`);
    return session;
  }

  async exec(_prepRes: PrepareInputPrepResult): Promise<PrepareInputExecResult> {
    return 'done';
  }

  async post(
    shared: SharedStore<TaskSchedulerContext>,
    prepRes: PrepareInputPrepResult,
    _execRes: PrepareInputExecResult,
  ) {
    // Store session in context for subsequent nodes
    shared.context.session = prepRes;
    return undefined;
  }
}

// DecideAction Types
type DecideActionPrepResult = {
  sessionId: string;
  systemPrompt: string;
  conversation: ChatCompletionMessageParam[];
};
type DecideActionExecResult = ChatCompletionMessage;

/**
 * DecideAction: LLM decides what action to take using session from context
 */
export class DecideAction extends Node<SharedStore<TaskSchedulerContext>> {
  constructor() {
    super(3, 1); // maxRetries: 3, wait: 1s
  }

  async prep(shared: SharedStore<TaskSchedulerContext>): Promise<DecideActionPrepResult> {
    const { session } = shared.context;

    if (!session) {
      throw new Error('Session is required');
    }

    const conversation = session.activeMessages.map((msg) => msg.message);

    console.log(`[DecideAction.prep] Using session '${session.id}' from context with ${conversation.length} messages`);

    return {
      sessionId: session.id,
      systemPrompt: session.systemPrompt,
      conversation,
    };
  }

  async exec(prepRes: DecideActionPrepResult): Promise<DecideActionExecResult> {
    const { systemPrompt, conversation } = prepRes;

    const messages: ChatCompletionMessageParam[] = [{ role: 'system', content: systemPrompt }, ...conversation];

    console.log(`[DecideAction.exec] Calling LLM with ${messages.length} messages`);

    // Call LLM with tools
    const response = await callLlmWithTools(messages, TOOLS);

    console.log(`[DecideAction.exec] LLM response:`, JSON.stringify(response[0].message, null, 2));

    return response[0].message;
  }

  async post(
    shared: SharedStore<TaskSchedulerContext>,
    prepRes: DecideActionPrepResult,
    execRes: DecideActionExecResult,
  ) {
    const { session } = shared.context;
    if (!session) {
      throw new Error('Session is required');
    }

    // Add assistant message to session (both DB and context)
    const updatedMessages = await shared.app.data.flowSessionRepository.addMessages(session.id, [{ message: execRes }]);
    session.activeMessages = updatedMessages.map((msg) => msg);

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
 * AskUser: Send response to user and mark session as completed
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

  async post(shared: SharedStore<TaskSchedulerContext>, _prepRes: AskUserPrepResult, _execRes: AskUserExecResult) {
    const { session } = shared.context;

    // Mark session as completed
    if (session) {
      await shared.app.data.flowSessionRepository.updateStatus(session.id, 'completed');
      console.log(`[AskUser.post] Marked session ${session.id} as completed`);
    }

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
    const { toolCalls, userId } = shared.context;

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

  async post(
    shared: SharedStore<TaskSchedulerContext>,
    _prepRes: ToolCallsPrepResult[],
    execRes: ToolCallsExecResult[],
  ) {
    console.log(`[ToolCalls.post] Adding ${execRes.length} tool result messages to session`);

    const { session } = shared.context;
    if (!session) {
      throw new Error('Session is required');
    }

    // Add tool results to session (both DB and context)
    const updatedMessages = await shared.app.data.flowSessionRepository.addMessages(
      session.id,
      execRes.map((result) => ({ message: result })),
    );
    session.activeMessages = updatedMessages.map((msg) => msg);

    return undefined;
  }
}
