import type { User } from '../../data/userRepository/types.js';
import type { UserToolkitData } from '../../data/userToolkitRepository/types.js';
import type { App } from '../../app.js';
import type { AgentTool } from '../../types.js';
import { providerToolToAgentTool } from '../toolProviders/toAgentTool.js';
import type { ToolkitConfig } from '../../agents/agentictLoop/flow.js';

/**
 * RuntimeUser wraps the DB User record with their connected toolkits.
 * Mirrors the Session pattern — a functional runtime object loaded once per request.
 */
export class RuntimeUser {
  readonly data: User;
  private readonly app: App;

  constructor(data: User, app: App) {
    this.data = data;
    this.app = app;
  }

  get id(): string {
    return this.data.id;
  }

  get name(): string {
    return this.data.name ?? this.data.id;
  }

  get timezone(): string {
    return this.data.timezone;
  }

  /**
   * Fetch the user's connected toolkits fresh from the repository.
   * Always hits the DB so newly authorized toolkits show up immediately.
   */
  async getToolkits(): Promise<UserToolkitData[]> {
    return this.app.data.userToolkitRepository.getToolkits(this.data.id);
  }

  async getToolkit(provider: string, toolkitSlug: string): Promise<UserToolkitData | undefined> {
    const toolkits = await this.getToolkits();
    return toolkits.find((t) => t.provider === provider && t.toolkitSlug === toolkitSlug);
  }

  /**
   * Fetch tool schemas from each provider and convert to AgentTool[].
   * Pass toolkitConfigs to limit which toolkits and which tools within each toolkit are included.
   * If toolkitConfigs is undefined, all tools from all connected toolkits are included.
   * If a ToolkitConfig has an empty allowedTools array, all tools from that toolkit are included.
   */
  async buildAgentTools(toolkitConfigs?: ToolkitConfig[]): Promise<(AgentTool & { toolkitSlug: string })[]> {
    const configMap = toolkitConfigs
      ? new Map(toolkitConfigs.map((c) => [c.slug, c.allowedTools]))
      : undefined;

    const toolkits = await this.getToolkits();
    const filtered = configMap
      ? toolkits.filter((t) => configMap.has(t.toolkitSlug))
      : toolkits;

    if (filtered.length === 0) return [];

    const toolArrays = await Promise.all(
      filtered.map(async (toolkit) => {
        if (!this.app.services.toolProviderRegistry.has(toolkit.provider)) {
          console.warn(`[RuntimeUser] Unknown provider '${toolkit.provider}' for toolkit '${toolkit.toolkitSlug}' — skipping`);
          return [];
        }

        const provider = this.app.services.toolProviderRegistry.get(toolkit.provider);
        const providerData = toolkit.providerData as { externalUserId: string; authConfigId: string };

        const allowedTools = configMap?.get(toolkit.toolkitSlug);
        const schemas = await provider.getToolSchemas({
          externalUserId: providerData.externalUserId,
          authConfigId: providerData.authConfigId,
          ...(allowedTools && allowedTools.length > 0 ? { toolSlugs: allowedTools } : {}),
        });

        return schemas.map((schema) =>
          providerToolToAgentTool(schema, toolkit, provider, this.id),
        );
      }),
    );

    return toolArrays.flat();
  }
}
