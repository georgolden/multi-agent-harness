import type { AgentTool } from '../types.js';
import { Type, type Static } from '@sinclair/typebox';
import { ToolResultMessage } from '../utils/message.js';
import { App } from '../app.js';
import type { ToolCallContext } from './index.js';

export const spawnAgentSchema = Type.Object({
  flowName: Type.String({ description: 'Name of the agent flow or schema agent to spawn' }),
  message: Type.String({ description: 'Input message to send to the agent' }),
});

export type SpawnAgentInput = Static<typeof spawnAgentSchema>;

export interface SpawnAgentDetails {
  flowName: string;
  sessionId: string;
}

export function createSpawnAgentTool(): AgentTool<typeof spawnAgentSchema, SpawnAgentDetails | undefined, ToolCallContext> {
  return {
    name: 'spawnAgent',
    label: 'spawnAgent',
    description: `Spawn an agent flow and return immediately without waiting for the result.
Use this to fire-and-forget tasks that run independently in the background.
Returns the spawned session ID so you can reference it later.`,
    parameters: spawnAgentSchema,
    execute: async (
      app: App,
      context: ToolCallContext,
      { flowName, message }: SpawnAgentInput,
      { toolCallId }: { toolCallId: string },
    ) => {
      try {
        // Start the flow but do NOT await its promise — fire and forget
        const handle = await app.flows.runFlow(flowName, context, { message });
        const sessionId = handle.session.id;

        return {
          data: new ToolResultMessage({
            toolCallId,
            content: JSON.stringify({ success: true, flowName, sessionId }),
          }),
          details: { flowName, sessionId } satisfies SpawnAgentDetails,
        };
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        const errorMsg = `spawnAgent failed: ${err.message}`;
        return {
          data: new ToolResultMessage({ toolCallId, content: `Error: ${errorMsg}` }),
          details: undefined,
          error: new Error(errorMsg),
        };
      }
    },
  };
}

/** Default spawnAgent tool */
export const spawnAgentTool = createSpawnAgentTool();
