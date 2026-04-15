import type { AgentTool, AgentToolResult } from '../../types.js';
import type { ProviderToolSchema, ToolProvider } from './toolProvider.js';
import type { UserToolkitData, ComposioProviderData } from '../../data/userToolkitRepository/types.js';
import { ToolResultMessage } from '../../utils/message.js';

/**
 * Convert a raw provider tool schema into an AgentTool that can be injected into a session.
 *
 * The resulting tool's execute() calls provider.executeTool() with the user's externalUserId.
 * The extra `toolkitSlug` field identifies which toolkit this tool came from
 * (used for filtering in AgenticLoopFlow).
 */
export function providerToolToAgentTool(
  schema: ProviderToolSchema,
  toolkit: UserToolkitData,
  provider: ToolProvider,
  userId: string,
): AgentTool & { toolkitSlug: string } {
  const providerData = toolkit.providerData as unknown as ComposioProviderData;

  return {
    name: schema.slug,
    description: schema.description,
    // inputParameters is already JSON Schema — cast to satisfy the TypeBox TSchema slot
    parameters: schema.inputParameters as any,
    label: schema.name,
    toolkitSlug: toolkit.toolkitSlug,

    async execute(_app, _context, params, system) {
      const result = await provider.executeTool({
        toolSlug: schema.slug,
        userId,
        externalUserId: providerData.externalUserId,
        arguments: params as Record<string, unknown>,
      });

      const text = result.error
        ? `Error: ${result.error}`
        : typeof result.data === 'string'
          ? result.data
          : JSON.stringify(result.data, null, 2);

      const message = new ToolResultMessage({
        toolCallId: system.toolCallId,
        content: [{ type: 'text', text }],
      });

      return {
        data: message,
        details: result,
        ...(result.error ? { error: new Error(result.error) } : {}),
      } as AgentToolResult<typeof result>;
    },
  };
}
