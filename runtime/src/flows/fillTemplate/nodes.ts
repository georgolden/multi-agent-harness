/**
 * PocketFlow nodes for the fillTemplate flow.
 *
 * Flow graph (reverse of taskScheduler):
 *   PrepareInput → DecideAction ─┬─ ask_user      → AskUser        (ends run; session stays running)
 *                                └─ submit_template → SubmitTemplate (ends run; session completed)
 *
 * Each user reply re-enters the flow via PrepareInput with the existing sessionId,
 * which resumes the conversation and feeds DecideAction again.
 */
import { Node } from 'pocketflow';
import type {
  SharedStore,
  ChatCompletionMessage,
  ChatCompletionMessageParam,
  ChatCompletionMessageFunctionToolCall,
} from '../../types.js';

import { callLlmWithTools } from '../../utils/callLlm.js';
import { createSystemPrompt } from './prompts/index.js';
import { TOOLS } from './tools.js';
import type { FillTemplateContext, AskUserContext, SubmitTemplateContext } from './types.js';
import type { Session } from '../../services/sessionService/index.js';

// ─── PrepareInput ────────────────────────────────────────────────────────────

type PrepareInputPrepResult = Session;
type PrepareInputExecResult = 'done';

/**
 * PrepareInput: resume an existing session (when sessionId is provided) or
 * create a new one (when starting fresh with a template).
 */
export class PrepareInput extends Node<SharedStore<FillTemplateContext>> {
  async prep(shared: SharedStore<FillTemplateContext>): Promise<PrepareInputPrepResult> {
    const { userId, message, template, sessionId } = shared.context;
    const { sessionService } = shared.app.services;

    // ── Resume existing session ──────────────────────────────────────────────
    if (sessionId) {
      const session = await sessionService.get(sessionId);
      if (!session) throw new Error(`Session '${sessionId}' not found`);

      const userMessage: ChatCompletionMessageParam = { role: 'user', content: message };
      await session.addMessages([{ message: userMessage }]);

      console.log(`[PrepareInput.prep] Resumed session '${session.id}' with new user message`);
      return session;
    }

    // ── Create new session ───────────────────────────────────────────────────
    if (!template) throw new Error('template is required when starting a new session');

    const timezone = await shared.app.data.taskRepository.getUserTimezone(userId);
    const currentDate = new Date().toISOString();
    const systemPrompt = createSystemPrompt(currentDate, timezone, template);

    const session = await sessionService.create({
      userId,
      flowName: 'fillTemplate',
      systemPrompt,
    });

    const userMessage: ChatCompletionMessageParam = { role: 'user', content: message };
    await session.addMessages([{ message: userMessage }]);

    console.log(`[PrepareInput.prep] Created session '${session.id}' for fillTemplate`);
    return session;
  }

  async exec(_prepRes: PrepareInputPrepResult): Promise<PrepareInputExecResult> {
    return 'done';
  }

  async post(
    shared: SharedStore<FillTemplateContext>,
    prepRes: PrepareInputPrepResult,
    _execRes: PrepareInputExecResult,
  ) {
    shared.context.session = prepRes;
    return undefined;
  }
}

// ─── DecideAction ─────────────────────────────────────────────────────────────

type DecideActionPrepResult = {
  sessionId: string;
  systemPrompt: string;
  conversation: ChatCompletionMessageParam[];
};
type DecideActionExecResult = ChatCompletionMessage;

/**
 * DecideAction: LLM decides whether to ask the user another question or to
 * submit the completed template via the submit_template tool.
 *
 * Routes:
 *   'ask_user'       — LLM replied with text (question for the user)
 *   'submit_template' — LLM called submit_template tool (template is ready)
 */
export class DecideAction extends Node<SharedStore<FillTemplateContext>> {
  constructor() {
    super(3, 1); // maxRetries: 3, wait: 1s
  }

  async prep(shared: SharedStore<FillTemplateContext>): Promise<DecideActionPrepResult> {
    const { session } = shared.context;
    if (!session) throw new Error('Session is required');

    const conversation = session.activeMessages.map((msg) => msg.message);
    console.log(`[DecideAction.prep] Session '${session.id}' with ${conversation.length} messages`);

    return {
      sessionId: session.id,
      systemPrompt: session.systemPrompt,
      conversation,
    };
  }

  async exec(prepRes: DecideActionPrepResult): Promise<DecideActionExecResult> {
    const { systemPrompt, conversation } = prepRes;
    const messages: ChatCompletionMessageParam[] = [{ role: 'system', content: systemPrompt }, ...conversation];

    console.log(`[DecideAction.exec] Calling LLM with ${messages.length} messages`);
    const response = await callLlmWithTools(messages, TOOLS);
    console.log(`[DecideAction.exec] LLM response:`, JSON.stringify(response[0].message, null, 2));

    return response[0].message;
  }

  async post(
    shared: SharedStore<FillTemplateContext>,
    _prepRes: DecideActionPrepResult,
    execRes: DecideActionExecResult,
  ) {
    const { session } = shared.context;
    if (!session) throw new Error('Session is required');

    await session.addMessages([{ message: execRes }]);

    const toolCalls = execRes.tool_calls as ChatCompletionMessageFunctionToolCall[];

    if (toolCalls && toolCalls.length > 0) {
      // submit_template called — exit via SubmitTemplate
      console.log(`[DecideAction.post] submit_template tool call detected`);
      shared.context.toolCalls = toolCalls;
      return 'submit_template';
    }

    // No tool call — LLM is asking the user something
    const { content, refusal } = execRes;
    let output = '';
    if (content) output = `${output}${content}`;
    if (refusal) output = `${output}\n${refusal}`;
    if (!output) output = 'AI is broken try again later';

    console.log(`[DecideAction.post] Asking user: "${output}"`);
    shared.context.response = output;
    return 'ask_user';
  }

  async execFallback(_prepRes: DecideActionPrepResult, error: Error): Promise<DecideActionExecResult> {
    console.error('[DecideAction.error]', error);
    return { role: 'assistant', content: 'AI is broken try again later', refusal: null };
  }
}

// ─── AskUser ──────────────────────────────────────────────────────────────────

type AskUserPrepResult = { output: string; userId: string; session: Session };
type AskUserExecResult = 'sent';

/**
 * AskUser: send the LLM's question to the user.
 *
 * The session stays 'running' — no status change.
 * The sessionId is included in the event so the caller can resume the session
 * when the user replies.
 */
export class AskUser extends Node<SharedStore<AskUserContext>> {
  async prep(shared: SharedStore<AskUserContext>): Promise<AskUserPrepResult> {
    const { response, userId, session } = shared.context;
    if (!session) throw new Error('Session is required');
    return { output: response, userId, session };
  }

  async exec({ output, userId, session }: AskUserPrepResult): Promise<AskUserExecResult> {
    console.log(`[AskUser.exec] Asking user ${userId} (session: ${session.id}): "${output}"`);
    await session.respond(output);
    return 'sent';
  }

  async post(_shared: SharedStore<AskUserContext>, _prepRes: AskUserPrepResult, _execRes: AskUserExecResult) {
    // Session intentionally stays 'running' — the conversation continues
    // when the user replies with the sessionId.
    return undefined;
  }
}

// ─── SubmitTemplate ───────────────────────────────────────────────────────────

type SubmitTemplatePrepResult = { filledTemplate: string; toolCallId: string };
type SubmitTemplateExecResult = 'done';

/**
 * SubmitTemplate: extract the filled template from the tool call arguments,
 * emit it via the bus, and mark the session as completed.
 */
export class SubmitTemplate extends Node<SharedStore<SubmitTemplateContext>> {
  async prep(shared: SharedStore<SubmitTemplateContext>): Promise<SubmitTemplatePrepResult> {
    const { toolCalls } = shared.context;
    if (!toolCalls || toolCalls.length === 0) throw new Error('No tool calls found');

    const submitCall = toolCalls[0];
    const args = JSON.parse(submitCall.function.arguments);

    return { filledTemplate: args.filled_template, toolCallId: submitCall.id };
  }

  async exec(_prepRes: SubmitTemplatePrepResult): Promise<SubmitTemplateExecResult> {
    return 'done';
  }

  async post(
    shared: SharedStore<SubmitTemplateContext>,
    prepRes: SubmitTemplatePrepResult,
    _execRes: SubmitTemplateExecResult,
  ) {
    const { session } = shared.context;
    if (!session) throw new Error('Session is required');

    const { filledTemplate, toolCallId } = prepRes;

    // Acknowledge the tool call in the session history
    const toolResult: ChatCompletionMessageParam = {
      role: 'tool',
      content: JSON.stringify({ status: 'submitted' }),
      tool_call_id: toolCallId,
    };
    await session.addMessages([{ message: toolResult }]);

    // Emit filled template result
    await session.respond(filledTemplate);

    // Mark session completed
    await session.complete();
    console.log(`[SubmitTemplate.post] Template submitted and session '${session.id}' completed`);

    return undefined;
  }
}
