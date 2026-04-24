/**
 * Nodes for the explore agent flow.
 *
 * Flow graph:
 *   PrepareInput → DecideAction ─┬─ ask_user      → AskUser        (pause; session stays running)
 *                                ├─ tool_calls    → ToolCalls      (loops back to DecideAction)
 *                                └─ submit_result → SubmitResult    (exit; session completed)
 *
 * ask_user is triggered by a plain text LLM response (assistant message), not a tool call.
 */
import { Node, packet, batch, exit, pause, type SinglePacket, type BatchPacket } from '../../utils/agent/flow.js';
import { callLlmWithTools } from '../../utils/callLlm.js';
import { TOOLS } from './tools.js';
import type { SubmitResult as SubmitResultArgs } from './tools.js';
import { FolderInfo } from '../../utils/folder.js';
import { FileInfo } from '../../utils/file.js';
import {
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  type LLMToolCall,
} from '../../utils/message.js';
import type { ExploreContext, ExploreInput, ExploreResult } from './types.js';
import { App } from '../../app.js';
import { createSystemPrompt, wrapUserPrompt } from './prompts/index.js';

// ─── PrepareInput ────────────────────────────────────────────────────────────

export class PrepareInput extends Node<App, ExploreContext, ExploreInput | undefined, { default: void }> {
  async run(p: this['In']): Promise<this['Out']> {
    const { session } = p.context;

    const systemPrompt = createSystemPrompt();
    await session.upsertSystemPrompt(systemPrompt);

    const input = p.data;
    if (input?.message) {
      await session.addUserMessage(new UserMessage(wrapUserPrompt(input.message)));
    }

    console.log(`[explore.PrepareInput] session='${session.id}' firstEntry=${!!input?.message}`);
    return packet({ data: undefined, context: p.context, deps: p.deps });
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
  { ask_user: string; tool_calls: LLMToolCall[]; submit_result: SubmitResultArgs }
> {
  constructor() {
    super({ maxRunTries: 3, wait: 1000 });
  }

  async run(p: this['In']): Promise<this['Out']> {
    const session = p.context.session;

    const messages = session.activeMessages.map((msg) => msg.message);

    console.log(`[DecideAction.run] Session '${session.id}', ${messages.length} messages`);

    const response = await callLlmWithTools(messages, TOOLS);

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

      // Regular tool calls (read, tree, ls, etc.) — return for ToolCalls to process
      console.log(`[DecideAction.run] ${assistantMsg.toolCalls.length} tool calls, routing to tool_calls`);
      return packet({
        data: assistantMsg.toolCalls,
        context: p.context,
        branch: 'tool_calls',
        deps: p.deps,
      });
    }

    // Plain text response — question or message for the user
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
 * AskUser: Send the LLM's text message to the user and pause.
 * Session stays running. Resumes when user provides response.
 */
export class AskUser extends Node<App, ExploreContext, string, { default: void }> {
  async run(p: this['In']): Promise<this['Out']> {
    const session = p.context.session;
    const user = p.context.user;
    const message = p.data;

    console.log(`[AskUser.run] Sending question to user, session '${session.id}'`);
    await session.respond(user, message);
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

/**
 * UserResponse: Add user response as UserMessage and loop back to DecideAction.
 */
export class UserResponse extends Node<App, ExploreContext, string, { default: void }> {
  async run(p: this['In']): Promise<this['Out']> {
    const session = p.context.session;
    const message = p.data;

    await session.addUserMessage(new UserMessage(message));
    await session.resume();

    return packet({ data: undefined, context: p.context, deps: p.deps });
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

  async run(
    p: SinglePacket<LLMToolCall, App, ExploreContext>,
  ): Promise<SinglePacket<ToolCallResult, App, ExploreContext>> {
    const toolCall = p.data;
    const app = p.deps;
    const session = p.context.session;

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
    const result = await tool.execute(app, p.context, args, { toolCallId: id });
    const output = result.data.content;

    return packet({
      data: { toolCallId: id, name, content: output, args } as ToolCallResult,
      context: p.context,
      deps: p.deps,
    });
  }

  async postprocess(p: BatchPacket<ToolCallResult, App, ExploreContext>): Promise<this['Out']> {
    const results = p.data;
    const session = p.context.session;

    console.log(`[ToolCalls.postprocess] Adding ${results.length} tool results to session`);

    const toolMessages = results.map((result) => ({
      message: new ToolResultMessage({ toolCallId: result.toolCallId, content: result.content }).toJSON(),
    }));

    // Track context files and folders for later use
    for (const result of results) {
      if (result.name === 'read') {
        await session.addContextFiles([
          {
            path: (result.args.path as string) || '',
            category: 'text',
            content: { encoding: 'utf-8', data: result.content },
          },
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
    const session = p.context.session;
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
