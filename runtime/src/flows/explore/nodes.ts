/**
 * Nodes for the explore agent flow.
 * Borrows from agentic loop (session + context management),
 * task scheduler (ask_user + tool handling), and
 * fillTemplate (pause/resume user interaction).
 *
 * Flow graph:
 *   PrepareInput → DecideAction ─┬─ ask_user       → AskUser        (pause; session stays running)
 *                                ├─ tool_calls     → ToolCalls      (loops back to DecideAction)
 *                                └─ submit_result  → SubmitResult    (exit; session completed)
 */
import { Node, packet, batch, exit, pause, type SinglePacket, type BatchPacket } from '../../utils/agent/flow.js';
import { callLlmWithTools } from '../../utils/callLlm.js';
import { createSystemPrompt, wrapUserPrompt } from './prompts/index.js';
import { TOOLS, AGENT_TOOLS } from './tools.js';
import type { SubmitResult as SubmitResultArgs } from './tools.js';
import { FolderInfo } from '../../utils/folder.js';
import { FileInfo } from '../../utils/file.js';
import {
  SystemMessage,
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  type LLMToolCall,
} from '../../utils/message.js';
import type { ExploreContext, ExploreResult, Session } from './types.js';
import { App } from '../../app.js';

// ─── PrepareInput ────────────────────────────────────────────────────────────

/**
 * PrepareInput: Create session with system prompt and user message (runs once)
 */
export class PrepareInput extends Node<App, ExploreContext, string, { default: void }> {
  async run(p: this['In']): Promise<this['Out']> {
    const app = p.deps;
    const message = p.data;
    const { user, parent } = p.context;
    console.log(`[PrepareInput.run] Preparing context and creating flow session for user message: "${message}"`);

    const { services } = app;

    const systemPrompt = createSystemPrompt();
    const userPrompt = wrapUserPrompt(message);

    const session = await services.sessionService.create({
      parentSessionId: parent?.id,
      userId: user.id,
      flowName: 'explore',
      systemPrompt,
    });

    // Add explore-specific tools to the session
    session.addAgentTools(AGENT_TOOLS as any);

    await session.addMessages([
      { message: new SystemMessage(systemPrompt).toJSON() },
      { message: new UserMessage(userPrompt).toJSON() },
    ]);

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
 * DecideAction: LLM decides what action to take.
 * Routes to ask_user, tool_calls, or submit_result based on LLM response.
 * Plain text responses (unexpected) loop back with error message.
 */
export class DecideAction extends Node<
  App,
  ExploreContext,
  undefined,
  { ask_user: LLMToolCall; tool_calls: LLMToolCall[]; submit_result: SubmitResultArgs; loop: undefined }
> {
  constructor() {
    super({ maxRunTries: 3, wait: 1000 });
  }

  async run(p: this['In']): Promise<this['Out']> {
    const session = p.context.session;
    if (!session) throw new Error('Session not initialized');

    const messages = session.activeMessages.map((msg) => msg.message);

    console.log(`[DecideAction.run] Session '${session.id}', ${messages.length} messages`);

    const response = await callLlmWithTools([new SystemMessage(session.systemPrompt).toJSON(), ...messages], TOOLS);

    const assistantMsg = AssistantMessage.from(response[0].message);
    await session.addMessages([{ message: assistantMsg.toJSON() }]);

    console.log(`[DecideAction.run] LLM response:`, JSON.stringify(assistantMsg.toJSON(), null, 2));

    // Check for tool calls
    if ('toolCalls' in assistantMsg && assistantMsg.toolCalls && assistantMsg.toolCalls.length > 0) {
      // Check if submit_result is in the tool calls
      const submitResultCall = assistantMsg.toolCalls.find((tc) => tc.name === 'submit_result');
      if (submitResultCall) {
        console.log(`[DecideAction.run] submit_result tool call detected, routing to submit_result`);
        return packet({
          data: submitResultCall.args as SubmitResultArgs,
          context: p.context,
          branch: 'submit_result',
          deps: p.deps,
        });
      }

      // Check if ask_user is in the tool calls
      const askUserCall = assistantMsg.toolCalls.find((tc) => tc.name === 'ask_user');
      if (askUserCall) {
        console.log(`[DecideAction.run] ask_user tool call detected, routing to ask_user`);
        return packet({
          data: askUserCall,
          context: p.context,
          branch: 'ask_user',
          deps: p.deps,
        });
      }

      // Regular tool calls (read, tree, ls, etc.) — return for ToolCalls to process
      console.log(`[DecideAction.run] ${assistantMsg.toolCalls.length} tool calls, routing to tool_calls`);
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
}

// ─── AskUser ──────────────────────────────────────────────────────────────────

/**
 * AskUser: Handle ask_user tool call, send question to user, and pause.
 * Session stays running. Resumes when user provides response.
 */
export class AskUser extends Node<
  App,
  ExploreContext,
  LLMToolCall,
  { pause: { toolCallId: string; message: string } }
> {
  async run(p: this['In']): Promise<this['Out']> {
    const session = p.context.session!;
    const toolCall = p.data;
    const { question, options } = toolCall.args as { question: string; options?: string[] };

    const message = `${question}${options ? '\n\nOptions:\n' + options.map((opt, i) => `${i + 1}. ${opt}`).join('\n') : ''}`;

    console.log(`[AskUser.run] Sending question to user, session '${session.id}'`);
    await session.respond(message);
    session.onUserMessage(({ sessionId, message: userMsg }: { sessionId: string; message: string }) => {
      if (sessionId !== session.id) return;
      this.resume({ data: { toolCallId: toolCall.id, message: userMsg }, context: p.context, deps: p.deps });
    });
    await session.pause();
    return pause({
      data: undefined,
      context: p.context,
      deps: p.deps,
    });
  }
}

/**
 * UserResponse: Add user response as ToolResultMessage and loop back to DecideAction.
 */
export class UserResponse extends Node<
  App,
  ExploreContext,
  { toolCallId: string; message: string },
  { default: Session }
> {
  async run(p: this['In']): Promise<this['Out']> {
    const session = p.context.session!;
    const { toolCallId, message } = p.data;

    await session.addMessages([
      { message: new ToolResultMessage({ toolCallId, content: message }).toJSON() },
    ]);
    await session.resume();

    return packet({
      data: session,
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
  args: Record<string, unknown>;
};

/**
 * ToolCalls: Execute tool calls in parallel and process results.
 * Loops back to DecideAction after processing.
 */
export class ToolCalls extends Node<App, ExploreContext, LLMToolCall[], { default: undefined }> {
  async preprocess(p: this['In']): Promise<BatchPacket<LLMToolCall, App, ExploreContext>> {
    const toolCalls = p.data;
    if (!toolCalls) throw new Error('toolCalls is required');
    console.log(`[ToolCalls.preprocess] Processing ${toolCalls.length} tool calls`);
    return batch({
      data: toolCalls,
      context: p.context,
      deps: p.deps,
    });
  }

  async run(p: SinglePacket<LLMToolCall, App, ExploreContext>): Promise<SinglePacket<ToolCallResult, App, ExploreContext>> {
    const toolCall = p.data;
    const app = p.deps;
    const session = p.context.session!;

    const { name, id, args } = toolCall;

    const tool = session.getAgentTool(name);
    if (!tool) {
      console.warn(`[ToolCalls.run] Tool '${name}' not found`);
      return packet({
        data: { toolCallId: id, name, content: `Tool '${name}' not found`, args } as ToolCallResult,
        context: p.context,
        deps: p.deps,
      });
    }

    console.log(`[ToolCalls.run] Executing tool '${name}'`);
    const { content } = await tool.execute(app, args, { toolCallId: id });
    const output = (content as { text: string }[])[0]?.text || JSON.stringify(content);

    return packet({
      data: { toolCallId: id, name, content: output, args } as ToolCallResult,
      context: p.context,
      deps: p.deps,
    });
  }

  async postprocess(p: BatchPacket<ToolCallResult, App, ExploreContext>): Promise<this['Out']> {
    const results = p.data;
    const session = p.context.session!;

    console.log(`[ToolCalls.postprocess] Adding ${results.length} tool results to session`);

    const toolMessages = results.map((result) => ({
      message: new ToolResultMessage({ toolCallId: result.toolCallId, content: result.content }).toJSON(),
    }));

    // Track context files and folders for later use
    for (const result of results) {
      if (result.name === 'read') {
        await session.addContextFiles([
          { path: (result.args.path as string) || '', category: 'text', content: { encoding: 'utf-8', data: result.content } },
        ]);
      } else if (result.name === 'tree' || result.name === 'ls') {
        const folderPath = (result.args.path as string) || '.';
        await session.addContextFoldersInfos([{ path: folderPath, tree: result.content }]);
      }
    }

    await session.addMessages(toolMessages);

    return packet({
      data: undefined,
      context: p.context,
      deps: p.deps,
    });
  }
}

// ─── SubmitResult ─────────────────────────────────────────────────────────────

/**
 * SubmitResult: Process submit_result tool call and exit.
 * Marks session as completed.
 */
export class SubmitResult extends Node<App, ExploreContext, SubmitResultArgs, { default: ExploreResult }> {
  async run(p: this['In']): Promise<this['Out']> {
    const session = p.context.session!;
    const args = p.data;

    const contextFiles: FileInfo[] = [];
    const contextFoldersInfos: FolderInfo[] = [];

    // Gather referenced context files and folders
    for (const entry of args.context) {
      if (entry.type === 'file') {
        const file = session.contextFiles.find((f) => f.path === entry.path);
        if (file) contextFiles.push(file);
      } else if (entry.type === 'folder') {
        const folder = session.contextFoldersInfos.find((f) => f.path === entry.path);
        if (folder) contextFoldersInfos.push(folder);
      }
    }

    const result: ExploreResult = { args, contextFiles, contextFoldersInfos };

    console.log(`[SubmitResult.run] Marking session '${session.id}' as completed`);
    await session.complete();

    return exit({
      data: result,
      context: p.context,
      deps: p.deps,
    });
  }
}
