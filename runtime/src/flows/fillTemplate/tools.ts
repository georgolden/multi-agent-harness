/**
 * Tool definitions for the fillTemplate flow.
 * The only tool is submit_template, which acts as the exit condition.
 */
import type { OpenAI } from 'openai';

export const TOOLS: OpenAI.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'submit_template',
      description:
        'Submit the filled template. Call this when all sections and variables are resolved, when the user explicitly asks to submit (even partially), or when the user provides an already-filled template.',
      parameters: {
        type: 'object',
        properties: {
          filled_template: {
            type: 'string',
            description: 'The filled template content as a markdown string',
          },
        },
        required: ['filled_template'],
      },
    },
  },
];
