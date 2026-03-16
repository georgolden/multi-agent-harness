/**
 * Tool definitions for the fillTemplate flow.
 * - write_temp_file: save the current best version of the filled template
 * - submit_template: finalize and exit the flow
 */
import type { OpenAI } from 'openai';

export const TOOLS: OpenAI.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'write_temp_file',
      description:
        'Save the current best version of the filled template. Call this after every turn where you update any part of the template — before asking the user another question. Use name "filled_template.md".',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'File name — always use "filled_template.md"',
          },
          content: {
            type: 'string',
            description: 'The current best version of the filled template as a markdown string',
          },
        },
        required: ['name', 'content'],
      },
    },
  },
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
