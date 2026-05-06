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
      name: 'get_toolkit_tools',
      description:
        "Fetch the list of available tools for one or more of the user's connected toolkits. " +
        'Returns each tool with its real provider slug (UPPER_SNAKE_CASE, e.g. LINKEDIN_SEARCH_FOR_JOBS), name, and short description. ' +
        'You MUST call this before listing or selecting any toolkit tools — never invent or guess tool slugs.',
      parameters: {
        type: 'object',
        properties: {
          toolkit_slugs: {
            type: 'array',
            items: { type: 'string' },
            description: 'Slugs of the toolkits to fetch tools for (e.g. ["github", "gmail"]).',
          },
        },
        required: ['toolkit_slugs'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_toolkit_tool_schemas',
      description:
        'Fetch full input/output JSON schemas for one or more specific toolkit tools. ' +
        'Call this when the user asks what data a tool consumes or returns, or otherwise needs the parameter shape. ' +
        'Tool slugs MUST be exact provider slugs returned earlier by get_toolkit_tools (UPPER_SNAKE_CASE). ' +
        'Do not invent slugs — if you do not have them, call get_toolkit_tools first.',
      parameters: {
        type: 'object',
        properties: {
          toolkit_slug: {
            type: 'string',
            description: 'Slug of the toolkit the tools belong to (e.g. "linkedin").',
          },
          tool_slugs: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Exact provider tool slugs (UPPER_SNAKE_CASE) to fetch schemas for, e.g. ["LINKEDIN_SEARCH_FOR_JOBS"].',
          },
        },
        required: ['toolkit_slug', 'tool_slugs'],
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
