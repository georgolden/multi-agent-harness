/**
 * LLM integration using OpenAI-compatible API (DeepSeek)
 */
import { OpenAI } from 'openai';
import type { ChatCompletion, ChatCompletionMessage, ChatCompletionMessageParam } from 'openai/resources';

/**
 * Simple LLM call without tools
 */
export async function callLlm(messages: ChatCompletionMessageParam[]): Promise<string> {
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
    messages,
    temperature: 0.3,
  });

  return response.choices[0].message.content || '';
}

/**
 * LLM call with tool use support
 */
export async function callLlmWithTools(
  messages: ChatCompletionMessageParam[],
  tools: OpenAI.ChatCompletionTool[],
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
    messages,
    tools,
    tool_choice: 'required',
    temperature: 0.3,
  });

  return response.choices;
}
