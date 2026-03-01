/**
 * Nodes for the explore agent flow.
 * Each node has a clear, single responsibility.
 */
import { Node, packet, batch, exit, type SinglePacket, type BatchPacket } from '../../utils/agent/flow.js';
import type { AgentTool } from '../../types.js';
import { CallLlmOptions, callLlmWithTools } from '../../utils/callLlm.js';
import { createSystemPrompt, wrapUserPrompt } from './prompts/index.js';
import { TOOLS } from './tools.js';
import type { SubmitResult } from './tools.js';
import { toLLMTools } from '../../utils/llm.js';
import { FolderInfo } from '../../utils/folder.js';
import { FileInfo } from '../../utils/file.js';
import {
  SystemMessage,
  UserMessage,
  AssistantMessage,
  AssistantToolCallMessage,
  ToolResultMessage,
  LLMToolCall,
} from '../../utils/message.js';
import type { ExploreContext, ExploreInput, ExploreResult, ToolResult, Session } from './types.js';
import { App } from '../../app.js';

const MAX_ITERATIONS = 5;

const CALL_LLM_OPTIONS: CallLlmOptions = {
  toolChoice: 'required',
};

/**
 * PrepareInput: Prepare all context and create flow session with user's message (runs once)
 */
export class PrepareInput extends Node<App, ExploreContext, ExploreInput, { default: Session }> {
  async run(p: this['In']): Promise<this['Out']> {
    const app = p.deps;
    const { message } = p.data;
    const { user, parent } = p.context;
    console.log(`[PrepareInput.run] Preparing context and creating flow session for user message: "${message}"`);

    const { services } = app;

    const systemPrompt = createSystemPrompt();
    const userPrompt = wrapUserPrompt(message);

    const tools = [...app.tools.getReadOnlyTools(), ...TOOLS];

    const session = await services.sessionService.create({
      parentSessionId: parent?.id,
      userId: user.id,
      flowName: 'explore',
      systemPrompt,
      tools,
    });

    session.addAgentTools(tools as AgentTool[]);

    await session.addMessages([
      { message: new SystemMessage(systemPrompt).toJSON() },
      { message: new UserMessage(userPrompt).toJSON() },
    ]);

    console.log(`[PrepareInput.run] Created session '${session.id}' with system prompt and user message`);

    return packet({
      data: session,
      context: p.context,
      deps: p.deps,
    });
  }
}

/**
 * DecideAction: LLM decides what action to take using session from context.
 * Returns a batch of tool calls if any, or loops back.
 */
export class DecideAction extends Node<App, ExploreContext, undefined, { tool_calls: LLMToolCall; loop: undefined }> {
  constructor() {
    super({ maxRunTries: 3, wait: 1000, maxLoopEntering: 3 });
  }

  async run(p: this['In']): Promise<this['Out']> {
    const { session } = p.context!;
    if (!session) throw new Error('Session not initialized');

    const messages = session.activeMessages.map((msg) => msg.message);

    console.log(`[DecideAction.run] Calling LLM with ${messages.length} messages`);

    const response = await callLlmWithTools(messages, toLLMTools(session.toolSchemas), CALL_LLM_OPTIONS);

    const assistantMsg = AssistantMessage.from(response[0].message);
    console.log(`[DecideAction.run] LLM response:`, JSON.stringify(assistantMsg.toJSON(), null, 2));

    await session.addMessages([{ message: assistantMsg.toJSON() }]);

    if (assistantMsg instanceof AssistantToolCallMessage) {
      console.log(`[DecideAction.run] Branching to tool_calls with ${assistantMsg.toolCalls.length} calls`);
      return batch({ data: assistantMsg.toolCalls, context: p.context, branch: 'tool_calls', deps: p.deps });
    }

    // No tool calls — prompt to retry or submit
    const errorText = 'error' in assistantMsg ? assistantMsg.error : assistantMsg.text;
    const retryMsg = `${errorText}\n retry if failure or call submit_result if it makes no sense to re-try`;
    await session.addMessages([{ message: new UserMessage(retryMsg).toJSON() }]);

    return packet({
      data: undefined,
      context: p.context,
      branch: 'loop',
      deps: p.deps,
    });
  }
}

/**
 * ToolCalls: Execute tools and process results.
 * run() handles a single tool call; postprocess() assembles all results.
 */
export class ToolCalls extends Node<App, ExploreContext, LLMToolCall, { loop: undefined; exit: ExploreResult }> {
  async run(p: this['In']): Promise<SinglePacket<ToolResult, this['Deps'], this['Ctx']>> {
    const toolCall = p.data;
    const app = p.deps;
    const { session } = p.context;
    if (!session) throw new Error('Session not initialized');

    const tool = session.getAgentTool(toolCall.name);
    if (!tool) throw new Error(`Tool ${toolCall.name} not found`);

    const { content } = await tool.execute(app, toolCall.args, { toolCallId: toolCall.id });
    const output = (content as { text: string }[])[0].text;

    console.log(`[ToolCalls.run] Tool ${toolCall.name} returned: "${JSON.stringify(content)}"`);

    return packet({
      data: { output, toolCallId: toolCall.id, name: toolCall.name, args: toolCall.args } as ToolResult,
      context: p.context,
      deps: p.deps,
    });
  }

  async postprocess(p: BatchPacket<ToolResult, this['Deps'], this['Ctx']>): Promise<this['Out']> {
    const results = p.data;
    console.log(`[ToolCalls.postprocess] Processing ${results.length} tool results`);

    const { session } = p.context!;
    if (!session) throw new Error('Session not initialized');

    const submitResultExec = results.find((r) => r.name === 'submit_result');
    const otherResults = results.filter((r) => r.name !== 'submit_result');

    const toolMessages: { message: ReturnType<ToolResultMessage['toJSON']> }[] = [];

    for (const result of otherResults) {
      toolMessages.push({
        message: new ToolResultMessage({ toolCallId: result.toolCallId, content: result.output }).toJSON(),
      });

      if (result.name === 'read') {
        await session.addContextFiles([
          { path: result.args.path as string, category: 'text', content: { encoding: 'utf-8', data: result.output } },
        ]);
      } else if (result.name === 'tree' || result.name === 'ls') {
        const folderPath = (result.args.path as string) || '.';
        await session.addContextFoldersInfos([{ path: folderPath, tree: result.output }]);
      }
    }

    if (toolMessages.length > 0) {
      await session.addMessages(toolMessages);
    }

    if (submitResultExec) {
      const args = submitResultExec.args as SubmitResult;

      const contextFiles: FileInfo[] = [];
      const contextFoldersInfos: FolderInfo[] = [];

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

      await session.addMessages([
        {
          message: new ToolResultMessage({
            toolCallId: submitResultExec.toolCallId,
            content: submitResultExec.output,
          }).toJSON(),
        },
      ]);

      await session.complete();
      console.log(`[ToolCalls.postprocess] submit_result processed — session ${session.id} completed`);
      return exit({ data: result, context: p.context, deps: p.deps });
    }

    return packet({
      data: undefined,
      context: p.context,
      branch: 'loop',
      deps: p.deps,
    });
  }

  async fallback(p: this['InBatchError'], err: AggregateError): Promise<this['Out']> {
    console.error(`[ToolCalls.fallback] ${err.message}`, err.errors);
    return packet({
      data: undefined,
      context: p.context,
      branch: 'loop',
      deps: p.deps,
    });
  }
}
