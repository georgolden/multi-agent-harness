import type { AgentTool } from '../types.js';
import { Type, type Static } from '@sinclair/typebox';
import { ToolResultMessage } from '../utils/message.js';
import { App } from '../app.js';
import type { FlowContext } from '../flows/index.js';
import type { Packet } from '../utils/agent/flow.js';

/**
 * Schema for running agent flows (both built-in and schema-based)
 */
export const runAgentSchema = Type.Object({
  agentType: Type.String({
    description: 'Type of agent: "builtin" for predefined flows, "schema" for stored schemas',
  }),
  flowName: Type.String({ description: 'Name of the agent flow to run' }),
  message: Type.String({ description: 'Input message to send to the agent' }),
});

export type RunAgentInput = Static<typeof runAgentSchema>;

export interface RunAgentDetails {
  flowName: string;
  agentType: string;
  command: string;
}

/**
 * Creates the runAgent tool that can execute both built-in and schema-based agent flows.
 *
 * Context (user, parent session) is passed as the fourth parameter to execute.
 */
export function createRunAgentTool(): AgentTool<typeof runAgentSchema, RunAgentDetails | undefined, FlowContext> {
  return {
    name: 'runAgent',
    label: 'runAgent',
    description: `Run agent flows - either built-in flows or custom schema-based agents.
Built-in flows are predefined in the system. Schema agents are custom agents stored in the database.
Returns the agent's response.`,
    parameters: runAgentSchema,
    execute: async (
      app: App,
      context: FlowContext,
      { agentType, flowName, message }: RunAgentInput,
      { toolCallId, signal }: { toolCallId: string; signal?: AbortSignal },
    ) => {
      const command = `runAgent(${agentType}:${flowName}, "${message.substring(0, 50)}${message.length > 50 ? '...' : ''}")`;

      try {
        // Abort check
        if (signal?.aborted) {
          const error = new Error('Operation aborted');
          return {
            data: new ToolResultMessage({ toolCallId, content: `Error: ${error.message}` }),
            details: undefined,
            error,
          };
        }

        if (!context) {
          const error = new Error('Flow context is required for runAgent tool');
          return {
            data: new ToolResultMessage({ toolCallId, content: `Error: ${error.message}` }),
            details: undefined,
            error,
          };
        }

        let packet: Packet<unknown>;

        if (agentType === 'builtin') {
          // Find and validate built-in flow
          const allFlows = app.flows.getFlows();
          const flow = allFlows.find((f) => f.name === flowName);

          if (!flow) {
            const availableFlows = allFlows.map((f) => f.name);
            const error = new Error(`Built-in flow "${flowName}" not found. Available: ${availableFlows.join(', ') || 'none'}`);
            return {
              data: new ToolResultMessage({ toolCallId, content: `Error: ${error.message}` }),
              details: undefined,
              error,
            };
          }

          // Execute the flow through the flows manager
          packet = (await app.flows.runFlow('taskScheduler', context, { message })) as Packet<unknown>;
        } else if (agentType === 'schema') {
          // Run schema-based agentic loop
          const schema = app.flows.getSchemaAgent(flowName);

          if (!schema) {
            const availableSchemas = app.flows.getAgenticLoopSchemas();
            const error = new Error(
              `Schema agent "${flowName}" not found. Available: ${availableSchemas.map((s) => s.flowName).join(', ') || 'none'}`,
            );
            return {
              data: new ToolResultMessage({ toolCallId, content: `Error: ${error.message}` }),
              details: undefined,
              error,
            };
          }

          packet = (await app.flows.runFlow('agenticLoop', context, { schema, message })) as Packet<unknown>;
        } else {
          const error = new Error(`Invalid agentType: "${agentType}". Must be "builtin" or "schema"`);
          return {
            data: new ToolResultMessage({ toolCallId, content: `Error: ${error.message}` }),
            details: undefined,
            error,
          };
        }

        // Abort check after execution
        if (signal?.aborted) {
          const error = new Error('Operation aborted');
          return {
            data: new ToolResultMessage({ toolCallId, content: `Error: ${error.message}` }),
            details: undefined,
            error,
          };
        }

        // Extract relevant properties from packet
        const { data, branch } = packet;
        const packetError = branch === 'error' && 'error' in packet ? packet.error : null;

        const resultText = JSON.stringify({
          data,
          branch,
          error: packetError,
        });

        return {
          data: new ToolResultMessage({ toolCallId, content: resultText }),
          details: {
            flowName,
            agentType,
            command,
          } satisfies RunAgentDetails,
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
