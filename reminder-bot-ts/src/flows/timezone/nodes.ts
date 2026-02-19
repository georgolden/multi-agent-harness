import { Node, ParallelBatchNode } from 'pocketflow';
import type {
  SharedStore,
  ChatCompletionMessage,
  ChatCompletionMessageParam,
  ChatCompletionMessageFunctionToolCall,
} from '../../types.js';
import { callLlmWithTools } from '../../utils/callLlm.js';
import { TOOLS, createToolHandler } from './tools.js';
import type { App } from '../../app.js';
import type { TimezoneContext, AskUserContext, ToolCallsContext } from './types.js';
import path from 'path';
import { readFile } from 'fs/promises';

const systemPrompt = await readFile(
  path.join(process.cwd(), 'src/flows/timezone/prompts/SYSTEM_PROMPT.MD'),
  'utf-8',
);

// Use a namespaced history key to keep timezone conversation isolated
const historyKey = (userId: string) => `tz_${userId}`;

// PrepareInput
type PrepareInputPrepResult = { userId: string; message: string };

export class PrepareInput extends Node<SharedStore<TimezoneContext>> {
  async prep(shared: SharedStore<TimezoneContext>): Promise<PrepareInputPrepResult> {
    const { userId, message } = shared.context;
    const newMessage: ChatCompletionMessageParam = { role: 'user', content: message };
    shared.app.data.messageHistory.addMessage(historyKey(userId), newMessage);
    return { userId, message };
  }

  async exec(_prepRes: PrepareInputPrepResult) {
    return 'done' as const;
  }

  async post(_shared: SharedStore<TimezoneContext>, _prepRes: PrepareInputPrepResult, _execRes: 'done') {
    return undefined;
  }
}

// DecideAction
type DecideActionPrepResult = { conversation: any[] };
type DecideActionExecResult = ChatCompletionMessage;

export class DecideAction extends Node<SharedStore<TimezoneContext>> {
  constructor() {
    super(3, 1);
  }

  async prep(shared: SharedStore<TimezoneContext>): Promise<DecideActionPrepResult> {
    const { userId } = shared.context;
    const conversation = shared.app.data.messageHistory.getConversation(historyKey(userId));
    return { conversation };
  }

  async exec({ conversation }: DecideActionPrepResult): Promise<DecideActionExecResult> {
    const messages = [{ role: 'system' as const, content: systemPrompt }, ...conversation];
    const response = await callLlmWithTools(messages, TOOLS);
    return response[0].message;
  }

  async post(shared: SharedStore<TimezoneContext>, _prepRes: DecideActionPrepResult, execRes: DecideActionExecResult) {
    const { userId } = shared.context;
    shared.app.data.messageHistory.addMessage(historyKey(userId), execRes);

    const toolCalls = execRes.tool_calls as ChatCompletionMessageFunctionToolCall[];
    if (!toolCalls || toolCalls.length === 0) {
      const { content, refusal } = execRes;
      let output = '';
      if (content) output = content;
      if (refusal) output = `${output}\n${refusal}`;
      if (!output) output = 'Something went wrong, please try again.';
      shared.context.response = output;
      return 'ask_user';
    } else {
      shared.context.toolCalls = toolCalls;
      return 'tool_calls';
    }
  }

  async execFallback(_prepRes: DecideActionPrepResult, error: Error): Promise<DecideActionExecResult> {
    console.error('[timezone/DecideAction.error]', error);
    return { role: 'assistant', content: 'Something went wrong, please try again.', refusal: null };
  }
}

// AskUser
type AskUserPrepResult = { app: App; output: string; chatId: string };

export class AskUser extends Node<SharedStore<AskUserContext>> {
  async prep(shared: SharedStore<AskUserContext>): Promise<AskUserPrepResult> {
    return { app: shared.app, output: shared.context.response, chatId: shared.context.chatId };
  }

  async exec({ app, output, chatId }: AskUserPrepResult): Promise<'sent'> {
    app.infra.bus.emit('telegram.sendMessage', { chatId, message: output });
    return 'sent';
  }

  async post(_shared: SharedStore<AskUserContext>, _prepRes: AskUserPrepResult, _execRes: 'sent') {
    return undefined;
  }
}

// ToolCalls
type ToolCallsPrepResult = {
  tc: ChatCompletionMessageFunctionToolCall;
  app: App;
  userId: string;
  chatId: string;
};
type ToolCallsExecResult = { role: 'tool'; content: string; tool_call_id: string };

export class ToolCalls extends ParallelBatchNode<SharedStore<ToolCallsContext>> {
  async prep(shared: SharedStore<ToolCallsContext>): Promise<ToolCallsPrepResult[]> {
    const { toolCalls, userId, chatId } = shared.context;
    return toolCalls.map((tc: ChatCompletionMessageFunctionToolCall) => ({ tc, app: shared.app, userId, chatId }));
  }

  async exec({ tc, app, userId, chatId }: ToolCallsPrepResult): Promise<ToolCallsExecResult> {
    const args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
    const handler = createToolHandler(tc.function.name);
    const content = await handler(app, { userId, chatId }, args);
    return { role: 'tool', content, tool_call_id: tc.id };
  }

  async post(shared: SharedStore<ToolCallsContext>, _prepRes: ToolCallsPrepResult[], execRes: ToolCallsExecResult[]) {
    shared.app.data.messageHistory.addMessages(historyKey(shared.context.userId), execRes);
    return undefined;
  }
}
