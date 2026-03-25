/**
 * Tool definitions for the orchestrator flow.
 *
 * AGENT_TOOLS: AgentTool instances registered on the session for execution.
 *   - writeTempFileTool  — save artifacts to the session
 *   - runAgentTool       — run an agent synchronously, return its result
 *   - spawnAgentTool     — fire-and-forget an agent, return session ID immediately
 *   - askUserTool        — inline; handled as a special pause branch in nodes.ts
 *   - submitResultTool   — inline; handled as the exit branch in nodes.ts
 *
 * TOOL_SCHEMAS: OpenAI-compatible JSON schemas for the LLM call in DecideAction.
 */
import type { OpenAI } from 'openai';
import type { AgentTool } from '../../types.js';
import { ToolResultMessage } from '../../utils/message.js';
import { createRunAgentTool } from '../../tools/runAgent.js';
import { createSpawnAgentTool } from '../../tools/spawnAgent.js';
import { createWriteTempFileTool } from '../../tools/writeTempFile.js';

// ─── ask_user (inline — flow control only, not executed via session.getAgentTool) ─

const askUserTool: AgentTool<any> = {
  name: 'ask_user',
  label: 'Ask user',
  description: 'Ask the user a focused clarifying question. Use only when ambiguity would cause the wrong agent to run. Never ask multiple questions at once.',
  parameters: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'The clarifying question to ask the user.' },
      options: { type: 'array', items: { type: 'string' }, description: 'Optional suggested answers.' },
    },
    required: ['question'],
  } as any,
  execute: async (_app, _ctx, params, { toolCallId }) => ({
    data: new ToolResultMessage({ toolCallId, content: JSON.stringify(params) }),
    details: params,
  }),
};

// ─── submit_result (inline — flow control only, exits the orchestrator) ────────

const submitResultTool: AgentTool<any> = {
  name: 'submit_result',
  label: 'Submit result',
  description: 'Exit the orchestrator after all agents have been dispatched. Describe what was run, any assumptions made, and which tasks are still in-flight.',
  parameters: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'What the user requested and how it was fulfilled.' },
      dispatched: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            agent: { type: 'string', description: 'Agent flow name.' },
            mode: { type: 'string', enum: ['run', 'spawn'], description: 'How the agent was invoked.' },
            task: { type: 'string', description: 'What this agent was asked to do.' },
            status: { type: 'string', enum: ['completed', 'in-flight'], description: 'Whether the agent has finished.' },
          },
          required: ['agent', 'mode', 'task', 'status'],
        },
        description: 'List of all agents dispatched during this orchestration.',
      },
      assumptions: {
        type: 'array',
        items: { type: 'string' },
        description: 'Assumptions made about unclear parts of the request.',
      },
    },
    required: ['summary', 'dispatched'],
  } as any,
  execute: async (_app, _ctx, params, { toolCallId }) => ({
    data: new ToolResultMessage({ toolCallId, content: JSON.stringify(params) }),
    details: params,
  }),
};

// ─── Exports ──────────────────────────────────────────────────────────────────

/**
 * AgentTool instances registered on the session via session.addAgentTools().
 * Nodes look these up via session.getAgentTool(name) and call tool.execute().
 */
export const AGENT_TOOLS: AgentTool<any>[] = [
  createWriteTempFileTool(),
  createRunAgentTool(),
  createSpawnAgentTool(),
  askUserTool,
  submitResultTool,
];

/** OpenAI-compatible tool schemas for the LLM call in DecideAction */
export const TOOL_SCHEMAS: OpenAI.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'write_temp_file',
      description: 'Save the current list of spawned agents (or any artifact) to a temp file for reference in submit_result.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'File name — use "spawned_agents.md".' },
          content: { type: 'string', description: 'Full current content of the file.' },
        },
        required: ['name', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'runAgent',
      description: 'Run an agent and wait for its result. Use only when you need the output as input for the next step.',
      parameters: {
        type: 'object',
        properties: {
          flowName: { type: 'string', description: 'Name of the agent flow to run.' },
          message: { type: 'string', description: 'Input message to send to the agent.' },
        },
        required: ['flowName', 'message'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'spawnAgent',
      description: 'Spawn an agent and return immediately without waiting for its result. Use for all independent tasks.',
      parameters: {
        type: 'object',
        properties: {
          flowName: { type: 'string', description: 'Name of the agent flow to spawn.' },
          message: { type: 'string', description: 'Input message to send to the agent.' },
        },
        required: ['flowName', 'message'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ask_user',
      description: 'Ask the user a focused clarifying question. Use only when ambiguity would cause the wrong agent to run.',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'The clarifying question.' },
          options: { type: 'array', items: { type: 'string' }, description: 'Optional suggested answers.' },
        },
        required: ['question'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'submit_result',
      description: 'Exit the orchestrator. Call once all agents are dispatched.',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'What the user requested and how it was fulfilled.' },
          dispatched: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                agent: { type: 'string' },
                mode: { type: 'string', enum: ['run', 'spawn'] },
                task: { type: 'string' },
                status: { type: 'string', enum: ['completed', 'in-flight'] },
              },
              required: ['agent', 'mode', 'task', 'status'],
            },
          },
          assumptions: { type: 'array', items: { type: 'string' } },
        },
        required: ['summary', 'dispatched'],
      },
    },
  },
];
