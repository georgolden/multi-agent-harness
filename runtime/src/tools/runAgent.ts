import type { AgentTool } from '../types.js';
import { Type, type Static } from '@sinclair/typebox';
import { ToolResultMessage } from '../utils/message.js';
import { App } from '../app.js';
import type { FlowContext } from '../flows/index.js';
import type { Packet } from '../utils/agent/flow.js';

export const runAgentSchema = Type.Object({
  flowName: Type.String({ description: 'Name of the agent flow or schema agent to run' }),
  message: Type.String({ description: 'Input message to send to the agent' }),
});

export type RunAgentInput = Static<typeof runAgentSchema>;

export interface RunAgentDetails {
  flowName: string;
  command: string;
}

export function createRunAgentTool(): AgentTool<typeof runAgentSchema, RunAgentDetails | undefined, FlowContext> {
  return {
    name: 'runAgent',
    label: 'runAgent',
    description: `Run agent flows — either built-in flows or custom schema-based agents.
Built-in flows are predefined in the system. Schema agents are custom agents stored in the database.
Returns the agent's response.`,
    parameters: runAgentSchema,
    execute: async (
      app: App,
      context: FlowContext,
      { flowName, message }: RunAgentInput,
      { toolCallId, signal }: { toolCallId: string; signal?: AbortSignal },
    ) => {
      const command = `runAgent(${flowName}, "${message.substring(0, 50)}${message.length > 50 ? '...' : ''}")`;

      try {
        if (signal?.aborted) {
          const error = new Error('Operation aborted');
          return { data: new ToolResultMessage({ toolCallId, content: `Error: ${error.message}` }), details: undefined, error };
        }

        if (!context) {
          const error = new Error('Flow context is required for runAgent tool');
          return { data: new ToolResultMessage({ toolCallId, content: `Error: ${error.message}` }), details: undefined, error };
        }

        const handle = await app.flows.runFlow(flowName, context, { message });
        const packet = (await handle.promise) as Packet<unknown>;

        if (signal?.aborted) {
          const error = new Error('Operation aborted');
          return { data: new ToolResultMessage({ toolCallId, content: `Error: ${error.message}` }), details: undefined, error };
        }

        const { data, branch } = packet;
        const packetError = branch === 'error' && 'error' in packet ? packet.error : null;

        return {
          data: new ToolResultMessage({ toolCallId, content: JSON.stringify({ data, branch, error: packetError }) }),
          details: { flowName, command } satisfies RunAgentDetails,
        };
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        const errorMsg = `runAgent failed: ${err.message}`;
        return {
          data: new ToolResultMessage({ toolCallId, content: `Error: ${errorMsg}` }),
          details: undefined,
          error: new Error(errorMsg),
        };
      }
    },
  };
}

/** Default runAgent tool */
export const runAgentTool = createRunAgentTool();
