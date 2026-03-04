/**
 * Tool definitions for the agenticLoop flow.
 * The only tool is submit_answer, which acts as the exit condition.
 */
import type { OpenAI } from 'openai';

export const TOOLS: OpenAI.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'submit_answer',
      description:
        'Submit the answer to the user query. Call this when you have a complete answer, when the user explicitly asks to submit (even partially), or when you have enough information to respond.',
      parameters: {
        type: 'object',
        properties: {
          answer: {
            type: 'string',
            description: 'The answer content as a markdown string',
          },
        },
        required: ['answer'],
      },
    },
  },
];
