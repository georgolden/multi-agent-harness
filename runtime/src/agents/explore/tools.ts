import { Type, type Static } from '@sinclair/typebox';
import type { OpenAI } from 'openai';
import type { AgentTool } from '../../types.js';
import { ToolResultMessage } from '../../utils/message.js';

export const submitResultSchema = Type.Object(
  {
    task_understanding: Type.String({
      description:
        'Brief restatement of what the user wants to accomplish based on their input and the explored context. This is NOT an answer or a plan — just a clear summary of the goal so downstream consumers know what all the context is for.',
    }),
    context: Type.Array(
      Type.Object(
        {
          path: Type.String({
            description: 'Absolute or relative path to the file or folder.',
          }),
          type: Type.Union([Type.Literal('file'), Type.Literal('folder')], {
            description: 'Whether this entry is a file or a folder.',
          }),
          category: Type.Union(
            [
              Type.Literal('modification_target'),
              Type.Literal('example'),
              Type.Literal('reference'),
              Type.Literal('dependency'),
            ],
            {
              description:
                "The role this file or folder plays in the user's task. modification_target: Files or folders that need to be created, edited, or deleted to accomplish the task. These are the direct targets of the work. For folders, this means new files should be created inside them or multiple files within need changes. example: Files or folders containing solved instances of similar tasks, patterns to replicate, or conventions to follow. The downstream agent should study these to match existing style, structure, and approach rather than inventing from scratch. reference: Documentation, tutorials, architecture explanations, type definitions, config files, or any context that helps understand the system but won't be modified. For folders, this means the folder as a whole serves as a knowledge base (e.g. a docs/ folder, a types/ folder). dependency: Files or folders that won't be modified but that modification targets import from, call into, or otherwise depend on. Understanding their interfaces, exports, and behavior is necessary to make correct changes to the modification targets.",
            },
          ),
          reasoning: Type.String({
            description:
              "Explain why this file or folder matters for the user's task specifically. For files: what role it plays and what parts are important. For folders: what the folder contains as a whole and why the collection is relevant. Do NOT just describe what the file contains generically — always connect it to the task.",
          }),
          key_sections: Type.Optional(
            Type.Array(Type.String(), {
              description:
                "Only for files. Specific line ranges or named sections worth focusing on, so the downstream consumer doesn't have to read the entire file.",
            }),
          ),
        },
        { additionalProperties: false },
      ),
      {
        description:
          "All files and folders relevant to the user's task, each categorized by its role. Order by importance — most critical items first.",
      },
    ),
    structure_notes: Type.Optional(
      Type.String({
        description:
          "How the relevant pieces connect to each other — imports, data flow, execution order, shared patterns. This captures relationships that aren't visible from any single context entry alone.",
      }),
    ),
    ignored: Type.Optional(
      Type.Array(
        Type.Object(
          {
            path: Type.String(),
            reason: Type.String({
              description: "Why this was excluded — what you checked and why it doesn't connect to the task.",
            }),
          },
          { additionalProperties: false },
        ),
        {
          description:
            'Files or folders the user mentioned or seemed to expect would be relevant, but that have no actual connection to the task. Include these only when the user explicitly mentioned them — do not list every irrelevant file you encountered during exploration.',
        },
      ),
    ),
  },
  { additionalProperties: false },
);

export type SubmitResult = Static<typeof submitResultSchema>;

const submitResultTool: AgentTool<typeof submitResultSchema> = {
  name: 'submit_result',
  description:
    "Submit the final exploration results. Call this tool when you have gathered enough context to understand the user's task and identified all relevant files and folders. Every file or folder you include must have a clear role in the task — do not include items just because the user mentioned them if they have no relevance. If the user mentioned something that is clearly irrelevant, add it to the ignored array with an explanation.",
  parameters: submitResultSchema,
  label: 'Submit result',
  execute: async (app, _context, params, { toolCallId }) => ({
    data: new ToolResultMessage({ toolCallId, content: JSON.stringify(params) }),
    details: params,
  }),
};

// Export as AgentTools for session usage
export const AGENT_TOOLS = [submitResultTool];

// Export as ChatCompletionTools for LLM calls
export const TOOLS: OpenAI.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'submit_result',
      description:
        "Submit the final exploration results. Call this tool when you have gathered enough context to understand the user's task and identified all relevant files and folders. Every file or folder you include must have a clear role in the task — do not include items just because the user mentioned them if they have no relevance. If the user mentioned something that is clearly irrelevant, add it to the ignored array with an explanation.",
      parameters: submitResultSchema as any,
    },
  },
];
