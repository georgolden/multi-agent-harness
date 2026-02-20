/**
 * Generic agentic loop nodes.
 * Tools are provided externally via the session - no hardcoded tool handlers.
 */
import { Node, ParallelBatchNode } from 'pocketflow';
import type {
  SharedStore,
  ChatCompletionMessage,
  ChatCompletionMessageParam,
  ChatCompletionMessageFunctionToolCall,
} from '../../types.js';
import type { App } from '../../app.js';
import type { Tool } from '../../tools/index.js';
import { callLlmWithTools } from '../../utils/callLlm.js';
import { replaceVars } from '../../utils/readReplace.js';
import type { AgenticLoopContext, AgenticLoopSession, AskUserContext, ToolCallsContext } from './types.js';
import type OpenAI from 'openai';

// ─── PrepareInput ────────────────────────────────────────────────────────────

type PrepareInputPrepResult = {
  session: AgenticLoopSession;
  userMessage: ChatCompletionMessageParam;
};
type PrepareInputExecResult = 'done';

/**
 * PrepareInput: Add the user's message to the pre-created session (runs once).
 * Session is already created by prepareAgenticLoop before flow.run().
 * Applies userPromptTemplate if set, otherwise uses the raw message.
 */
export class PrepareInput extends Node<SharedStore<AgenticLoopContext>> {
  async prep(shared: SharedStore<AgenticLoopContext>): Promise<PrepareInputPrepResult> {
    const { session, message } = shared.context;

    const content = session.userPromptTemplate ? replaceVars(session.userPromptTemplate, { message }) : message;

    const userMessage: ChatCompletionMessageParam = { role: 'user', content };

    console.log(`[PrepareInput.prep] Adding user message to session '${session.id}'`);
    return { session, userMessage };
  }

  async exec(_prepRes: PrepareInputPrepResult): Promise<PrepareInputExecResult> {
    return 'done';
  }

  async post(
    shared: SharedStore<AgenticLoopContext>,
    { session, userMessage }: PrepareInputPrepResult,
    _execRes: PrepareInputExecResult,
  ) {
    const updatedMessages = await shared.app.data.flowSessionRepository.addMessages(session.id, [
      { message: userMessage },
    ]);
    shared.context.session.activeMessages = updatedMessages;
    shared.context.iteration = 0;
    return undefined;
  }
}

// ─── DecideAction ────────────────────────────────────────────────────────────

type DecideActionPrepResult = {
  sessionId: string;
  systemPrompt: string;
  conversation: ChatCompletionMessageParam[];
  tools: OpenAI.ChatCompletionTool[];
  callLlmOptions: AgenticLoopContext['session']['callLlmOptions'];
};
type DecideActionExecResult = ChatCompletionMessage;

/**
 * DecideAction: LLM decides the next action using the session's tool schemas and options.
 * Routes to 'ask_user' (text response) or 'tool_calls' (tool execution).
 */
export class DecideAction extends Node<SharedStore<AgenticLoopContext>> {
  constructor() {
    super(3, 1); // maxRetries: 3, wait: 1s
  }

  async prep(shared: SharedStore<AgenticLoopContext>): Promise<DecideActionPrepResult> {
    const { session } = shared.context;
    const conversation = session.activeMessages.map((msg) => msg.message);

    // Convert stored ToolSchema[] to the OpenAI ChatCompletionTool format
    const tools: OpenAI.ChatCompletionTool[] = session.toolSchemas.map((schema) => ({
      type: 'function' as const,
      function: {
        name: schema.name,
        description: schema.description,
        parameters: schema.parameters,
      },
    }));

    console.log(`[DecideAction.prep] Session '${session.id}', ${conversation.length} messages, ${tools.length} tools`);

    return {
      sessionId: session.id,
      systemPrompt: session.systemPrompt,
      conversation,
      tools,
      callLlmOptions: session.callLlmOptions,
    };
  }

  async exec({
    systemPrompt,
    conversation,
    tools,
    callLlmOptions,
  }: DecideActionPrepResult): Promise<DecideActionExecResult> {
    const messages: ChatCompletionMessageParam[] = [{ role: 'system', content: systemPrompt }, ...conversation];

    console.log(`[DecideAction.exec] Calling LLM with ${messages.length} messages`);

    const response = await callLlmWithTools(messages, tools, callLlmOptions);
    return response[0].message;
  }

  async post(
    shared: SharedStore<AgenticLoopContext>,
    _prepRes: DecideActionPrepResult,
    execRes: DecideActionExecResult,
  ) {
    const { session } = shared.context;

    const updatedMessages = await shared.app.data.flowSessionRepository.addMessages(session.id, [{ message: execRes }]);
    session.activeMessages = updatedMessages;

    const toolCalls = execRes.tool_calls as ChatCompletionMessageFunctionToolCall[];

    if (!toolCalls || toolCalls.length === 0) {
      const { content, refusal } = execRes;
      let output = '';
      if (content) output += content;
      if (refusal) output += `\n${refusal}`;
      if (!output) output = 'AI is broken, try again later';

      console.log(`[DecideAction.post] Text response, routing to ask_user`);
      shared.context.response = output;
      return 'ask_user';
    } else {
      console.log(`[DecideAction.post] ${toolCalls.length} tool calls, routing to tool_calls`);
      shared.context.toolCalls = toolCalls;
      shared.context.iteration = (shared.context.iteration ?? 0) + 1;
      return 'tool_calls';
    }
  }

  async execFallback(_prepRes: DecideActionPrepResult, error: Error): Promise<DecideActionExecResult> {
    console.error('[DecideAction.error]', error);
    return { role: 'assistant', content: 'AI is broken, try again later', refusal: null };
  }
}

// ─── AskUser ─────────────────────────────────────────────────────────────────

type AskUserPrepResult = { app: App; output: string; userId: string };
type AskUserExecResult = 'sent';

/**
 * AskUser: Emit the response to the user and mark the session as completed.
 */
export class AskUser extends Node<SharedStore<AskUserContext>> {
  async prep(shared: SharedStore<AskUserContext>): Promise<AskUserPrepResult> {
    const { response, user } = shared.context;
    return { app: shared.app, output: response, userId: user.id };
  }

  async exec({ app, output, userId }: AskUserPrepResult): Promise<AskUserExecResult> {
    console.log(`[AskUser.exec] Sending message to userId: ${userId}`);
    app.infra.bus.emit('askUser', { userId, message: output });
    return 'sent';
  }

  async post(shared: SharedStore<AskUserContext>, _prepRes: AskUserPrepResult, _execRes: AskUserExecResult) {
    const { session } = shared.context;
    await shared.app.data.flowSessionRepository.updateStatus(session.id, 'completed');
    console.log(`[AskUser.post] Marked session '${session.id}' as completed`);
    return undefined;
  }
}

// ─── ToolCalls ───────────────────────────────────────────────────────────────

type ToolCallsPrepResult = {
  tc: ChatCompletionMessageFunctionToolCall;
  app: App;
  tools: Tool[];
};
type ToolCallsExecResult = {
  role: 'tool';
  content: string;
  tool_call_id: string;
};

/**
 * ToolCalls: Execute tool calls in parallel using the session's Tool instances.
 * Finds each tool by name and calls tool.execute() — no hardcoded handlers.
 */
export class ToolCalls extends ParallelBatchNode<SharedStore<ToolCallsContext>> {
  async prep(shared: SharedStore<ToolCallsContext>): Promise<ToolCallsPrepResult[]> {
    const { toolCalls, session } = shared.context;
    console.log(`[ToolCalls.prep] Processing ${toolCalls.length} tool calls`);
    return toolCalls.map((tc) => ({ tc, app: shared.app, tools: session.tools }));
  }

  async exec({ tc, app, tools }: ToolCallsPrepResult): Promise<ToolCallsExecResult> {
    const name = tc.function.name;
    const args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};

    const tool = tools.find((t) => t.name === name);
    if (!tool) {
      console.warn(`[ToolCalls.exec] Tool '${name}' not found in session`);
      return { role: 'tool', content: `Tool '${name}' not found`, tool_call_id: tc.id };
    }

    const result = await tool.execute(app, args, { toolCallId: tc.id });
    const content = result.content
      .map((block) => (block.type === 'text' ? block.text : `[image: ${block.mimeType}]`))
      .join('\n');

    console.log(`[ToolCalls.exec] Tool '${name}' returned ${content.length} chars`);
    return { role: 'tool', content, tool_call_id: tc.id };
  }

  async post(shared: SharedStore<ToolCallsContext>, _prepRes: ToolCallsPrepResult[], execRes: ToolCallsExecResult[]) {
    const { session } = shared.context;
    console.log(`[ToolCalls.post] Adding ${execRes.length} tool results to session`);

    const updatedMessages = await shared.app.data.flowSessionRepository.addMessages(
      session.id,
      execRes.map((result) => ({ message: result })),
    );
    session.activeMessages = updatedMessages;

    return undefined;
  }
}
