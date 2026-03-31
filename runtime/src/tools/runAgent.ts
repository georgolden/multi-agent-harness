import type { AgentTool } from '../types.js';
import { Type, type Static } from '@sinclair/typebox';
import { ToolResultMessage } from '../utils/message.js';
import { App } from '../app.js';
import type { ToolCallContext } from './index.js';
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

export function createRunAgentTool(): AgentTool<typeof runAgentSchema, RunAgentDetails | undefined, ToolCallContext> {
  return {
    name: 'runAgent',
    label: 'runAgent',
    description: `Run agent flows — either built-in flows or custom schema-based agents.
Built-in flows are predefined in the system. Schema agents are custom agents stored in the database.
Returns the agent's response.`,
    parameters: runAgentSchema,
    execute: async (
      app: App,
      context: ToolCallContext,
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

        console.log(`[runAgent] Starting agent flowName='${flowName}' message='${message.slice(0, 80)}'`);
        const agent = await app.agents.runAgent(flowName, context, { message });
        console.log(`[runAgent] Agent created, waiting for runPromise flowName='${flowName}'`);
        const packet = (await agent.runPromise) as Packet<unknown>;
        console.log(`[runAgent] runPromise resolved flowName='${flowName}' branch='${(packet as any)?.branch}' data=${JSON.stringify((packet as any)?.data)?.slice(0, 200)}`);

        if (signal?.aborted) {
          const error = new Error('Operation aborted');
          return { data: new ToolResultMessage({ toolCallId, content: `Error: ${error.message}` }), details: undefined, error };
        }

        const { data, branch } = packet;
        const packetError = branch === 'error' && 'error' in packet ? packet.error : null;
        const content = JSON.stringify({ data, branch, error: packetError });
        console.log(`[runAgent] Returning tool result flowName='${flowName}' branch='${branch}' content='${content.slice(0, 200)}'`);

        return {
          data: new ToolResultMessage({ toolCallId, content }),
          details: { flowName, command } satisfies RunAgentDetails,
        };
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        const errorMsg = `runAgent failed: ${err.message}`;
        console.error(`[runAgent] Exception flowName='${flowName}' error='${err.message}'`);
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
