/**
 * LLM integration using OpenAI-compatible API (DeepSeek)
 */
import { OpenAI } from 'openai'
import type { LLMMessage, ConversationMessage } from '../types'

/**
 * Simple LLM call without tools
 */
export async function callLlm(messages: ConversationMessage[]): Promise<string> {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY environment variable not set')
  }

  const client = new OpenAI({
    apiKey,
    baseURL: 'https://api.deepseek.com',
    timeout: 60000,
  })

  const response = await client.chat.completions.create({
    model: 'deepseek-chat',
    messages,
    temperature: 0.3,
  })

  return response.choices[0].message.content || ''
}

/**
 * LLM call with tool use support
 */
export async function callLlmWithTools(
  messages: ConversationMessage[],
  tools: OpenAI.ChatCompletionTool[],
): Promise<LLMMessage> {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY environment variable not set')
  }

  const client = new OpenAI({
    apiKey,
    baseURL: 'https://api.deepseek.com',
    timeout: 60000,
  })

  const response = await client.chat.completions.create({
    model: 'deepseek-chat',
    messages,
    tools,
    tool_choice: 'auto',
    temperature: 0.3,
  })

  const message = response.choices[0].message

  return {
    role: message.role as 'assistant',
    content: message.content,
    tool_calls: message.tool_calls as any,
  }
}
