/**
 * Tool definitions for the agentBuilder flow.
 *
 * - write_temp_file  : persist any artifact (schema, system prompt, user prompt template, checklist)
 * - submit_result    : exit the flow with the completed AgenticLoopSchema
 */
import type { OpenAI } from 'openai';

export const TOOLS: OpenAI.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'write_temp_file',
      description:
        'Save any artifact to the session temp files. ' +
        'Call this after every meaningful update — before asking the user the next question. ' +
        'Use fixed names: "agent_schema.json", "system_prompt.md", "user_prompt_template.md", "checklist.md".',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description:
              'File name. One of: "agent_schema.json", "system_prompt.md", "user_prompt_template.md", "checklist.md".',
          },
          content: {
            type: 'string',
            description: 'Full current content of the file.',
          },
        },
        required: ['name', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'submit_result',
      description:
        'Submit the completed agent schema and exit. ' +
        'Call ONLY after the user has explicitly confirmed they are satisfied with all artifacts. ' +
        'Pass the complete filled AgenticLoopSchema as the answer.',
      parameters: {
        type: 'object',
        properties: {
          answer: {
            type: 'string',
            description: 'The complete filled AgenticLoopSchema serialized as a JSON string.',
          },
        },
        required: ['answer'],
      },
    },
  },
];
