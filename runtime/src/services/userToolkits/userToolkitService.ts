import type { App } from '../../app.js';
import type { ProviderToolkitInfo } from '../toolProviders/toolProvider.js';
import type { UserToolkitData } from '../../data/userToolkitRepository/types.js';

export class UserToolkitService {
  private readonly app: App;

  constructor(app: App) {
    this.app = app;
  }

  async start(): Promise<void> {
    console.log('[UserToolkitService] Ready');
  }

  async stop(): Promise<void> {}

  // ─── Discovery ─────────────────────────────────────────────────────────────

  async listCategories(provider: string): Promise<string[]> {
    return this.app.services.toolProviderRegistry.get(provider).listCategories();
  }

  async listToolkits(provider: string, params: { category?: string } = {}): Promise<ProviderToolkitInfo[]> {
    return this.app.services.toolProviderRegistry.get(provider).listToolkits(params);
  }

  // ─── Connect ───────────────────────────────────────────────────────────────

  /**
   * Step 1 of auth: initiate OAuth flow for a user.
   * Returns the redirect URL to send the user to and the externalUserId to track the connection.
   */
  async initiateConnection(params: {
    userId: string;
    provider: string;
    toolkitSlug: string;
  }): Promise<{ redirectUrl: string; externalUserId: string }> {
    const { userId, provider, toolkitSlug } = params;
    const providerInstance = this.app.services.toolProviderRegistry.get(provider);
    const request = await providerInstance.initiateConnection({ userId, toolkitSlug });
    return {
      redirectUrl: request.redirectUrl,
      externalUserId: request.externalUserId,
    };
  }

  /**
   * Step 2 of auth: wait for OAuth to complete, then save the toolkit to the DB.
   * Call this after the user has been redirected back from the OAuth provider.
   */
  async completeConnection(params: {
    userId: string;
    provider: string;
    toolkitSlug: string;
    externalUserId: string;
  }): Promise<UserToolkitData> {
    const { userId, provider, toolkitSlug, externalUserId } = params;
    const providerInstance = this.app.services.toolProviderRegistry.get(provider);

    // Wait until the connected account becomes ACTIVE
    const connection = await providerInstance.waitForConnection({ externalUserId });

    // Fetch toolkit metadata from the provider for display purposes
    const toolkits = await providerInstance.listToolkits({ category: undefined });
    const info = toolkits.find((t) => t.slug === toolkitSlug);

    return this.app.data.userToolkitRepository.saveToolkit({
      userId,
      provider,
      toolkitSlug,
      name: info?.name ?? toolkitSlug,
      description: info?.description ?? '',
      logo: info?.logo ?? '',
      categories: info?.categories ?? [],
      providerData: {
        externalUserId: connection.externalUserId,
        authConfigId: connection.authConfigId,
      },
      status: 'active',
    });
  }

  // ─── Manage ────────────────────────────────────────────────────────────────

  async getUserToolkits(userId: string): Promise<UserToolkitData[]> {
    return this.app.data.userToolkitRepository.getToolkits(userId);
  }

  /**
   * Remove a toolkit: disconnects the account on the provider side and deletes the DB record.
   */
  async removeToolkit(params: { userId: string; userToolkitId: string }): Promise<void> {
    const toolkit = await this.app.data.userToolkitRepository.getToolkits(params.userId)
      .then((toolkits) => toolkits.find((t) => t.id === params.userToolkitId));

    if (!toolkit) throw new Error(`[UserToolkitService] Toolkit not found: ${params.userToolkitId}`);

    const providerData = toolkit.providerData as { externalUserId: string };
    const providerInstance = this.app.services.toolProviderRegistry.get(toolkit.provider);

    await providerInstance.disconnectAccount({ externalUserId: providerData.externalUserId });
    await this.app.data.userToolkitRepository.deleteToolkit(params.userToolkitId);
  }
}
