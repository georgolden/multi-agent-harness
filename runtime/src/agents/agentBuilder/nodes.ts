/**
 * Nodes for the agentBuilder flow.
 *
 * Flow graph:
 *   PrepareInput → DecideAction ─┬─ write_temp_file → WriteTempFile → DecideAction (loop)
 *                                ├─ ask_user        → AskUser        (pause; session stays running)
 *                                └─ submit_result   → SubmitAnswer   (exit; session completed)
 *
 * The LLM saves artifacts (schema, system prompt, templates, checklist) via write_temp_file
 * after every update, then continues the conversation. submit_result exits with the final schema.
 */
import { Node, packet, exit, pause } from '../../utils/agent/flow.js';
import { callLlmWithTools } from '../../utils/callLlm.js';
import { TOOLS } from './tools.js';
import { AssistantMessage, SystemMessage, ToolResultMessage, UserMessage } from '../../utils/message.js';
import type { AgentBuilderContext, AgentBuilderInput } from './types.js';
import type { App } from '../../app.js';
import type { AgenticLoopSchema } from '../agentictLoop/flow.js';

import type { LLMToolCall } from '../../utils/message.js';

// ─── PrepareInput ────────────────────────────────────────────────────────────

export class PrepareInput extends Node<App, AgentBuilderContext, AgentBuilderInput, { default: void }> {
  async run(p: this['In']): Promise<this['Out']> {
    const { session } = p.context;
    console.log(`[agentBuilder.PrepareInput] Using session '${session.id}'`);
    return packet({ data: undefined, context: p.context, deps: p.deps });
  }
}

// ─── DecideAction ─────────────────────────────────────────────────────────────

/**
 * DecideAction: call the LLM and route based on its response.
 *
 * Routes:
 *   'write_temp_file' — LLM is persisting an artifact; handle and loop back
 *   'ask_user'        — LLM has a question or message for the user
 *   'submit_result'   — LLM submits the completed schema; exit the flow
 */
export class DecideAction extends Node<
  App,
  AgentBuilderContext,
  void,
  { write_temp_file: LLMToolCall; ask_user: string; submit_result: string }
> {
  constructor() {
    super({ maxRunTries: 3, wait: 1000 });
  }

  async run(p: this['In']): Promise<this['Out']> {
    const session = p.context.session;
    const messages = session.activeMessages.map((msg) => msg.message);

    console.log(`[agentBuilder.DecideAction] Session '${session.id}', ${messages.length} messages`);

    const response = await callLlmWithTools(messages, TOOLS);

    const assistantMsg = AssistantMessage.from(response[0].message);
    await session.addMessages([{ message: assistantMsg.toJSON() }]);

    if ('toolCalls' in assistantMsg && assistantMsg.toolCalls && assistantMsg.toolCalls.length > 0) {
      const toolCalls = assistantMsg.toolCalls;
      const submitCall = toolCalls.find((tc) => tc.name === 'submit_result');
      const writeCall = toolCalls.find((tc) => tc.name === 'write_temp_file');

      // If submit_result was called, exit with submit_result branch
      if (submitCall) {
        return packet({
          data: submitCall.args.answer as string,
          context: p.context,
          branch: 'submit_result',
          deps: p.deps,
        });
      }

      // Route write_temp_file to WriteTempFile node
      if (writeCall) {
        return packet({ data: writeCall, context: p.context, branch: 'write_temp_file', deps: p.deps });
      }
    }

    // Plain text — question or message for the user
    const text = assistantMsg.toJSON().content || '';
    return packet({ data: text, context: p.context, branch: 'ask_user', deps: p.deps });
  }
}

// ─── WriteTempFile ─────────────────────────────────────────────────────────────

/**
 * WriteTempFile: persist the artifact the LLM just produced, ack the tool call,
 * then loop back to DecideAction so the LLM can continue the conversation.
 */
export class WriteTempFile extends Node<App, AgentBuilderContext, LLMToolCall, { default: void }> {
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

    return packet({ data: undefined, context: p.context, deps: p.deps });
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

export class UserResponse extends Node<App, AgentBuilderContext, string, { default: void }> {
  async run(p: this['In']): Promise<this['Out']> {
    const session = p.context.session;
    const message = p.data;
    await session.addUserMessage(new UserMessage(message));
    await session.resume();
    return packet({ data: undefined, context: p.context, deps: p.deps });
  }
}

// ─── SubmitAnswer ─────────────────────────────────────────────────────────────

/**
 * SubmitAnswer: the user has confirmed the schema — persist the final schema one last time,
 * mark the session complete, and exit with the schema string.
 */
export class SubmitAnswer extends Node<App, AgentBuilderContext, string, { default: string }> {
  async run(p: this['In']): Promise<this['Out']> {
    const { session, user } = p.context;
    const app = p.deps;
    const schemaRaw = p.data;

    await session.writeTempFile({ name: 'agent_schema.json', content: schemaRaw });

    let parsed: AgenticLoopSchema;
    try {
      parsed = JSON.parse(schemaRaw) as AgenticLoopSchema;
    } catch (e) {
      console.error(`[agentBuilder.SubmitAnswer] Failed to parse schema JSON: ${e}`);
      await session.complete();
      return exit({ data: schemaRaw, context: p.context, deps: p.deps });
    }

    try {
      await app.data.agenticLoopSchemaRepository.createSchema({ userId: user.id, schema: parsed });
      console.log(`[agentBuilder.SubmitAnswer] Schema '${parsed.flowName}' saved to DB`);
    } catch (e) {
      console.error(`[agentBuilder.SubmitAnswer] Failed to save schema to DB: ${e}`);
    }

    console.log(`[agentBuilder.SubmitAnswer] Session '${session.id}' completed`);
    await session.complete();

    return exit({ data: schemaRaw, context: p.context, deps: p.deps });
  }
}
