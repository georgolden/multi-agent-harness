import { Composio } from '@composio/core';
import type {
  ToolProvider,
  ProviderToolkitInfo,
  ProviderConnectionRequest,
  ProviderConnection,
  ProviderToolSchema,
  ProviderToolResult,
} from '../toolProviders/toolProvider.js';
import type {
  GetToolsOptions,
  ToolkitsByCategory,
  AuthConfigListResponse,
  AuthConfigRetrieveResponse,
} from './types.js';

export class ComposioService implements ToolProvider {
  readonly name = 'composio';

  private readonly composio: Composio;

  constructor(_app?: unknown) {
    const apiKey = process.env.COMPOSIO_API_KEY;
    if (!apiKey) throw new Error('[ComposioService] COMPOSIO_API_KEY is not set');

    this.composio = new Composio({ apiKey });
    console.log('[ComposioService] Initialized');
  }

  async start(): Promise<void> {}
  async stop(): Promise<void> {}

  // ─── ToolProvider: Discover ────────────────────────────────────────────────

  /**
   * List unique toolkit categories derived from the toolkits list.
   * The SDK's listCategories() returns one entry per toolkit (not deduplicated),
   * so we derive unique category names from the actual toolkits instead.
   */
  async listCategories(): Promise<string[]> {
    const toolkits = await this.composio.toolkits.get({});
    const items = Array.isArray(toolkits) ? toolkits : (toolkits as any)?.items ?? [];
    const seen = new Set<string>();
    for (const toolkit of items) {
      for (const cat of toolkit.meta?.categories ?? []) {
        seen.add(cat.name);
      }
    }
    return [...seen].sort();
  }

  /**
   * List toolkits as provider-agnostic ProviderToolkitInfo[], optionally filtered by category.
   */
  async listToolkits(params: { category?: string } = {}): Promise<ProviderToolkitInfo[]> {
    const raw = await this.composio.toolkits.get(params.category ? { category: params.category } : {});
    const items = Array.isArray(raw) ? raw : (raw as any)?.items ?? [];

    return items.map((t: any): ProviderToolkitInfo => ({
      slug: t.slug,
      name: t.name ?? t.slug,
      description: t.meta?.description ?? '',
      logo: t.meta?.logo ?? '',
      categories: (t.meta?.categories ?? []).map((c: any) => c.name as string),
      authSchemes: t.authSchemes ?? [],
      noAuth: t.noAuth ?? false,
    }));
  }

  // ─── ToolProvider: Auth ────────────────────────────────────────────────────

  /**
   * Initiate an OAuth/auth connection for a user and toolkit.
   * Uses Composio-managed auth (works for most popular toolkits, zero config).
   * Returns externalUserId (the connected account ID, e.g. ca_xxxxx) and redirectUrl.
   */
  async initiateConnection(params: {
    userId: string;
    toolkitSlug: string;
  }): Promise<ProviderConnectionRequest> {
    const { userId, toolkitSlug } = params;
    const req = await this.composio.toolkits.authorize(userId, toolkitSlug);
    console.log(`[ComposioService] Initiated connection for user=${userId} toolkit=${toolkitSlug} externalUserId=${req.id}`);
    return {
      externalUserId: req.id,
      redirectUrl: req.redirectUrl ?? '',
    };
  }

  /**
   * Wait for a connection to become ACTIVE after the user completes OAuth.
   */
  async waitForConnection(params: {
    externalUserId: string;
    timeoutMs?: number;
  }): Promise<ProviderConnection> {
    const { externalUserId, timeoutMs = 60_000 } = params;
    const account = await this.composio.connectedAccounts.waitForConnection(externalUserId, timeoutMs);
    return {
      externalUserId: account.id,
      authConfigId: account.authConfig?.id ?? '',
      status: account.status as ProviderConnection['status'],
      toolkitSlug: (account as any).toolkit?.slug ?? '',
    };
  }

  /**
   * Get the user's active connected account for a given toolkit, or null if not connected.
   */
  async getConnection(params: {
    userId: string;
    toolkitSlug: string;
  }): Promise<ProviderConnection | null> {
    const { userId, toolkitSlug } = params;
    const response = await this.composio.connectedAccounts.list({
      userIds: [userId],
      toolkitSlugs: [toolkitSlug],
      statuses: ['ACTIVE'],
    });

    const account = response.items[0];
    if (!account) return null;

    return {
      externalUserId: account.id,
      authConfigId: account.authConfig?.id ?? '',
      status: account.status as ProviderConnection['status'],
      toolkitSlug: (account as any).toolkit?.slug ?? toolkitSlug,
    };
  }

  /**
   * Disconnect a user from a specific connected account.
   */
  async disconnectAccount(params: { externalUserId: string }): Promise<void> {
    await this.composio.connectedAccounts.delete(params.externalUserId);
    console.log(`[ComposioService] Deleted connected account ${params.externalUserId}`);
  }

  // ─── ToolProvider: Schemas ─────────────────────────────────────────────────

  /**
   * Get raw tool schemas for a user's connected account.
   * Uses authConfigId (AuthConfigIdsOnlyParams) to scope tools to that user.
   */
  async getToolSchemas(params: {
    externalUserId: string;
    authConfigId: string;
    limit?: number;
  }): Promise<ProviderToolSchema[]> {
    const { authConfigId, limit } = params;

    const tools = await this.composio.tools.getRawComposioTools({
      authConfigIds: [authConfigId],
      ...(limit ? { limit } : {}),
    });

    const arr = Array.isArray(tools) ? tools : (tools as any)?.items ?? [];
    return arr.map((t: any): ProviderToolSchema => ({
      slug: t.slug,
      name: t.name,
      description: t.description,
      inputParameters: t.inputParameters,
      outputParameters: t.outputParameters,
      tags: t.tags ?? [],
      version: t.version ?? '',
    }));
  }

  // ─── ToolProvider: Execute ─────────────────────────────────────────────────

  /**
   * Execute a tool for a specific user.
   * userId is your app's user ID; externalUserId is the Composio connected account ID.
   */
  async executeTool(params: {
    toolSlug: string;
    userId: string;
    externalUserId: string;
    arguments: Record<string, unknown>;
  }): Promise<ProviderToolResult> {
    const { toolSlug, userId, arguments: args } = params;

    const result = await this.composio.tools.execute(toolSlug, {
      userId,
      arguments: args,
      dangerouslySkipVersionCheck: true,
    });

    return {
      data: result.data,
      error: result.error ?? null,
      successful: result.successful,
    };
  }

  // ─── Composio-specific helpers (not part of ToolProvider interface) ────────

  /**
   * List all toolkits grouped by their categories.
   * Fetches toolkits once and groups them client-side by meta.categories.
   */
  async listToolkitsByCategory(): Promise<ToolkitsByCategory> {
    const raw = await this.composio.toolkits.get({});
    const items = Array.isArray(raw) ? raw : (raw as any)?.items ?? [];
    const result: ToolkitsByCategory = {};

    for (const toolkit of items) {
      const categories: { name: string }[] = toolkit.meta?.categories ?? [];
      if (categories.length === 0) {
        (result['Uncategorized'] ??= []).push(toolkit);
      } else {
        for (const cat of categories) {
          (result[cat.name] ??= []).push(toolkit);
        }
      }
    }

    return result;
  }

  /**
   * List auth configs for the project, optionally filtered by toolkit slug.
   */
  async listAuthConfigs(toolkit?: string): Promise<AuthConfigListResponse> {
    return this.composio.authConfigs.list(toolkit ? { toolkit } : undefined);
  }

  /**
   * Get a single auth config by ID.
   */
  async getAuthConfig(authConfigId: string): Promise<AuthConfigRetrieveResponse> {
    return this.composio.authConfigs.get(authConfigId);
  }

  /**
   * Get raw tool schemas using flexible filter options (helper for internal use).
   */
  async getTools(options: GetToolsOptions = {}): Promise<any[]> {
    const { toolkits, tools, authConfigIds, limit } = options;

    if (tools?.length) {
      return this.composio.tools.getRawComposioTools({ tools }) as any;
    }
    if (authConfigIds?.length) {
      return this.composio.tools.getRawComposioTools({
        authConfigIds,
        ...(limit ? { limit } : {}),
      }) as any;
    }
    if (toolkits?.length) {
      return this.composio.tools.getRawComposioTools({
        toolkits,
        ...(limit ? { limit } : {}),
      }) as any;
    }

    return this.composio.tools.getRawComposioTools({
      toolkits: [],
      ...(limit ? { limit } : {}),
    }) as any;
  }
}
