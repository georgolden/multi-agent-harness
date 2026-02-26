import type { OpenAI } from 'openai';
import type { ToolSchema } from '../services/sessionService/types.js';

export function toLLMTools(tools: ToolSchema[]): OpenAI.ChatCompletionTool[] {
  return tools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}
