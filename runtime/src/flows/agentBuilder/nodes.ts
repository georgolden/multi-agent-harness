/**
 * Nodes for the agentBuilder flow.
 *
 * Flow graph:
 *   PrepareInput → DecideAction ─┬─ write_temp_file → WriteTempFile → DecideAction (loop)
 *                                ├─ ask_user        → AskUser        (pause; session stays running)
 *                                └─ submit_answer   → SubmitAnswer   (exit; session completed)
 *
 * The LLM saves artifacts (schema, system prompt, templates, checklist) via write_temp_file
 * after every update, then continues the conversation. submit_answer exits with the final schema.
 */
import { Node, packet, exit, pause } from '../../utils/agent/flow.js';
import { callLlmWithTools } from '../../utils/callLlm.js';
import { TOOLS } from './tools.js';
import { AssistantMessage, SystemMessage, ToolResultMessage, UserMessage } from '../../utils/message.js';
import type { AgentBuilderContext, AgentBuilderInput } from './types.js';
import type { App } from '../../app.js';
import { Session } from '../../services/sessionService/session.js';
import type { LLMToolCall } from '../../utils/message.js';

// ─── PrepareInput ────────────────────────────────────────────────────────────

export class PrepareInput extends Node<App, AgentBuilderContext, AgentBuilderInput, { default: Session }> {
  async run(p: this['In']): Promise<this['Out']> {
    const { session } = p.context;
    console.log(`[agentBuilder.PrepareInput] Using session '${session.id}'`);
    return packet({ data: session, context: p.context, deps: p.deps });
  }
}

// ─── DecideAction ─────────────────────────────────────────────────────────────

/**
 * DecideAction: call the LLM and route based on its response.
 *
 * Routes:
 *   'write_temp_file' — LLM is persisting an artifact; handle and loop back
 *   'ask_user'        — LLM has a question or message for the user
 *   'submit_answer'   — LLM submits the completed schema; exit the flow
 */
export class DecideAction extends Node<
  App,
  AgentBuilderContext,
  Session,
  { write_temp_file: LLMToolCall; ask_user: string; submit_answer: string }
> {
  constructor() {
    super({ maxRunTries: 3, wait: 1000 });
  }

  async run(p: this['In']): Promise<this['Out']> {
    const session = p.data;
    const messages = session.activeMessages.map((msg) => msg.message);
    const systemPrompt = session.systemPrompt;

    console.log(`[agentBuilder.DecideAction] Session '${session.id}', ${messages.length} messages`);

    const response = await callLlmWithTools([new SystemMessage(systemPrompt).toJSON(), ...messages], TOOLS);

    const assistantMsg = AssistantMessage.from(response[0].message);
    await session.addMessages([{ message: assistantMsg.toJSON() }]);

    if ('toolCalls' in assistantMsg && assistantMsg.toolCalls && assistantMsg.toolCalls.length > 0) {
      const toolCall = assistantMsg.toolCalls[0];

      if (toolCall.name === 'write_temp_file') {
        console.log(`[agentBuilder.DecideAction] write_temp_file called — '${(toolCall.args as any).name}'`);
        return packet({ data: toolCall, context: p.context, branch: 'write_temp_file', deps: p.deps });
      }

      if (toolCall.name === 'submit_answer') {
        console.log(`[agentBuilder.DecideAction] submit_answer called, exiting`);
        return packet({
          data: toolCall.args.answer as string,
          context: p.context,
          branch: 'submit_answer',
          deps: p.deps,
        });
      }
    }

    // Plain text — question or message for the user
    const text = assistantMsg.toJSON().content || '';
    console.log(`[agentBuilder.DecideAction] Text response, routing to ask_user`);
    return packet({ data: text, context: p.context, branch: 'ask_user', deps: p.deps });
  }
}

// ─── WriteTempFile ─────────────────────────────────────────────────────────────

/**
 * WriteTempFile: persist the artifact the LLM just produced, ack the tool call,
 * then loop back to DecideAction so the LLM can continue the conversation.
 */
export class WriteTempFile extends Node<App, AgentBuilderContext, LLMToolCall, { default: Session }> {
  async run(p: this['In']): Promise<this['Out']> {
    const session = p.context.session;
    const toolCall = p.data;
    const { name, content } = toolCall.args as { name: string; content: string };

    console.log(`[agentBuilder.WriteTempFile] Writing '${name}' (${content.length} chars) to session '${session.id}'`);

    await session.writeTempFile({ name, content });

    await session.addMessages([
      {
        message: new ToolResultMessage({
          toolCallId: toolCall.id,
          content: JSON.stringify({ success: true, name, contentLength: content.length }),
        }).toJSON(),
      },
    ]);

    return packet({ data: session, context: p.context, deps: p.deps });
  }
}

// ─── AskUser ──────────────────────────────────────────────────────────────────

/**
 * AskUser: deliver the LLM's message to the user and pause until they reply.
 */
export class AskUser extends Node<App, AgentBuilderContext, string, { default: void }> {
  async run(p: this['In']): Promise<this['Out']> {
    const { session, user } = p.context;
    const message = p.data;
    console.log(`[agentBuilder.AskUser] Sending message to user, session '${session.id}'`);
    await session.respond(user, message);
    session.onUserMessage(({ message }: { message: string }) => {
      this.resume({ data: message, context: p.context, deps: p.deps });
    });
    await session.pause();
    return pause({ data: undefined, context: p.context, deps: p.deps });
  }
}

// ─── UserResponse ─────────────────────────────────────────────────────────────

export class UserResponse extends Node<App, AgentBuilderContext, string, { default: Session }> {
  async run(p: this['In']): Promise<this['Out']> {
    const session = p.context.session;
    const message = p.data;
    await session.addUserMessage(new UserMessage(message));
    await session.resume();
    return packet({ data: session, context: p.context, deps: p.deps });
  }
}

// ─── SubmitAnswer ─────────────────────────────────────────────────────────────

/**
 * SubmitAnswer: the user has confirmed the schema — persist the final schema one last time,
 * mark the session complete, and exit with the schema string.
 */
export class SubmitAnswer extends Node<App, AgentBuilderContext, string, { default: string }> {
  async run(p: this['In']): Promise<this['Out']> {
    const { session } = p.context;
    const schema = p.data;

    // Ensure the very last version is always persisted
    await session.writeTempFile({ name: 'agent_schema.json', content: schema });

    console.log(`[agentBuilder.SubmitAnswer] Session '${session.id}' completed`);
    await session.complete();

    return exit({ data: schema, context: p.context, deps: p.deps });
  }
}
