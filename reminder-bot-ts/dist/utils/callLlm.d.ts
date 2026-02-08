/**
 * LLM integration using OpenAI-compatible API (DeepSeek)
 */
import { OpenAI } from 'openai';
import type { ChatCompletion, ChatCompletionMessageParam } from 'openai/resources';
/**
 * Simple LLM call without tools
 */
export declare function callLlm(messages: ChatCompletionMessageParam[]): Promise<string>;
/**
 * LLM call with tool use support
 */
export declare function callLlmWithTools(messages: ChatCompletionMessageParam[], tools: OpenAI.ChatCompletionTool[]): Promise<ChatCompletion.Choice[]>;
