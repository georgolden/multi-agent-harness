/**
 * Nodes for the taskScheduler flow using the new flow framework.
 * Each node has a clear, single responsibility.
 */
import { Node, packet, batch, BatchPacket } from '../../utils/agent/flow.js';
import { callLlmWithTools } from '../../utils/callLlm.js';
import { createSystemPrompt } from './prompts/index.js';
import { createToolHandler, TOOLS } from './tools.js';
import type { App } from '../../app.js';
import type { TaskSchedulerContext, AskUserContext } from './types.js';
import { AssistantMessage, UserMessage, ToolResultMessage, type LLMToolCall } from '../../utils/message.js';

// ─── PrepareInput ────────────────────────────────────────────────────────────

/**
 * PrepareInput: Prepare all context and create flow session with user's message (runs once)
 */
export class PrepareInput extends Node<{ app: App }, TaskSchedulerContext, any, { default: void }> {
  async run(p: this['In']): Promise<this['Out']> {
    const { userId, message } = p.context!;
    const { app } = p.deps!;
    console.log(`[PrepareInput.run] Preparing context and creating flow session for user message: "${message}"`);

    const { data, services } = app;

    // Fetch all required context
    const userTasks = await data.taskRepository.getTasks(userId);
    const timezone = await data.taskRepository.getUserTimezone(userId);
    const currentDate = new Date().toISOString();
    const tasksSchema = app.tasks.getTasksSchema();

    console.log(`[PrepareInput.run] Found ${userTasks.length} tasks, timezone: ${timezone}`);

    // Create system prompt with all context
    const systemPrompt = createSystemPrompt(currentDate, timezone, JSON.stringify(userTasks), tasksSchema);

    // Create flow session
    const session = await services.sessionService.create({
      userId,
      flowName: 'taskScheduler',
      systemPrompt,
    });

    // Add user message to session
    await session.addMessages([{ message: new UserMessage(message).toJSON() }]);

    console.log(`[PrepareInput.run] Created session '${session.id}' with system prompt and user message`);
    return packet({ context: { ...p.context!, session }, deps: p.deps });
  }
}

// ─── DecideAction ────────────────────────────────────────────────────────────

/**
 * DecideAction: LLM decides what action to take using session from context
 */
export class DecideAction extends Node<{ app: App }, TaskSchedulerContext, any, { ask_user: void; tool_calls: void }> {
  constructor() {
    super({ maxRunTries: 3, wait: 1000 });
  }

  async run(p: this['In']): Promise<this['Out']> {
    const { session } = p.context!;

    if (!session) {
      throw new Error('Session is required');
    }

    const conversation = session.activeMessages.map((msg) => msg.message) as any[];

    console.log(`[DecideAction.run] Using session '${session.id}' from context with ${conversation.length} messages`);

    const messages = [{ role: 'system', content: session.systemPrompt }, ...conversation] as any[];

    console.log(`[DecideAction.run] Calling LLM with ${messages.length} messages`);

    const response = await callLlmWithTools(messages, TOOLS);

    const assistantMsg = AssistantMessage.from(response[0].message);
    await session.addMessages([{ message: assistantMsg.toJSON() }]);

    console.log(`[DecideAction.run] LLM response:`, JSON.stringify(assistantMsg.toJSON(), null, 2));

    if ('toolCalls' in assistantMsg && assistantMsg.toolCalls && assistantMsg.toolCalls.length > 0) {
      console.log(`[DecideAction.run] Processing ${assistantMsg.toolCalls.length} tool calls`);
      return packet({
        context: { ...p.context!, toolCalls: assistantMsg.toolCalls },
        branch: 'tool_calls',
        deps: p.deps,
      });
    }

    // Text response — ask user
    const text = (assistantMsg as any).text || '';
    console.log(`[DecideAction.run] Setting response to: "${text}"`);
    return packet({
      context: { ...p.context!, response: text },
      branch: 'ask_user',
      deps: p.deps,
    });
  }
}

// ─── AskUser ──────────────────────────────────────────────────────────────────

/**
 * AskUser: Send response to user and mark session as completed
 */
export class AskUser extends Node<{ app: App }, AskUserContext, any, { default: void }> {
  async run(p: this['In']): Promise<this['Out']> {
    const { response, userId, session } = p.context!;

    console.log(`[AskUser.run] Sending message to userId: ${userId}, output: "${response}"`);
    await session.respond(response);
    await session.complete();
    console.log(`[AskUser.run] Marked session ${session.id} as completed`);

    return packet({ context: p.context, deps: p.deps });
  }
}

// ─── ToolCalls ────────────────────────────────────────────────────────────────

type ToolCallResult = {
  toolCallId: string;
  name: string;
  content: string;
};

/**
 * ToolCalls: Execute tool calls in parallel and process results
 */
export class ToolCalls extends Node<{ app: App }, TaskSchedulerContext, LLMToolCall, { default: void }> {
  async preprocess(p: this['In']): Promise<any> {
    const { toolCalls } = p.context as any;
    console.log(`[ToolCalls.preprocess] Processing ${toolCalls.length} tool calls`);
    return batch({
      data: toolCalls,
      context: p.context,
      deps: p.deps,
    });
  }

  async run(p: this['In']): Promise<any> {
    const toolCall = p.data as LLMToolCall;
    const { name, id } = toolCall;

    const tool = TOOLS.find((t: any) => t.function?.name === name);
    if (!tool) {
      console.warn(`[ToolCalls.run] Tool '${name}' not found`);
      return packet({
        data: { toolCallId: id, name, content: `Tool '${name}' not found` } as ToolCallResult,
        context: p.context,
        deps: p.deps,
      });
    }

    console.log(`[ToolCalls.run] Executing tool '${name}'`);
    const handler = createToolHandler(name);
    const res = await handler(p.deps!.app, p.context!, toolCall.args);
    return packet({
      data: { toolCallId: id, name, content: res } as ToolCallResult,
      context: p.context,
      deps: p.deps,
    });
  }

  async postprocess(p: BatchPacket<ToolCallResult, { app: App }, TaskSchedulerContext>): Promise<this['Out']> {
    const results = p.data;
    const { session } = p.context!;

    console.log(`[ToolCalls.postprocess] Adding ${results.length} tool results to session`);

    const toolMessages = results.map((result) => ({
      message: new ToolResultMessage({ toolCallId: result.toolCallId, content: result.content }).toJSON(),
    }));

    await session!.addMessages(toolMessages);

    return packet({ context: p.context, deps: p.deps });
  }
}
