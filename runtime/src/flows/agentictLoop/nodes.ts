/**
 * Generic agentic loop nodes.
 * Tools are provided externally via the context - no hardcoded tool handlers.
 *
 * Flow graph:
 *   PrepareInput → DecideAction ─┬─ ask_user      → AskUser        (ends run; session completed)
 *                                ├─ tool_calls    → ToolCalls      (loops back to DecideAction)
 *                                └─ submit_answer → SubmitAnswer    (ends run; session completed)
 */
import {
  Node,
  batch,
  packet,
  exit,
  error,
  type SinglePacket,
  type BatchPacket,
  pause,
} from '../../utils/agent/flow.js';
import type { App } from '../../app.js';
import type { Tool } from '../../tools/index.js';
import { callLlmWithTools } from '../../utils/callLlm.js';
import type { AgenticLoopContext } from './types.js';
import type OpenAI from 'openai';
import { Session } from '../../services/sessionService/session.js';
import {
  SystemMessage,
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  type LLMToolCall,
} from '../../utils/message.js';
import { fillTemplateFlow } from '../fillTemplate/flow.js';

// ─── PrepareInput ────────────────────────────────────────────────────────────

/**
 * PrepareInput: Add the user's message to the pre-created session (runs once).
 * Session is already created by prepareAgenticLoop before flow.run().
 * Outputs the session for DecideAction to use.
 */
export class PrepareInput extends Node<App, AgenticLoopContext, string, { default: Session }> {
  async run(p: this['In']): Promise<this['Out']> {
    const { session, user } = p.context;
    let message = p.data;
    if (session.userPromptTemplate) {
      const handle = await fillTemplateFlow.run(
        p.deps,
        { user, parent: session },
        {
          message: p.data,
          template: session.userPromptTemplate,
        },
      );
      const result = await handle.promise;
      message = (result as any).data ?? message;
    }
    console.log(`[PrepareInput.prep] Adding user message to session '${session.id}'`);
    await session.addUserMessage(new UserMessage(message));
    return packet({
      data: session,
      context: p.context,
      deps: p.deps,
    });
  }
}

// ─── DecideAction ────────────────────────────────────────────────────────────

/**
 * DecideAction: LLM decides the next action using the session's tool schemas and options.
 * Takes a Session and routes to:
 *   'ask_user'       — LLM replied with text (response string for the user)
 *   'tool_calls'     — LLM called tools (Session to loop back to ToolCalls)
 *   'submit_answer'  — LLM called submit_answer tool (answer string)
 */
export class DecideAction extends Node<
  App,
  AgenticLoopContext,
  Session,
  { ask_user: string; tool_calls: LLMToolCall[]; submit_answer: string; loop: undefined }
> {
  constructor({ maxLoopEntering = 10 }: { maxLoopEntering?: number }) {
    super({ maxRunTries: 3, wait: 1000, maxLoopEntering });
  }

  async run(p: this['In']): Promise<this['Out']> {
    const session = p.data;
    const conversation = session.activeMessages.map((msg) => msg.message);

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

    const messages = [new SystemMessage(systemPrompt).toJSON(), ...conversation];

    console.log(`[DecideAction.exec] Calling LLM with ${messages.length} messages`);

    const response = await callLlmWithTools(messages, tools, callLlmOptions);
    const assistantMsg = AssistantMessage.from(response[0].message);

    await session.addMessages([{ message: assistantMsg.toJSON() }]);

    if ('toolCalls' in assistantMsg && assistantMsg.toolCalls && assistantMsg.toolCalls.length > 0) {
      // Check if any tool call is submit_answer
      const submitAnswerCall = assistantMsg.toolCalls.find((tc) => tc.name === 'submit_answer');
      if (submitAnswerCall) {
        console.log(`[DecideAction.post] submit_answer tool call detected, routing to submit_answer`);
        return packet({
          data: submitAnswerCall.args.answer as string,
          context: p.context,
          branch: 'submit_answer',
          deps: p.deps,
        });
      }

      // Regular tool calls — return tool calls for ToolCalls to process
      console.log(`[DecideAction.post] ${assistantMsg.toolCalls.length} tool calls, routing to tool_calls`);
      return packet({
        data: assistantMsg.toolCalls,
        context: p.context,
        branch: 'tool_calls',
        deps: p.deps,
      });
    }

    // Plain text response (unexpected — tools are required) — loop with error message
    const text = assistantMsg.toJSON().content || '';
    const errorMsg = `${text}\n\nPlease call one of the available tools instead of providing plain text.`;
    await session.addMessages([{ message: new UserMessage(errorMsg).toJSON() }]);
    console.log(`[DecideAction.run] Plain text response (unexpected), looping back`);
    return packet({
      data: undefined,
      context: p.context,
      branch: 'loop',
      deps: p.deps,
    });
  }

  async fallback(p: this['In'] | this['InError'], err: Error): Promise<this['Out']> {
    const { session } = p.context;
    const onError = session.agentLoopConfig?.onError ?? 'retry';
    console.warn(`[DecideAction.fallback] ${err.message}, strategy: ${onError}`);
    if (onError === 'retry') {
      await session.addMessages([{ message: new UserMessage(`Error: ${err.message}. Retrying...`).toJSON() }]);
      return packet({ data: undefined, branch: 'loop', context: p.context, deps: p.deps });
    }
    return packet({ data: err.message, branch: 'ask_user', context: p.context, deps: p.deps });
  }
}

// ─── AskUser ─────────────────────────────────────────────────────────────────
export class AskUser extends Node<App, AgenticLoopContext, string, { default: void }> {
  async run(p: this['In']): Promise<this['Out']> {
    const ctx = p.context;
    const session = ctx.session!;
    const message = p.data;
    console.log(`[AskUser.run] Sending question to user, session '${session!.id}'`);
    await session.respond(ctx.user, message);
    session.onUserMessage(({ message }) => {
      this.resume({ data: message, context: p.context, deps: p.deps });
    });
    await session.pause();
    return pause({
      data: undefined,
      context: p.context,
      deps: p.deps,
    });
  }
}

export class UserResponse extends Node<App, AgenticLoopContext, string, { default: Session }> {
  async run(p: this['In']): Promise<this['Out']> {
    const session = p.context.session!;
    const message = p.data;
    await session.addUserMessage(new UserMessage(message));
    await session.resume();
    return packet({
      data: session,
      context: p.context,
      deps: p.deps,
    });
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
 * Outputs the session so it loops back to DecideAction.
 */
export class ToolCalls extends Node<App, AgenticLoopContext, LLMToolCall[], { default: Session; ask_user: string }> {
  async preprocess(p: this['In']): Promise<BatchPacket<LLMToolCall, App, AgenticLoopContext>> {
    const toolCalls = p.data;
    if (!toolCalls) throw new Error('toolCalls is required');
    console.log(`[ToolCalls.prep] Processing ${toolCalls.length} tool calls`);
    return batch({
      data: toolCalls,
      context: p.context,
      deps: p.deps,
    });
  }

  async run(
    p: SinglePacket<LLMToolCall, App, AgenticLoopContext>,
  ): Promise<SinglePacket<ToolCallsExecResult, App, AgenticLoopContext>> {
    const toolCall = p.data!;
    const { name, args, id } = toolCall;
    const { tools } = p.context;

    const tool = tools.find((t) => t.name === name);
    if (!tool) {
      console.warn(`[ToolCalls.exec] Tool '${name}' not found in session`);
      return packet({
        data: { role: 'tool', content: `Tool '${name}' not found`, tool_call_id: id } as ToolCallsExecResult,
        context: p.context,
        deps: p.deps,
      });
    }

    const result = await tool.execute(p.deps, p.context, args, { toolCallId: id });
    const content = result.data.content;

    console.log(`[ToolCalls.exec] Tool '${name}' returned ${content.length} chars`);
    return packet({
      data: { role: 'tool', content, tool_call_id: id } as ToolCallsExecResult,
      context: p.context,
      deps: p.deps,
    });
  }

  async postprocess(p: BatchPacket<ToolCallsExecResult, App, AgenticLoopContext>): Promise<this['Out']> {
    const execRes = p.data;
    const { session } = p.context;
    console.log(`[ToolCalls.post] Adding ${execRes.length} tool results to session`);
    await session.addMessages(
      execRes.map((result) => ({
        message: new ToolResultMessage({ toolCallId: result.tool_call_id, content: result.content }).toJSON(),
      })),
    );
    return packet({
      data: session,
      context: p.context,
      deps: p.deps,
    });
  }

  async fallback(
    p: this['In'] | this['InError'] | this['InBatchError'],
    err: Error | AggregateError,
  ): Promise<this['Out']> {
    const { session } = p.context;
    const onError = session.agentLoopConfig?.onError ?? 'retry';
    const errMsg = err instanceof AggregateError ? err.errors.map((e: Error) => e.message).join('; ') : err.message;
    console.warn(`[ToolCalls.fallback] ${errMsg}, strategy: ${onError}`);
    if (onError === 'retry') {
      await session.addMessages([
        { message: new UserMessage(`Tool error: ${errMsg}. Please try a different approach.`).toJSON() },
      ]);
      return packet({ data: session, context: p.context, deps: p.deps });
    }
    return packet({ data: errMsg, branch: 'ask_user', context: p.context, deps: p.deps });
  }
}

// ─── SubmitAnswer ─────────────────────────────────────────────────────────

/**
 * SubmitAnswer: Mark session as completed. The LLM already called the tool in DecideAction.
 */
export class SubmitAnswer extends Node<App, AgenticLoopContext, string, { default: string; error: Error }> {
  async run(p: this['In']): Promise<this['Out']> {
    const { session } = p.context;

    console.log(`[SubmitAnswer.run] Marking session '${session.id}' as completed`);
    await session.complete();

    return exit({
      data: p.data,
      context: p.context,
      deps: p.deps,
    });
  }

  async fallback(p: this['In'] | this['InError'], err: Error): Promise<this['Out']> {
    console.error(`[SubmitAnswer.fallback] session.complete() failed: ${err.message}`);
    await p.context.session.fail().catch(() => {});
    return error({ data: err, context: p.context, deps: p.deps });
  }
}

// ─── BestAnswer ───────────────────────────────────────────────────────────

/**
 * BestAnswer: Called when maxLoopEntering is exceeded and loopExit is 'bestAnswer'.
 * Makes one final LLM call with only the submit_answer tool, forced required.
 * Input is the loop-exceeded error, outputs the best answer or throws.
 */
export class BestAnswer extends Node<App, AgenticLoopContext, Error, { default: string }> {
  async run(p: this['In']): Promise<this['Out']> {
    const { session, user } = p.context;
    const conversation = session.activeMessages.map((m) => m.message);
    const submitSchema = session.toolSchemas.find((t) => t.name === 'submit_answer')!;
    const tools: OpenAI.ChatCompletionTool[] = [
      {
        type: 'function',
        function: {
          name: submitSchema.name,
          description: submitSchema.description,
          parameters: submitSchema.parameters,
        },
      },
    ];
    const messages = [
      new SystemMessage(session.systemPrompt).toJSON(),
      ...conversation,
      new UserMessage(
        'You have exceeded your iteration limit. Provide the best answer you can right now using all information you have gathered so far. Call submit_answer with your answer.',
      ).toJSON(),
    ];
    console.log(`[BestAnswer.run] Calling LLM with submit_answer only, toolChoice: required`);
    const response = await callLlmWithTools(messages, tools, { ...session.callLlmOptions, toolChoice: 'required' });
    const assistantMsg = AssistantMessage.from(response[0].message);
    await session.addMessages([{ message: assistantMsg.toJSON() }]);
    if (!('toolCalls' in assistantMsg) || !assistantMsg.toolCalls) {
      throw new Error('BestAnswer: LLM did not call submit_answer despite toolChoice: required');
    }
    const submitCall = assistantMsg.toolCalls.find((tc: LLMToolCall) => tc.name === 'submit_answer');
    if (!submitCall) {
      throw new Error('BestAnswer: submit_answer tool not called');
    }
    const answer = submitCall.args.answer as string;
    await session.respond(user, answer);
    await session.complete();
    return exit({ data: answer, context: p.context, deps: p.deps });
  }
}
