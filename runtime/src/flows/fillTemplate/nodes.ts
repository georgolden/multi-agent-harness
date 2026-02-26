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
import { Node, packet, exit } from '../../utils/agent/flow.js';
import { callLlmWithTools } from '../../utils/callLlm.js';
import { createSystemPrompt } from './prompts/index.js';
import { TOOLS } from './tools.js';
import {
  UserMessage,
  AssistantMessage,
} from '../../utils/message.js';
import type { FillTemplateContext, AskUserContext } from './types.js';
import type { App } from '../../app.js';

// ─── PrepareInput ────────────────────────────────────────────────────────────

/**
 * PrepareInput: resume an existing session (when sessionId is provided) or
 * create a new one (when starting fresh with a template).
 */
export class PrepareInput extends Node<{ app: App }, FillTemplateContext, any, { default: void }> {
  async run(p: this['In']): Promise<this['Out']> {
    const { userId, message, template, sessionId } = p.context!;
    const { app } = p.deps!;
    const { sessionService } = app.services;

    // ── Resume existing session ──────────────────────────────────────────────
    if (sessionId) {
      const session = await sessionService.get(sessionId);
      if (!session) throw new Error(`Session '${sessionId}' not found`);

      await session.addMessages([{ message: new UserMessage(message).toJSON() }]);

      console.log(`[PrepareInput.prep] Resumed session '${session.id}' with new user message`);
      return packet({ context: { ...p.context!, session }, deps: p.deps });
    }

    // ── Create new session ───────────────────────────────────────────────────
    if (!template) throw new Error('template is required when starting a new session');

    const timezone = await app.data.taskRepository.getUserTimezone(userId);
    const currentDate = new Date().toISOString();
    const systemPrompt = createSystemPrompt(currentDate, timezone, template);

    const session = await sessionService.create({
      userId,
      flowName: 'fillTemplate',
      systemPrompt,
    });

    await session.addMessages([{ message: new UserMessage(message).toJSON() }]);

    console.log(`[PrepareInput.prep] Created session '${session.id}' for fillTemplate`);
    return packet({ context: { ...p.context!, session }, deps: p.deps });
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
export class DecideAction extends Node<{ app: App }, FillTemplateContext, any, { ask_user: void; submit_template: void }> {
  constructor() {
    super({ maxRunTries: 3, wait: 1000 });
  }

  async run(p: this['In']): Promise<this['Out']> {
    const { session } = p.context!;
    if (!session) throw new Error('Session not initialized');

    const messages = session.activeMessages.map((msg) => msg.message) as any[];
    const systemPrompt = session.systemPrompt;

    console.log(`[DecideAction.run] Session '${session.id}', ${messages.length} messages`);

    const response = await callLlmWithTools(
      [{ role: 'system', content: systemPrompt }, ...messages],
      TOOLS,
    );

    const assistantMsg = AssistantMessage.from(response[0].message);
    await session.addMessages([{ message: assistantMsg.toJSON() }]);

    if ('toolCalls' in assistantMsg && assistantMsg.toolCalls && assistantMsg.toolCalls.length > 0) {
      console.log(`[DecideAction.run] Tool calls detected, routing to submit_template`);
      return packet({
        context: p.context,
        branch: 'submit_template',
        deps: p.deps,
      });
    }

    // Text response — ask user
    const text = (assistantMsg as any).text || '';
    console.log(`[DecideAction.run] Text response, routing to ask_user`);
    return packet({
      context: { ...p.context!, response: text },
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
export class AskUser extends Node<{ app: App }, AskUserContext, any, { default: void }> {
  async run(p: this['In']): Promise<this['Out']> {
    const ctx = p.context as any;
    const { session, response } = ctx;
    console.log(`[AskUser.run] Sending question to user, session '${session.id}'`);
    await session.respond(response);
    // Session stays 'running' — user will reply and re-enter the flow
    return packet({ context: p.context, deps: p.deps });
  }
}

// ─── SubmitTemplate ───────────────────────────────────────────────────────────

/**
 * SubmitTemplate: Mark session as completed. The LLM already called the tool in DecideAction.
 */
export class SubmitTemplate extends Node<{ app: App }, FillTemplateContext & { session: any }, any, { default: void }> {
  async run(p: this['In']): Promise<this['Out']> {
    const { session } = p.context! as any;

    console.log(`[SubmitTemplate.run] Marking session '${session.id}' as completed`);
    await session.complete();

    return exit({ context: p.context, deps: p.deps });
  }
}
