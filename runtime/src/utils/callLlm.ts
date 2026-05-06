/**
 * LLM integration using OpenAI-compatible API (DeepSeek)
 * Supports both blocking and streaming modes.
 */
import { OpenAI } from 'openai';
import type { ChatCompletion, ChatCompletionChunk, ChatCompletionMessageParam } from 'openai/resources';
import type { LLMMessageData } from './message.js';

export type CallLlmOptions = {
  temperature?: number;
  thinking?: boolean;
  toolChoice?: 'none' | 'auto' | 'required';
  responseFormat?: 'text' | 'json_object';
};

// ─── Streaming Event Types ───────────────────────────────────────────────────

export type LlmStreamEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'reasoning-delta'; text: string }
  | { type: 'tool-call-start'; index: number; id: string; name: string }
  | { type: 'tool-call-delta'; index: number; argsDelta: string }
  | { type: 'tool-call-finish'; index: number; id: string; name: string; args: string }
  | {
      type: 'finish';
      finishReason: string | null;
      usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
    };

export type LlmStreamResult = {
  /** Async iterable of partial stream events (tokens, tool-call fragments, etc.) */
  stream: AsyncIterable<LlmStreamEvent>;
  /** Promise that resolves to the final aggregated chat-completion choices */
  finalResult: Promise<ChatCompletion.Choice[]>;
};

// ─── Internal helpers ────────────────────────────────────────────────────────

function getClient() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY environment variable not set');
  }
  return new OpenAI({
    apiKey,
    baseURL: 'https://openrouter.ai/api/v1',
    timeout: 60000,
  });
}

function buildParams(messages: LLMMessageData[], options: CallLlmOptions, tools?: OpenAI.ChatCompletionTool[]) {
  const params: OpenAI.ChatCompletionCreateParams = {
    model: 'moonshotai/kimi-k2.5',
    messages: messages as ChatCompletionMessageParam[],
    temperature: options.temperature ?? 0.3,
    tool_choice: options.toolChoice ?? 'auto',
    response_format: { type: options.responseFormat ?? 'text' },
    // @ts-expect-error - OpenRouter supports extra_body for provider-specific options
    extra_body: {
      thinking: { type: (options.thinking ?? true) ? 'enabled' : 'disabled' },
    },
    stream: true,
    stream_options: { include_usage: true },
  };
  if (tools && tools.length > 0) {
    params.tools = tools;
  }
  return params;
}

// ─── Aggregated Choice Types ─────────────────────────────────────────────────

type ToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

type AggregatedMessage = {
  role: 'assistant';
  content: string | null;
  refusal: string | null;
  reasoning: string | null;
  tool_calls?: ToolCall[];
};

type AggregatedChoice = {
  message: AggregatedMessage;
  finish_reason: ChatCompletion.Choice['finish_reason'] | null;
  index: number;
  logprobs: ChatCompletion.Choice['logprobs'];
};

type PendingToolCall = {
  id: string;
  name: string;
  args: string;
  started: boolean;
};

type StreamUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

/** OpenRouter/DeepSeek extension: reasoning content in delta. */
type ExtendedDelta = ChatCompletionChunk.Choice.Delta & {
  reasoning?: string;
};

// ─── ChoiceAggregator ────────────────────────────────────────────────────────

/** Aggregates streamed chunks into final ChatCompletion.Choice objects. */
class ChoiceAggregator {
  private choices = new Map<number, AggregatedChoice>();

  processChunkChoice(chunkChoice: ChatCompletionChunk.Choice): void {
    const existing = this.choices.get(chunkChoice.index);
    if (!existing) {
      this.choices.set(chunkChoice.index, this.createChoice(chunkChoice));
    } else {
      this.updateChoice(existing, chunkChoice);
    }
  }

  private createChoice(chunkChoice: ChatCompletionChunk.Choice): AggregatedChoice {
    const delta = chunkChoice.delta as ExtendedDelta;
    return {
      message: {
        role: 'assistant',
        content: delta.content ?? null,
        refusal: delta.refusal ?? null,
        reasoning: this.extractReasoning(delta),
        tool_calls: this.buildInitialToolCalls(delta.tool_calls),
      },
      finish_reason: chunkChoice.finish_reason,
      index: chunkChoice.index,
      logprobs: chunkChoice.logprobs ?? null,
    };
  }

  private updateChoice(existing: AggregatedChoice, chunkChoice: ChatCompletionChunk.Choice): void {
    const delta = chunkChoice.delta as ExtendedDelta;
    this.appendContent(existing, delta.content);
    this.appendRefusal(existing, delta.refusal);
    this.appendReasoning(existing, this.extractReasoning(delta));
    this.mergeToolCalls(existing, delta.tool_calls);
    this.updateFinishReason(existing, chunkChoice.finish_reason);
    this.updateLogprobs(existing, chunkChoice.logprobs);
  }

  private appendContent(choice: AggregatedChoice, content?: string | null): void {
    if (!content) return;
    choice.message.content = (choice.message.content ?? '') + content;
  }

  private appendRefusal(choice: AggregatedChoice, refusal?: string | null): void {
    if (!refusal) return;
    choice.message.refusal = (choice.message.refusal ?? '') + refusal;
  }

  private extractReasoning(delta: ExtendedDelta): string | null {
    return delta.reasoning ?? null;
  }

  private appendReasoning(choice: AggregatedChoice, reasoning: string | null): void {
    if (reasoning === null) return;
    choice.message.reasoning = (choice.message.reasoning ?? '') + reasoning;
  }

  private buildInitialToolCalls(toolCalls?: ChatCompletionChunk.Choice.Delta.ToolCall[]): ToolCall[] | undefined {
    if (!toolCalls) return undefined;
    return toolCalls.map((tc) => ({
      id: tc.id ?? '',
      type: 'function' as const,
      function: {
        name: tc.function?.name ?? '',
        arguments: tc.function?.arguments ?? '',
      },
    }));
  }

  private mergeToolCalls(choice: AggregatedChoice, deltaToolCalls?: ChatCompletionChunk.Choice.Delta.ToolCall[]): void {
    if (!deltaToolCalls) return;
    if (!choice.message.tool_calls) {
      choice.message.tool_calls = [];
    }
    for (const tc of deltaToolCalls) {
      this.mergeSingleToolCall(choice.message.tool_calls, tc);
    }
  }

  private mergeSingleToolCall(toolCalls: ToolCall[], tc: ChatCompletionChunk.Choice.Delta.ToolCall): void {
    const idx = tc.index;
    while (toolCalls.length <= idx) {
      toolCalls.push({ id: '', type: 'function', function: { name: '', arguments: '' } });
    }
    const existing = toolCalls[idx];
    if (tc.id) existing.id = tc.id;
    if (tc.function?.name) existing.function.name += tc.function.name;
    if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
  }

  private updateFinishReason(choice: AggregatedChoice, finishReason?: string | null): void {
    if (finishReason === null || finishReason === undefined) return;
    choice.finish_reason = finishReason as ChatCompletion.Choice['finish_reason'];
  }

  private updateLogprobs(choice: AggregatedChoice, logprobs?: ChatCompletion.Choice['logprobs']): void {
    if (logprobs === undefined) return;
    choice.logprobs = logprobs ?? null;
  }

  buildChoices(): ChatCompletion.Choice[] {
    const sorted = Array.from(this.choices.values()).sort((a, b) => a.index - b.index);
    return sorted.map((c) => ({
      finish_reason: c.finish_reason ?? 'stop',
      index: c.index,
      logprobs: c.logprobs,
      message: c.message,
    }));
  }
}

// ─── StreamEventEmitter ──────────────────────────────────────────────────────

/** Emits LlmStreamEvents from streamed chunks. */
class StreamEventEmitter {
  private pendingToolCalls = new Map<number, PendingToolCall>();

  processChunkChoice(chunkChoice: ChatCompletionChunk.Choice, usage?: StreamUsage | null): LlmStreamEvent[] {
    const events: LlmStreamEvent[] = [];
    const delta = chunkChoice.delta as ExtendedDelta;

    this.maybeEmitTextDelta(events, delta.content);
    this.maybeEmitReasoningDelta(events, delta);
    this.maybeEmitToolCallEvents(events, delta.tool_calls);

    if (chunkChoice.finish_reason) {
      events.push(...this.emitToolCallFinishes());
      events.push(this.createFinishEvent(chunkChoice.finish_reason, usage));
    }

    return events;
  }

  private maybeEmitTextDelta(events: LlmStreamEvent[], content?: string | null): void {
    if (!content) return;
    events.push({ type: 'text-delta', text: content });
  }

  private maybeEmitReasoningDelta(events: LlmStreamEvent[], delta: ExtendedDelta): void {
    const reasoning = delta.reasoning;
    if (!reasoning) return;
    events.push({ type: 'reasoning-delta', text: reasoning });
  }

  private maybeEmitToolCallEvents(
    events: LlmStreamEvent[],
    toolCalls?: ChatCompletionChunk.Choice.Delta.ToolCall[],
  ): void {
    if (!toolCalls) return;
    for (const tc of toolCalls) {
      events.push(...this.processToolCallDelta(tc));
    }
  }

  private processToolCallDelta(tc: ChatCompletionChunk.Choice.Delta.ToolCall): LlmStreamEvent[] {
    const events: LlmStreamEvent[] = [];
    const idx = tc.index;
    let pending = this.pendingToolCalls.get(idx);

    if (!pending) {
      pending = { id: tc.id ?? '', name: tc.function?.name ?? '', args: tc.function?.arguments ?? '', started: false };
      this.pendingToolCalls.set(idx, pending);
    }

    if (tc.id && !pending.started) {
      pending.id = tc.id;
      pending.started = true;
      events.push({
        type: 'tool-call-start',
        index: idx,
        id: tc.id,
        name: tc.function?.name ?? '',
      });
    }

    if (tc.function?.arguments) {
      pending.args += tc.function.arguments;
      events.push({
        type: 'tool-call-delta',
        index: idx,
        argsDelta: tc.function.arguments,
      });
    }

    if (tc.function?.name && !pending.name) {
      pending.name = tc.function.name;
    }

    return events;
  }

  private emitToolCallFinishes(): LlmStreamEvent[] {
    const events: LlmStreamEvent[] = [];
    for (const [idx, pending] of this.pendingToolCalls) {
      if (!pending.started) continue;
      events.push({
        type: 'tool-call-finish',
        index: idx,
        id: pending.id,
        name: pending.name,
        args: pending.args,
      });
    }
    this.pendingToolCalls.clear();
    return events;
  }

  private createFinishEvent(finishReason: string | null, usage?: StreamUsage | null): LlmStreamEvent {
    return {
      type: 'finish',
      finishReason,
      usage: usage
        ? {
            promptTokens: usage.prompt_tokens ?? 0,
            completionTokens: usage.completion_tokens ?? 0,
            totalTokens: usage.total_tokens ?? 0,
          }
        : undefined,
    };
  }
}

// ─── LlmStream ───────────────────────────────────────────────────────────────

/** Orchestrates API streaming, event emission, and result aggregation. */
class LlmStream {
  private events: LlmStreamEvent[] = [];
  private waiters: Array<() => void> = [];
  private done = false;
  private error?: Error;

  private aggregator = new ChoiceAggregator();
  private emitter = new StreamEventEmitter();

  private resolveFinal!: (choices: ChatCompletion.Choice[]) => void;
  private rejectFinal!: (err: Error) => void;
  readonly finalResult: Promise<ChatCompletion.Choice[]>;

  constructor(private apiPromise: Promise<AsyncIterable<ChatCompletionChunk>>) {
    this.finalResult = new Promise((res, rej) => {
      this.resolveFinal = res;
      this.rejectFinal = rej;
    });
    this.runProcessor();
  }

  private async runProcessor(): Promise<void> {
    try {
      const stream = await this.apiPromise;
      for await (const chunk of stream) {
        for (const choice of chunk.choices) {
          this.aggregator.processChunkChoice(choice);
          const newEvents = this.emitter.processChunkChoice(choice, chunk.usage);
          newEvents.forEach((e) => this.pushEvent(e));
        }
      }
      this.finishState();
      this.resolveFinal(this.aggregator.buildChoices());
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.finishState(error);
      this.rejectFinal(error);
    }
  }

  private pushEvent(event: LlmStreamEvent): void {
    this.events.push(event);
    const waiters = this.waiters;
    this.waiters = [];
    waiters.forEach((w) => w());
  }

  private finishState(err?: Error): void {
    this.done = true;
    if (err) this.error = err;
    const waiters = this.waiters;
    this.waiters = [];
    waiters.forEach((w) => w());
  }

  private async waitForEvent(minIndex: number): Promise<boolean> {
    if (this.events.length > minIndex) return true;
    if (this.done) return false;
    return new Promise((resolve) => {
      this.waiters.push(() => resolve(true));
      setTimeout(() => resolve(this.events.length > minIndex || this.done), 50);
    });
  }

  getStream(): AsyncIterable<LlmStreamEvent> {
    return this.createIterator();
  }

  toResult(): LlmStreamResult {
    return {
      stream: this.getStream(),
      finalResult: this.finalResult,
    };
  }

  private async *createIterator(): AsyncGenerator<LlmStreamEvent> {
    let idx = 0;
    while (true) {
      const hasMore = await this.waitForEvent(idx);
      if (!hasMore && this.done) {
        if (this.error) throw this.error;
        return;
      }
      while (idx < this.events.length) {
        yield this.events[idx++];
      }
    }
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function callLlmWithToolsStream(
  messages: LLMMessageData[],
  tools: OpenAI.ChatCompletionTool[],
  options: CallLlmOptions = {},
): LlmStreamResult {
  const client = getClient();
  const params = buildParams(messages, options, tools);
  const apiPromise = client.chat.completions.create(params) as Promise<AsyncIterable<ChatCompletionChunk>>;
  return new LlmStream(apiPromise).toResult();
}

export function callLlmStream(messages: LLMMessageData[], options: CallLlmOptions = {}): LlmStreamResult {
  const client = getClient();
  const params = buildParams(messages, options);
  const apiPromise = client.chat.completions.create(params) as Promise<AsyncIterable<ChatCompletionChunk>>;
  return new LlmStream(apiPromise).toResult();
}

// ─── Blocking wrappers (backwards compatible) ────────────────────────────────

/**
 * Simple LLM call without tools (blocking)
 */
export async function callLlm(messages: LLMMessageData[], options: CallLlmOptions = {}): Promise<string> {
  const { finalResult } = callLlmStream(messages, options);
  const choices = await finalResult;
  return choices[0]?.message.content || '';
}

/**
 * LLM call with tool use support (blocking)
 */
export async function callLlmWithTools(
  messages: LLMMessageData[],
  tools: OpenAI.ChatCompletionTool[],
  options: CallLlmOptions = {},
): Promise<ChatCompletion.Choice[]> {
  const { finalResult } = callLlmWithToolsStream(messages, tools, options);
  return finalResult;
}
