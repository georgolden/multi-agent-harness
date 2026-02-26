/**
 * Generic agentic loop nodes.
 * Tools are provided externally via the context - no hardcoded tool handlers.
 */
import { Node, batch, packet, type SinglePacket, type BatchPacket } from '../../utils/agent/flow.js';
import type {
  ChatCompletionMessageParam,
} from '../../types.js';
import type { App } from '../../app.js';
import type { Tool } from '../../tools/index.js';
import { callLlmWithTools } from '../../utils/callLlm.js';
import type { AgenticLoopContext, AskUserContext } from './types.js';
import type OpenAI from 'openai';
import { Session } from '../../services/sessionService/session.js';
import {
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  type LLMToolCall,
} from '../../utils/message.js';

// ─── PrepareInput ────────────────────────────────────────────────────────────

/**
 * PrepareInput: Add the user's message to the pre-created session (runs once).
 * Session is already created by prepareAgenticLoop before flow.run().
 * Applies userPromptTemplate if set, otherwise uses the raw message.
 */
export class PrepareInput extends Node<any, AgenticLoopContext, any, { default: void }> {
  async run(p: this['In']): Promise<this['Out']> {
    const { session, message } = p.context!;

    console.log(`[PrepareInput.prep] Adding user message to session '${session.id}'`);
    await session.addMessages([{ message: new UserMessage(message).toJSON() }]);
    return packet({ context: { ...p.context!, iterations: 0 }, deps: p.deps });
  }
}

// ─── DecideAction ────────────────────────────────────────────────────────────

/**
 * DecideAction: LLM decides the next action using the session's tool schemas and options.
 * Routes to 'ask_user' (text response) or 'tool_calls' (tool execution).
 */
export class DecideAction extends Node<any, AgenticLoopContext, any, { ask_user: void; tool_calls: void }> {
  constructor() {
    super({ maxRunTries: 3, wait: 1000 });
  }

  async run(p: this['In']): Promise<this['Out']> {
    const { session } = p.context!;
    const conversation = session.activeMessages.map((msg) => msg.message) as any[];

    // Convert stored ToolSchema[] to the OpenAI ChatCompletionTool format
    const tools: OpenAI.ChatCompletionTool[] = session.toolSchemas.map((schema) => ({
      type: 'function' as const,
      function: {
        name: schema.name,
        description: schema.description,
        parameters: schema.parameters,
      },
    }));

    const systemPrompt = session.systemPrompt;
    const callLlmOptions = session.callLlmOptions;

    console.log(`[DecideAction.run] Session '${session.id}', ${conversation.length} messages, ${tools.length} tools`);

    const messages = [
      { role: 'system', content: systemPrompt },
      ...conversation,
    ] as any[];

    console.log(`[DecideAction.exec] Calling LLM with ${messages.length} messages`);

    const response = await callLlmWithTools(messages, tools, callLlmOptions);
    const assistantMsg = AssistantMessage.from(response[0].message);

    await session.addMessages([{ message: assistantMsg.toJSON() }]);

    if ('toolCalls' in assistantMsg && assistantMsg.toolCalls && assistantMsg.toolCalls.length > 0) {
      console.log(`[DecideAction.post] ${assistantMsg.toolCalls.length} tool calls, routing to tool_calls`);
      return packet({
        context: { ...p.context!, toolCalls: assistantMsg.toolCalls, iterations: (p.context!.iterations ?? 0) + 1 },
        branch: 'tool_calls',
        deps: p.deps,
      });
    }

    // Text response
    let output = '';
    if ('text' in assistantMsg) {
      output = (assistantMsg as any).text;
    }
    if (!output) output = 'AI is broken, try again later';

    console.log(`[DecideAction.post] Text response, routing to ask_user`);
    return packet({
      context: { ...p.context!, response: output },
      branch: 'ask_user',
      deps: p.deps,
    });
  }
}

// ─── AskUser ─────────────────────────────────────────────────────────────────

/**
 * AskUser: Emit the response to the user and mark the session as completed.
 */
export class AskUser extends Node<any, AskUserContext, any, { default: void }> {
  async run(p: this['In']): Promise<this['Out']> {
    const { response, user, session } = p.context!;
    console.log(`[AskUser.exec] Sending message to userId: ${user.id}`);
    await session.respond(response);
    await session.complete();
    console.log(`[AskUser.post] Marked session '${session.id}' as completed`);
    return packet({ context: p.context, deps: p.deps });
  }
}

// ─── ToolCalls ───────────────────────────────────────────────────────────────

type ToolCallsExecResult = {
  role: 'tool';
  content: string;
  tool_call_id: string;
};

/**
 * ToolCalls: Execute tool calls in parallel using the context's Tool instances.
 * Finds each tool by name and calls tool.execute() — no hardcoded handlers.
 */
export class ToolCalls extends Node<any, AgenticLoopContext, { tc: LLMToolCall; app: App; tools: Tool[] }, { default: void }> {
  async preprocess(p: this['In'] | this['InBatch']): Promise<BatchPacket<{ tc: LLMToolCall; app: App; tools: Tool[] }, any, AgenticLoopContext>> {
    const { toolCalls, tools } = (p.context as any);
    console.log(`[ToolCalls.prep] Processing ${toolCalls.length} tool calls`);
    return batch({
      data: toolCalls.map((tc: LLMToolCall) => ({ tc, app: (p as any).deps?.app, tools })),
      context: p.context,
      deps: p.deps,
    });
  }

  async run(p: SinglePacket<{ tc: LLMToolCall; app: App; tools: Tool[] }, any, AgenticLoopContext>): Promise<SinglePacket<ToolCallsExecResult, any, AgenticLoopContext>> {
    const { tc, app, tools } = p.data!;
    const { name, args, id } = tc;

    const tool = tools.find((t) => t.name === name);
    if (!tool) {
      console.warn(`[ToolCalls.exec] Tool '${name}' not found in session`);
      return packet({
        data: { role: 'tool', content: `Tool '${name}' not found`, tool_call_id: id } as ToolCallsExecResult,
        context: p.context,
        deps: p.deps,
      });
    }

    const result = await tool.execute(app, args, { toolCallId: id });
    const content = result.content
      .map((block: any) => (block.type === 'text' ? block.text : `[image: ${block.mimeType}]`))
      .join('\n');

    console.log(`[ToolCalls.exec] Tool '${name}' returned ${content.length} chars`);
    return packet({
      data: { role: 'tool', content, tool_call_id: id } as ToolCallsExecResult,
      context: p.context,
      deps: p.deps,
    });
  }

  async postprocess(p: BatchPacket<ToolCallsExecResult, any, AgenticLoopContext>): Promise<this['Out']> {
    const execRes = p.data;
    const { session } = p.context!;
    console.log(`[ToolCalls.post] Adding ${execRes.length} tool results to session`);
    await session.addMessages(
      execRes.map((result) => ({
        message: new ToolResultMessage({ toolCallId: result.tool_call_id, content: result.content }).toJSON(),
      })),
    );
    return packet({ context: { ...p.context!, iterations: (p.context!.iterations ?? 0) + 1 }, deps: p.deps });
  }
}
