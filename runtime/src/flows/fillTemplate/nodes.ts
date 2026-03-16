/**
 * New flow nodes for the fillTemplate flow.
 *
 * Flow graph:
 *   PrepareInput → DecideAction ─┬─ ask_user      → AskUser        (ends run; session stays running)
 *                                └─ submit_template → SubmitTemplate (ends run; session completed)
 *
 * Each user reply re-enters the flow via PrepareInput with the existing sessionId,
 * which resumes the conversation and feeds DecideAction again.
 */
import { Node, packet, exit, pause } from '../../utils/agent/flow.js';
import { callLlmWithTools } from '../../utils/callLlm.js';
import { TOOLS } from './tools.js';
import { AssistantMessage, SystemMessage, UserMessage } from '../../utils/message.js';
import type { FillTemplateContext, FillTemplateInput } from './types.js';
import type { App } from '../../app.js';
import { Session } from '../../services/sessionService/session.js';

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
 * DecideAction: LLM decides whether to ask the user another question or to
 * submit the completed template via the submit_template tool.
 *
 * Routes:
 *   'ask_user'       — LLM replied with text (question for the user)
 *   'submit_template' — LLM called submit_template tool (template is ready)
 */
export class DecideAction extends Node<
  App,
  FillTemplateContext,
  Session,
  { ask_user: string; submit_template: string }
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
      console.log(`[DecideAction.run] Tool calls detected, routing to submit_template`);
      return packet({
        data: assistantMsg.toolCalls[0].args.filled_template as string,
        context: p.context,
        branch: 'submit_template',
        deps: p.deps,
      });
    }

    // Text response — ask user
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

// ─── AskUser ──────────────────────────────────────────────────────────────────

/**
 * AskUser: Send the question to the user and keep session running.
 * Does NOT mark session as completed — that happens when SubmitTemplate is reached.
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
 * SubmitTemplate: Mark session as completed. The LLM already called the tool in DecideAction.
 */
export class SubmitTemplate extends Node<App, FillTemplateContext, string, { default: string }> {
  async run(p: this['In']): Promise<this['Out']> {
    const { session } = p.context;

    console.log(`[SubmitTemplate.run] Marking session '${session.id}' as completed`);
    await session.complete();

    return exit({
      data: p.data,
      context: p.context,
      deps: p.deps,
    });
  }
}
