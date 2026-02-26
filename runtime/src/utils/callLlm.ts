/**
 * LLM integration using OpenAI-compatible API (DeepSeek)
 */
import { OpenAI } from 'openai';
import type { ChatCompletion, ChatCompletionMessageParam } from 'openai/resources';
import type { LLMMessageData } from './message.js';

export type CallLlmOptions = {
  temperature?: number;
  thinking?: boolean;
  toolChoice?: 'none' | 'auto' | 'required';
  responseFormat?: 'text' | 'json_object';
};

/**
 * Simple LLM call without tools
 */
export async function callLlm(
  messages: LLMMessageData[],
  { temperature = 0.3, thinking = true, toolChoice = 'auto', responseFormat = 'text' }: CallLlmOptions = {},
): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY environment variable not set');
  }

  const client = new OpenAI({
    apiKey,
    baseURL: 'https://openrouter.ai/api/v1',
    timeout: 60000,
  });

  const response = await client.chat.completions.create({
    model: 'moonshotai/kimi-k2.5',
    messages: messages as ChatCompletionMessageParam[],
    temperature: temperature,
    tool_choice: toolChoice,
    response_format: { type: responseFormat },
    // @ts-expect-error - OpenRouter supports extra_body for provider-specific options
    extra_body: {
      thinking: { type: thinking ? 'enabled' : 'disabled' },
    },
  });

  return response.choices[0].message.content || '';
}

/**
 * LLM call with tool use support
 */
export async function callLlmWithTools(
  messages: LLMMessageData[],
  tools: OpenAI.ChatCompletionTool[],
  { temperature = 0.3, thinking = true, toolChoice = 'auto', responseFormat = 'text' }: CallLlmOptions = {},
): Promise<ChatCompletion.Choice[]> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY environment variable not set');
  }

  const client = new OpenAI({
    apiKey,
    baseURL: 'https://openrouter.ai/api/v1',
    timeout: 60000,
  });

  const response = await client.chat.completions.create({
    model: 'moonshotai/kimi-k2.5',
    messages: messages as ChatCompletionMessageParam[],
    tools,
    tool_choice: toolChoice,
    response_format: { type: responseFormat },
    temperature: temperature,
    // @ts-expect-error - OpenRouter supports extra_body for provider-specific options
    extra_body: {
      thinking: { type: thinking ? 'enabled' : 'disabled' },
    },
  });

  return response.choices;
}
