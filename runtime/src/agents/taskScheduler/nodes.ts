/**
 * Nodes for the taskScheduler flow using the new flow framework.
 * Each node has a clear, single responsibility.
 */
import { Node, packet, batch, BatchPacket, SinglePacket } from '../../utils/agent/flow.js';
import { callLlmWithTools } from '../../utils/callLlm.js';
import { createToolHandler, TOOLS } from './tools.js';
import type { App } from '../../app.js';
import type { TaskSchedulerContext } from './types.js';
import { AssistantMessage, ToolResultMessage, UserMessage, type LLMToolCall } from '../../utils/message.js';
import { createSystemPrompt } from './prompts/index.js';

// ─── PrepareInput ────────────────────────────────────────────────────────────

export class PrepareInput extends Node<App, TaskSchedulerContext, { message: string } | undefined, { default: void }> {
  async run(p: this['In']): Promise<this['Out']> {
    const { session, user } = p.context;
    const app = p.deps;

    const userTasks = await app.data.taskRepository.getTasks(user.id);
    const timezone = await app.data.taskRepository.getUserTimezone(user.id);
    const currentDate = new Date().toISOString();
    const tasksSchema = app.tasks.getTasksSchema();

    const systemPrompt = createSystemPrompt(currentDate, timezone, JSON.stringify(userTasks), tasksSchema);
    await session.upsertSystemPrompt(systemPrompt);

    const input = p.data as { message?: string } | undefined;
    if (input?.message) {
      await session.addUserMessage(new UserMessage(input.message));
    }

    console.log(`[taskScheduler.PrepareInput] session='${session.id}' firstEntry=${!!input?.message}`);
    return packet({ data: undefined, context: p.context, deps: p.deps });
  }
}

// ─── DecideAction ────────────────────────────────────────────────────────────

/**
 * DecideAction: LLM decides what action to take using session from context
 */
export class DecideAction extends Node<
  App,
  TaskSchedulerContext,
  undefined,
  { tool_calls: LLMToolCall[]; response: string }
> {
  constructor() {
    super({ maxRunTries: 3, wait: 1000 });
  }

  async run(p: this['In']): Promise<this['Out']> {
    const { session } = p.context;

    const messages = session.activeMessages.map((msg) => msg.message);

    console.log(`[DecideAction.run] Using session '${session.id}' from context with ${messages.length} messages`);

    console.log(`[DecideAction.run] Calling LLM with ${messages.length} messages`);

    const response = await callLlmWithTools(messages, TOOLS);

    const assistantMsg = AssistantMessage.from(response[0].message);
    await session.addMessages([{ message: assistantMsg.toJSON() }]);

    console.log(`[DecideAction.run] LLM response:`, JSON.stringify(assistantMsg.toJSON(), null, 2));

    if ('toolCalls' in assistantMsg && assistantMsg.toolCalls && assistantMsg.toolCalls.length > 0) {
      console.log(`[DecideAction.run] Processing ${assistantMsg.toolCalls.length} tool calls`);
      return packet({
        data: assistantMsg.toolCalls,
        context: p.context,
        branch: 'tool_calls',
        deps: p.deps,
      });
    }

    const text = assistantMsg.toJSON().content || '';
    console.log(`[DecideAction.run] Text response: "${text}"`);
    return packet({
      data: text,
      context: p.context,
      branch: 'response',
      deps: p.deps,
    });
  }
}

export class Response extends Node<App, TaskSchedulerContext, string, { default: void }> {
  async run(p: this['In']): Promise<this['Out']> {
    const { user, session } = p.context;
    const response = p.data;
    console.log(`[Response] Sending message to userId: ${user.id}, output: "${response}"`);
    await (await session.respond(user, response)).complete();
    return packet({
      data: undefined,
      context: p.context,
      deps: p.deps,
    });
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
export class ToolCalls extends Node<App, TaskSchedulerContext, LLMToolCall[], { default: void }> {
  async preprocess(p: this['In']): Promise<BatchPacket<LLMToolCall, App, TaskSchedulerContext>> {
    const toolCalls = p.data;
    if (!toolCalls) throw new Error('toolCalls is required');
    console.log(`[ToolCalls.preprocess] Processing ${toolCalls.length} tool calls`);
    return batch({
      data: toolCalls,
      context: p.context,
      deps: p.deps,
    });
  }

  async run(
    p: SinglePacket<LLMToolCall, App, TaskSchedulerContext>,
  ): Promise<SinglePacket<ToolCallResult, App, TaskSchedulerContext>> {
    const toolCall = p.data;
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
    const res = await handler(p.deps, p.context, toolCall.args);
    return packet({
      data: { toolCallId: id, name, content: res } as ToolCallResult,
      context: p.context,
      deps: p.deps,
    });
  }

  async postprocess(p: BatchPacket<ToolCallResult, App, TaskSchedulerContext>): Promise<this['Out']> {
    const results = p.data;
    const { session } = p.context;

    console.log(`[ToolCalls.postprocess] Adding ${results.length} tool results to session`);

    const toolMessages = results.map((result) => ({
      message: new ToolResultMessage({ toolCallId: result.toolCallId, content: result.content }).toJSON(),
    }));

    await session.addMessages(toolMessages);

    return packet({
      data: undefined,
      context: p.context,
      deps: p.deps,
    });
  }
}
