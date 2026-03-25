/**
 * Nodes for the fillTemplate flow.
 *
 * Flow graph:
 *   PrepareInput → DecideAction ─┬─ write_temp_file → WriteTempFile → DecideAction (loop)
 *                                ├─ ask_user        → AskUser        (pause; session stays running)
 *                                └─ submit_template → SubmitTemplate (exit; session completed)
 *
 * The LLM is instructed to call write_temp_file after every partial update,
 * keeping the best current version of the template saved before asking the user.
 */
import { Node, packet, exit, pause } from '../../utils/agent/flow.js';
import { callLlmWithTools } from '../../utils/callLlm.js';
import { TOOLS } from './tools.js';
import { AssistantMessage, SystemMessage, ToolResultMessage, UserMessage } from '../../utils/message.js';
import type { FillTemplateContext, FillTemplateInput } from './types.js';
import type { App } from '../../app.js';
import { Session } from '../../services/sessionService/session.js';
import type { LLMToolCall } from '../../utils/message.js';

// ─── PrepareInput ────────────────────────────────────────────────────────────

/**
 * PrepareInput: validate session is present in context (session is created before flow runs)
 */
export class PrepareInput extends Node<App, FillTemplateContext, FillTemplateInput, { default: Session }> {
  async run(p: this['In']): Promise<this['Out']> {
    const { session } = p.context;
    console.log(`[PrepareInput.run] Using session '${session.id}'`);
    return packet({
      data: session,
      context: p.context,
      deps: p.deps,
    });
  }
}

// ─── DecideAction ─────────────────────────────────────────────────────────────

/**
 * DecideAction: LLM decides what to do next.
 *
 * Routes:
 *   'write_temp_file' — LLM is saving current template progress (loops back via WriteTempFile)
 *   'ask_user'        — LLM replied with a question for the user
 *   'submit_template' — LLM is done and submits the final template
 */
export class DecideAction extends Node<
  App,
  FillTemplateContext,
  Session,
  { write_temp_file: LLMToolCall; ask_user: string; submit_template: string }
> {
  constructor() {
    super({ maxRunTries: 3, wait: 1000 });
  }

  async run(p: this['In']): Promise<this['Out']> {
    const session = p.data;

    const messages = session.activeMessages.map((msg) => msg.message);
    const systemPrompt = session.systemPrompt;

    console.log(`[DecideAction.run] Session '${session.id}', ${messages.length} messages`);

    const response = await callLlmWithTools([new SystemMessage(systemPrompt).toJSON(), ...messages], TOOLS);

    const assistantMsg = AssistantMessage.from(response[0].message);
    await session.addMessages([{ message: assistantMsg.toJSON() }]);

    if ('toolCalls' in assistantMsg && assistantMsg.toolCalls && assistantMsg.toolCalls.length > 0) {
      const toolCall = assistantMsg.toolCalls[0];

      if (toolCall.name === 'write_temp_file') {
        console.log(`[DecideAction.run] write_temp_file called, routing to WriteTempFile`);
        return packet({
          data: toolCall,
          context: p.context,
          branch: 'write_temp_file',
          deps: p.deps,
        });
      }

      if (toolCall.name === 'submit_template') {
        console.log(`[DecideAction.run] submit_template called, routing to SubmitTemplate`);
        return packet({
          data: toolCall.args.filled_template as string,
          context: p.context,
          branch: 'submit_template',
          deps: p.deps,
        });
      }
    }

    // Plain text response — ask user
    const text = assistantMsg.toJSON().content || '';
    console.log(`[DecideAction.run] Text response, routing to ask_user`);
    return packet({
      data: text,
      context: p.context,
      branch: 'ask_user',
      deps: p.deps,
    });
  }
}

// ─── WriteTempFile ─────────────────────────────────────────────────────────────

/**
 * WriteTempFile: Persist the current best version of the filled template to the session's
 * temp files, then add the tool result to the conversation and loop back to DecideAction.
 */
export class WriteTempFile extends Node<App, FillTemplateContext, LLMToolCall, { default: Session }> {
  async run(p: this['In']): Promise<this['Out']> {
    const session = p.context.session;
    const toolCall = p.data;
    const { name, content } = toolCall.args as { name: string; content: string };

    console.log(
      `[WriteTempFile.run] Writing temp file '${name}' (${content.length} chars) for session '${session.id}'`,
    );

    await session.writeTempFile({ name, content });

    // Feed the tool result back so the LLM knows the write succeeded
    await session.addMessages([
      {
        message: new ToolResultMessage({
          toolCallId: toolCall.id,
          content: JSON.stringify({ success: true, name, contentLength: content.length }),
        }).toJSON(),
      },
    ]);

    return packet({
      data: session,
      context: p.context,
      deps: p.deps,
    });
  }
}

// ─── AskUser ──────────────────────────────────────────────────────────────────

/**
 * AskUser: Send the question to the user and pause.
 * Session stays running until the user replies.
 */
export class AskUser extends Node<App, FillTemplateContext, string, { default: void }> {
  async run(p: this['In']): Promise<this['Out']> {
    const ctx = p.context;
    const session = ctx.session;
    const message = p.data;
    console.log(`[AskUser.run] Sending question to user, session '${session.id}'`);
    await session.respond(ctx.user, message);
    session.onUserMessage(({ message }: { message: string }) => {
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

// ─── UserResponse ─────────────────────────────────────────────────────────────

export class UserResponse extends Node<App, FillTemplateContext, string, { default: Session }> {
  async run(p: this['In']): Promise<this['Out']> {
    const session = p.context.session;
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

// ─── SubmitTemplate ───────────────────────────────────────────────────────────

/**
 * SubmitTemplate: Mark session as completed and exit with the final filled template.
 * If the LLM submitted without a prior write_temp_file, we still persist it now.
 */
export class SubmitTemplate extends Node<App, FillTemplateContext, string, { default: string }> {
  async run(p: this['In']): Promise<this['Out']> {
    const { session } = p.context;
    const filledTemplate = p.data;

    // Ensure the final version is always persisted in temp files
    await session.writeTempFile({ name: 'filled_template.md', content: filledTemplate });

    console.log(`[SubmitTemplate.run] Marking session '${session.id}' as completed`);
    await session.complete();

    return exit({
      data: filledTemplate,
      context: p.context,
      deps: p.deps,
    });
  }
}
