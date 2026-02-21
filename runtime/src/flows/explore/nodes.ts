/**
 * PocketFlow nodes for the reminder bot.
 * Each node has a clear, single responsibility.
 */
import { Node, ParallelBatchNode } from 'pocketflow';
import type {
  SharedStore,
  ChatCompletionMessage,
  ChatCompletionMessageParam,
  ChatCompletionMessageFunctionToolCall,
  AgentTool,
  TextContent,
  ImageContent,
} from '../../types.js';

import { CallLlmOptions, callLlmWithTools } from '../../utils/callLlm.js';
import { createSystemPrompt, wrapUserPrompt } from './prompts/index.js';
import { TOOLS } from './tools.js';
import type { SubmitResult } from './tools.js';
import type { App } from '../../app.js';
import type { ExploreContext, DecideActionContext, ToolCallsContext } from './types.js';
import type { Session } from '../../services/sessionService/index.js';
import { toLLMTools } from '../../utils/llm.js';
import { User } from '../../data/userRepository/types.js';
import type { ContextFile, ContextFolderInfo } from '../../data/flowSessionRepository/types.js';

const MAX_ITERATIONS = 5;

const CALL_LLM_OPTIONS: CallLlmOptions = {
  toolChoice: 'required',
};

// PrepareInput Types
type PrepareInputPrepResult = Session;
type PrepareInputExecResult = 'done';

/**
 * PrepareInput: Prepare all context and create flow session with user's message (runs once)
 */
export class PrepareInput extends Node<SharedStore<ExploreContext>> {
  async prep(shared: SharedStore<ExploreContext>): Promise<PrepareInputPrepResult> {
    const { app } = shared;
    const { message, user, parent } = shared.context;
    console.log(`[PrepareInput.prep] Preparing context and creating flow session for user message: "${message}"`);

    const { services } = shared.app;

    // Create system prompt with all context
    const systemPrompt = createSystemPrompt();
    const userPrompt = wrapUserPrompt(message);

    const readTools = app.tools.getReadOnlyTools();
    const tools: AgentTool<any>[] = { ...readTools, ...TOOLS };

    // Create flow session
    const session = await services.sessionService.create({
      parentSessionId: parent?.id,
      userId: user.id,
      flowName: 'explore',
      systemPrompt,
      tools,
    });

    session.addAgentTools(tools);

    // Add user message to session
    const userMessage: ChatCompletionMessageParam = {
      role: 'user',
      content: userPrompt,
    };

    await session.addMessages([{ message: { role: 'system', content: systemPrompt } }, { message: userMessage }]);

    console.log(`[PrepareInput.prep] Created session '${session.id}' with system prompt and user message`);
    return session;
  }

  async exec(_prepRes: PrepareInputPrepResult): Promise<PrepareInputExecResult> {
    return 'done';
  }

  async post(
    shared: SharedStore<DecideActionContext>,
    prepRes: PrepareInputPrepResult,
    _execRes: PrepareInputExecResult,
  ) {
    shared.context.session = prepRes;
    return undefined;
  }
}

// DecideAction Types
type DecideActionPrepResult = {
  session: Session;
  iterations: number;
};
type DecideActionExecResult = ChatCompletionMessage;

/**
 * DecideAction: LLM decides what action to take using session from context
 */
export class DecideAction extends Node<SharedStore<DecideActionContext>> {
  constructor() {
    super(3, 1); // maxRetries: 3, wait: 1s
  }

  async prep(shared: SharedStore<DecideActionContext>): Promise<DecideActionPrepResult> {
    const { session, iterations } = shared.context;

    return {
      session,
      iterations,
    };
  }

  async exec(prepRes: DecideActionPrepResult): Promise<DecideActionExecResult> {
    const { session, iterations } = prepRes;

    const messages = session.activeMessages.map((msg) => msg.message);

    if (iterations >= MAX_ITERATIONS) {
      messages.push({
        role: 'user',
        content: 'MAX RETRIES NUMBER EXCEED - CALL submit_result tool immediately with best you can provide',
      });
    }

    console.log(`[DecideAction.exec] Calling LLM with ${messages.length} messages`);

    const response = await callLlmWithTools(messages, toLLMTools(session.toolSchemas), CALL_LLM_OPTIONS);

    console.log(`[DecideAction.exec] LLM response:`, JSON.stringify(response[0].message, null, 2));

    return response[0].message;
  }

  async post(shared: SharedStore<ToolCallsContext>, _prepRes: DecideActionPrepResult, execRes: DecideActionExecResult) {
    const { session } = shared.context;

    await session.addMessages([{ message: execRes }]);

    const toolCalls = execRes.tool_calls as ChatCompletionMessageFunctionToolCall[];

    if (!toolCalls || toolCalls.length === 0) {
      const { content, refusal } = execRes;

      let output = '';
      if (content) output = `${output}${content}`;
      if (refusal) output = `${output}\n${refusal}`;
      output = output + '\n retry if failure or call submit_result if it makes no sense to re-try';
      await session.addMessages([{ message: { role: 'user', content: output } }]);
      shared.context.iterations++;
      return 'loop';
    } else {
      console.log(`[DecideAction.post] Processing ${toolCalls.length} tool calls`);
      shared.context.toolCalls = toolCalls;
      return 'tool_calls';
    }
  }

  async execFallback(_prepRes: DecideActionPrepResult, error: Error): Promise<DecideActionExecResult> {
    console.error('[DecideAction.error] ', error);
    return { role: 'assistant', content: 'AI is broken try again later', refusal: null };
  }
}

// ToolCalls Types
type ToolCallsPrepResult = {
  tc: ChatCompletionMessageFunctionToolCall;
  app: App;
  session: Session;
  user: User;
};
type ToolCallsExecResult = {
  output: string;
  toolCallId: string;
  name: string;
  args: any;
};

export class ToolCalls extends ParallelBatchNode<SharedStore<ToolCallsContext>> {
  async prep(shared: SharedStore<ToolCallsContext>): Promise<ToolCallsPrepResult[]> {
    const { toolCalls, session, user } = shared.context;

    toolCalls.forEach((tc: ChatCompletionMessageFunctionToolCall, idx: number) => {
      console.log(`[ToolCalls.prep] Tool ${idx}: ${tc.function.name}, args: ${tc.function.arguments}`);
    });
    return toolCalls.map((tc: ChatCompletionMessageFunctionToolCall) => ({ tc, app: shared.app, session, user }));
  }

  async exec({ tc, app, session }: ToolCallsPrepResult): Promise<ToolCallsExecResult> {
    const args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
    const { name } = tc.function;

    const tool = session.getAgentTool(name);
    if (!tool) throw new Error(`Tool ${name} not found`);

    const { content } = await tool.execute(app, args, { toolCallId: tc.id });
    const output = (content as TextContent[])[0].text;

    console.log(`[ToolCalls.exec] Tool ${name} returned: "${JSON.stringify(content)}"`);

    return { output, toolCallId: tc.id, name, args };
  }

  async post(shared: SharedStore<ToolCallsContext>, _prepRes: ToolCallsPrepResult[], execRes: ToolCallsExecResult[]) {
    console.log(`[ToolCalls.post] Processing ${execRes.length} tool results`);

    const { session } = shared.context;

    // Separate submit_result from other tools
    const submitResultExec = execRes.find((r) => r.name === 'submit_result');
    const otherResults = execRes.filter((r) => r.name !== 'submit_result');

    // Process all non-submit_result tools
    const toolMessages: { message: { role: 'tool'; content: string; tool_call_id: string } }[] = [];

    for (const result of otherResults) {
      // Add tool role message for every tool
      toolMessages.push({
        message: { role: 'tool', content: result.output, tool_call_id: result.toolCallId },
      });

      // Persist file/folder content into session context
      if (result.name === 'read') {
        await session.addContextFiles([{ path: result.args.path, content: result.output }]);
      } else if (result.name === 'tree' || result.name === 'ls') {
        const folderPath: string = result.args.path || '.';
        await session.addContextFoldersInfos([{ path: folderPath, tree: result.output }]);
      }
    }

    if (toolMessages.length > 0) {
      await session.addMessages(toolMessages);
    }

    // Handle submit_result
    if (submitResultExec) {
      const args = submitResultExec.args as SubmitResult;

      // Collect files and folders referenced in the result context
      const contextFiles: ContextFile[] = [];
      const contextFoldersInfos: ContextFolderInfo[] = [];

      for (const entry of args.context) {
        if (entry.type === 'file') {
          const file = session.contextFiles.find((f) => f.path === entry.path);
          if (file) contextFiles.push(file);
        } else if (entry.type === 'folder') {
          const folder = session.contextFoldersInfos.find((f) => f.path === entry.path);
          if (folder) contextFoldersInfos.push(folder);
        }
      }

      shared.context.result = { args, contextFiles, contextFoldersInfos };

      // Add the submit_result tool message to session
      await session.addMessages([
        { message: { role: 'tool', content: submitResultExec.output, tool_call_id: submitResultExec.toolCallId } },
      ]);

      await session.complete();
      console.log(`[ToolCalls.post] submit_result processed — session ${session.id} completed`);
      return 'done';
    }
    shared.context.iterations++;
    return 'loop';
  }
}
