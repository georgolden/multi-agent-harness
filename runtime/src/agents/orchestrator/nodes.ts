/**
 * Nodes for the orchestrator flow.
 *
 * Flow graph:
 *   PrepareInput → DecideAction ─┬─ tool_calls    → ToolCalls     ─┐
 *                                │                                   └→ DecideAction (loop)
 *                                ├─ ask_user      → AskUser (pause)
 *                                │                      └→ UserResponse → DecideAction
 *                                └─ submit_result → SubmitResult (exit)
 *
 * Tools are registered on the session via session.addAgentTools(AGENT_TOOLS).
 * ToolCalls looks them up with session.getAgentTool(name) and calls tool.execute().
 * write_temp_file, runAgent, spawnAgent are all handled through this path.
 * ask_user is triggered by a plain text LLM response (assistant message), not a tool call.
 * submit_result gets a dedicated branch for flow control (exit).
 */
import { Node, packet, exit, pause, batch, type SinglePacket, type BatchPacket } from '../../utils/agent/flow.js';
import { callLlmWithTools } from '../../utils/callLlm.js';
import { TOOL_SCHEMAS } from './tools.js';
import { AssistantMessage, SystemMessage, ToolResultMessage, UserMessage } from '../../utils/message.js';
import type { OrchestratorContext, OrchestratorInput } from './types.js';
import type { App } from '../../app.js';
import { Session } from '../../services/sessionService/session.js';
import type { LLMToolCall } from '../../utils/message.js';

// ─── PrepareInput ────────────────────────────────────────────────────────────

export class PrepareInput extends Node<App, OrchestratorContext, OrchestratorInput, { default: Session }> {
  async run(p: this['In']): Promise<this['Out']> {
    const { session } = p.context;
    console.log(`[orchestrator.PrepareInput] Using session '${session.id}'`);
    return packet({ data: session, context: p.context, deps: p.deps });
  }
}

// ─── DecideAction ─────────────────────────────────────────────────────────────

/**
 * DecideAction: call the LLM and route based on its chosen tool.
 *
 * Routes:
 *   'tool_calls'    — write_temp_file / runAgent / spawnAgent; execute via ToolCalls, loop back
 *   'ask_user'      — pause and wait for user reply
 *   'submit_result' — orchestration complete, exit
 */
export class DecideAction extends Node<
  App,
  OrchestratorContext,
  Session,
  {
    tool_calls: LLMToolCall[];
    ask_user: string;
    submit_result: LLMToolCall;
  }
> {
  constructor() {
    super({ maxRunTries: 3, wait: 1000 });
  }

  async run(p: this['In']): Promise<this['Out']> {
    const session = p.data;
    const messages = session.activeMessages.map((msg) => msg.message);

    console.log(`[orchestrator.DecideAction] Session '${session.id}', ${messages.length} messages`);

    const response = await callLlmWithTools([new SystemMessage(session.systemPrompt).toJSON(), ...messages], TOOL_SCHEMAS);

    const assistantMsg = AssistantMessage.from(response[0].message);
    await session.addMessages([{ message: assistantMsg.toJSON() }]);

    if ('toolCalls' in assistantMsg && assistantMsg.toolCalls && assistantMsg.toolCalls.length > 0) {
      // submit_result — exits the flow
      const submitCall = assistantMsg.toolCalls.find((tc) => tc.name === 'submit_result');
      if (submitCall) {
        console.log(`[orchestrator.DecideAction] Routing to 'submit_result'`);
        return packet({ data: submitCall, context: p.context, branch: 'submit_result', deps: p.deps });
      }

      // Everything else (write_temp_file, runAgent, spawnAgent) — execute via ToolCalls
      console.log(`[orchestrator.DecideAction] Routing ${assistantMsg.toolCalls.length} tool call(s) to 'tool_calls'`);
      return packet({ data: assistantMsg.toolCalls, context: p.context, branch: 'tool_calls', deps: p.deps });
    }

    // Plain text — question or message for the user
    const text = assistantMsg.toJSON().content || '';
    console.log(`[orchestrator.DecideAction] Text response, routing to ask_user`);
    return packet({ data: text, context: p.context, branch: 'ask_user', deps: p.deps });
  }
}

// ─── ToolCalls ────────────────────────────────────────────────────────────────

type ToolCallResult = {
  toolCallId: string;
  content: string;
};

/**
 * ToolCalls: execute tool calls in parallel via session.getAgentTool(name).
 * Handles write_temp_file, runAgent, spawnAgent — all registered on the session.
 * Feeds all results back into the conversation and loops to DecideAction.
 */
export class ToolCalls extends Node<App, OrchestratorContext, LLMToolCall[], { default: Session }> {
  async preprocess(p: this['In']): Promise<BatchPacket<LLMToolCall, App, OrchestratorContext>> {
    const toolCalls = p.data;
    if (!toolCalls || !Array.isArray(toolCalls)) throw new Error('toolCalls is required');
    console.log(`[orchestrator.ToolCalls] Processing ${toolCalls.length} tool call(s)`);
    return batch({ data: toolCalls, context: p.context, deps: p.deps });
  }

  async run(
    p: SinglePacket<LLMToolCall, App, OrchestratorContext>,
  ): Promise<SinglePacket<ToolCallResult, App, OrchestratorContext>> {
    const { name, id, args } = p.data;
    const { session } = p.context;

    const tool = session.getAgentTool(name);
    if (!tool) {
      console.warn(`[orchestrator.ToolCalls] Tool '${name}' not found on session`);
      return packet({
        data: { toolCallId: id, content: `Tool '${name}' not found` },
        context: p.context,
        deps: p.deps,
      });
    }

    console.log(`[orchestrator.ToolCalls] Executing tool '${name}'`);
    const result = await tool.execute(p.deps, p.context, args, { toolCallId: id });
    const raw = result.data.content;
    const content: string = typeof raw === 'string' ? raw : JSON.stringify(raw);

    console.log(`[orchestrator.ToolCalls] Tool '${name}' returned ${content.length} chars`);
    return packet({ data: { toolCallId: id, content }, context: p.context, deps: p.deps });
  }

  async postprocess(p: BatchPacket<ToolCallResult, App, OrchestratorContext>): Promise<this['Out']> {
    const { session } = p.context;
    console.log(`[orchestrator.ToolCalls] Adding ${p.data.length} tool result(s) to session`);
    await session.addMessages(
      p.data.map((r) => ({
        message: new ToolResultMessage({ toolCallId: r.toolCallId, content: r.content }).toJSON(),
      })),
    );
    return packet({ data: session, context: p.context, deps: p.deps });
  }
}

// ─── AskUser ──────────────────────────────────────────────────────────────────

export class AskUser extends Node<App, OrchestratorContext, string, { default: void }> {
  async run(p: this['In']): Promise<this['Out']> {
    const { session, user } = p.context;
    const message = p.data;

    console.log(`[orchestrator.AskUser] Asking user: "${message.substring(0, 60)}"`);
    await session.respond(user, message);

    session.onUserMessage(({ message }: { message: string }) => {
      this.resume({ data: message, context: p.context, deps: p.deps });
    });

    await session.pause();
    return pause({ data: undefined, context: p.context, deps: p.deps });
  }
}

// ─── UserResponse ─────────────────────────────────────────────────────────────

export class UserResponse extends Node<App, OrchestratorContext, string, { default: Session }> {
  async run(p: this['In']): Promise<this['Out']> {
    const session = p.context.session;
    const message = p.data;

    await session.addUserMessage(new UserMessage(message));
    await session.resume();

    return packet({ data: session, context: p.context, deps: p.deps });
  }
}

// ─── SubmitResult ─────────────────────────────────────────────────────────────

export class SubmitResult extends Node<App, OrchestratorContext, LLMToolCall, { default: string }> {
  async run(p: this['In']): Promise<this['Out']> {
    const { session } = p.context;
    const result = p.data.args as { summary: string; dispatched: unknown[]; assumptions?: string[] };

    console.log(`[orchestrator.SubmitResult] Session '${session.id}' completed`);
    await session.complete();

    return exit({ data: JSON.stringify(result), context: p.context, deps: p.deps });
  }
}
