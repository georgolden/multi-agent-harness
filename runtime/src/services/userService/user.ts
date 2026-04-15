import type { User } from '../../data/userRepository/types.js';
import type { UserToolkitData } from '../../data/userToolkitRepository/types.js';
import type { App } from '../../app.js';
import type { AgentTool } from '../../types.js';
import { providerToolToAgentTool } from '../toolProviders/toAgentTool.js';

/**
 * RuntimeUser wraps the DB User record with their connected toolkits.
 * Mirrors the Session pattern — a functional runtime object loaded once per request.
 */
export class RuntimeUser {
  readonly data: User;
  readonly toolkits: UserToolkitData[];
  private readonly app: App;

  constructor(data: User, toolkits: UserToolkitData[], app: App) {
    this.data = data;
    this.toolkits = toolkits;
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

  getToolkit(provider: string, toolkitSlug: string): UserToolkitData | undefined {
    return this.toolkits.find((t) => t.provider === provider && t.toolkitSlug === toolkitSlug);
  }

  /**
   * Fetch tool schemas from each provider and convert to AgentTool[].
   * Pass toolkitSlugs to limit which toolkits are included.
   * If toolkitSlugs is undefined, all connected toolkits are included.
   */
  async buildAgentTools(toolkitSlugs?: string[]): Promise<(AgentTool & { toolkitSlug: string })[]> {
    const filtered = toolkitSlugs
      ? this.toolkits.filter((t) => toolkitSlugs.includes(t.toolkitSlug))
      : this.toolkits;

    if (filtered.length === 0) return [];

    const toolArrays = await Promise.all(
      filtered.map(async (toolkit) => {
        if (!this.app.services.toolProviderRegistry.has(toolkit.provider)) {
          console.warn(`[RuntimeUser] Unknown provider '${toolkit.provider}' for toolkit '${toolkit.toolkitSlug}' — skipping`);
          return [];
        }

        const provider = this.app.services.toolProviderRegistry.get(toolkit.provider);
        const providerData = toolkit.providerData as { externalUserId: string; authConfigId: string };

        const schemas = await provider.getToolSchemas({
          externalUserId: providerData.externalUserId,
          authConfigId: providerData.authConfigId,
        });

        return schemas.map((schema) =>
          providerToolToAgentTool(schema, toolkit, provider, this.id),
        );
      }),
    );

    return toolArrays.flat();
  }
}
