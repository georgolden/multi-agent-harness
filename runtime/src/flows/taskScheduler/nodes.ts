/**
 * Nodes for the taskScheduler flow using the new flow framework.
 * Each node has a clear, single responsibility.
 */
import { Node, packet, batch, BatchPacket, SinglePacket, pause } from '../../utils/agent/flow.js';
import { callLlmWithTools } from '../../utils/callLlm.js';
import { createSystemPrompt } from './prompts/index.js';
import { createToolHandler, TOOLS } from './tools.js';
import type { App } from '../../app.js';
import type { TaskSchedulerContext } from './types.js';
import {
  AssistantMessage,
  UserMessage,
  ToolResultMessage,
  type LLMToolCall,
  SystemMessage,
} from '../../utils/message.js';

// ─── PrepareInput ────────────────────────────────────────────────────────────

/**
 * PrepareInput: Prepare all context and create flow session with user's message (runs once)
 */
export class PrepareInput extends Node<App, TaskSchedulerContext, string, { default: void }> {
  async run(p: this['In']): Promise<this['Out']> {
    const { user } = p.context;
    const app = p.deps;
    const message = p.data;
    console.log(`[PrepareInput.run] Preparing context and creating flow session for user message: "${message}"`);

    const { data, services } = app;

    // Fetch all required context
    const userTasks = await data.taskRepository.getTasks(user.id);
    const timezone = await data.taskRepository.getUserTimezone(user.id);
    const currentDate = new Date().toISOString();
    const tasksSchema = app.tasks.getTasksSchema();

    console.log(`[PrepareInput.run] Found ${userTasks.length} tasks, timezone: ${timezone}`);

    // Create system prompt with all context
    const systemPrompt = createSystemPrompt(currentDate, timezone, JSON.stringify(userTasks), tasksSchema);

    // Create flow session
    const session = await services.sessionService.create({
      userId: user.id,
      flowName: 'taskScheduler',
      systemPrompt,
    });

    // Add user message to session
    await session.addMessages([{ message: new UserMessage(message).toJSON() }]);

    console.log(`[PrepareInput.run] Created session '${session.id}' with system prompt and user message`);
    return packet({
      data: undefined,
      context: { ...p.context, session },
      deps: p.deps,
    });
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
  { ask_user: LLMToolCall; tool_calls: LLMToolCall[]; response: string }
> {
  constructor() {
    super({ maxRunTries: 3, wait: 1000 });
  }

  async run(p: this['In']): Promise<this['Out']> {
    const { session } = p.context;

    if (!session) {
      throw new Error('Session is required');
    }

    const conversation = session.activeMessages.map((msg) => msg.message);

    console.log(`[DecideAction.run] Using session '${session.id}' from context with ${conversation.length} messages`);

    const messages = [new SystemMessage(session.systemPrompt).toJSON(), ...conversation];

    console.log(`[DecideAction.run] Calling LLM with ${messages.length} messages`);

    const response = await callLlmWithTools(messages, TOOLS);

    const assistantMsg = AssistantMessage.from(response[0].message);
    await session.addMessages([{ message: assistantMsg.toJSON() }]);

    console.log(`[DecideAction.run] LLM response:`, JSON.stringify(assistantMsg.toJSON(), null, 2));

    if ('toolCalls' in assistantMsg === false || !assistantMsg.toolCalls || assistantMsg.toolCalls.length === 0) {
      const text = assistantMsg.toJSON().content || '';
      console.log(`[DecideAction.run] Setting response to: "${text}"`);
      return packet({
        data: text,
        context: p.context,
        branch: 'response',
        deps: p.deps,
      });
    }

    const askUserToolCall = assistantMsg.toolCalls.find((t: any) => t.funcion?.name === 'ask_user');
    if (askUserToolCall) {
      return packet({
        branch: 'ask_user',
        context: p.context,
        deps: p.deps,
        data: askUserToolCall,
      });
    }

    console.log(`[DecideAction.run] Processing ${assistantMsg.toolCalls.length} tool calls`);
    return packet({
      data: assistantMsg.toolCalls,
      context: p.context,
      branch: 'tool_calls',
      deps: p.deps,
    });
  }
}

export class AskUser extends Node<
  App,
  TaskSchedulerContext,
  { id: string; args: { question: string; options?: string[] } },
  { default: void }
> {
  async run(p: this['In']): Promise<this['Out']> {
    const { user, session } = p.context;

    const { question, options } = p.data.args;
    const message = `
    ${question}

    ${options ? 'Options:' : ''}
    ${options?.map((option, index) => `${index + 1}. ${option}`).join('\n')} 
    `;
    console.log(`[AskUser.run] Sending message to userId: ${user.id}, output: "${message}"`);
    await session!.respond(user, message);
    session!.onUserMessage(({ message }: { message: string }) => {
      this.resume({ data: { message, toolCallId: p.data.id }, context: p.context, deps: p.deps });
    });
    await session!.pause();
    return pause({
      data: undefined,
      context: p.context,
      deps: p.deps,
    });
  }
}

export class UserResponse extends Node<
  App,
  TaskSchedulerContext,
  { toolCallId: string; message: string },
  { default: void }
> {
  async run(p: this['In']): Promise<this['Out']> {
    const { session } = p.context;
    const { toolCallId, message } = p.data;
    await session!.addMessages([{ message: new ToolResultMessage({ toolCallId, content: message }).toJSON() }]);
    await session!.resume();
    return packet({
      data: undefined,
      context: p.context,
      deps: p.deps,
    });
  }
}

export class Response extends Node<App, TaskSchedulerContext, string, { default: void }> {
  async run(p: this['In']): Promise<this['Out']> {
    const { user, session } = p.context;
    const response = p.data;
    console.log(`[Response] Sending message to userId: ${user.id}, output: "${response}"`);
    await (await session!.respond(user, response)).complete();
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

    await session!.addMessages(toolMessages);

    return packet({
      data: undefined,
      context: p.context,
      deps: p.deps,
    });
  }
}
