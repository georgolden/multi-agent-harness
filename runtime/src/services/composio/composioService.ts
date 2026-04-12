import { Composio } from '@composio/core';
import type {
  GetToolsOptions,
  ExecuteToolOptions,
  InitiateConnectionOptions,
  ToolkitsByCategory,
  ToolKitListResponse,
  ConnectedAccountListResponse,
  ConnectedAccountRetrieveResponse,
  ConnectionRequest,
  ToolList,
  ToolExecuteResponse,
  AuthConfigListResponse,
  AuthConfigRetrieveResponse,
} from './types.js';

export class ComposioService {
  private readonly composio: Composio;

  constructor(_app?: unknown) {
    const apiKey = process.env.COMPOSIO_API_KEY;
    if (!apiKey) throw new Error('[ComposioService] COMPOSIO_API_KEY is not set');

    this.composio = new Composio({ apiKey });
    console.log('[ComposioService] Initialized');
  }

  async start(): Promise<void> {}
  async stop(): Promise<void> {}

  // ─── Toolkits ─────────────────────────────────────────────────────────────

  /**
   * List unique toolkit categories derived from the toolkits list.
   * The SDK's listCategories() returns one entry per toolkit (not deduplicated),
   * so we derive unique category names from the actual toolkits instead.
   */
  async listCategories(): Promise<string[]> {
    const toolkits = await this.listToolkits();
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
   * List toolkits, optionally filtered by category.
   */
  async listToolkits(category?: string): Promise<ToolKitListResponse> {
    return this.composio.toolkits.get(category ? { category } : {});
  }

  /**
   * List all toolkits grouped by their categories.
   * Fetches toolkits once and groups them client-side by meta.categories.
   */
  async listToolkitsByCategory(): Promise<ToolkitsByCategory> {
    const toolkits = await this.listToolkits();
    const items = Array.isArray(toolkits) ? toolkits : (toolkits as any)?.items ?? [];
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

  // ─── Auth Configs ─────────────────────────────────────────────────────────

  /**
   * List auth configs for the project, optionally filtered by toolkit slug.
   * Most popular toolkits have a Composio-managed auth config by default.
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

  // ─── Connected Accounts ───────────────────────────────────────────────────

  /**
   * Check if a user has an active connected account for a given toolkit.
   */
  async getConnectedAccount(
    userId: string,
    toolkitSlug: string,
  ): Promise<ConnectedAccountRetrieveResponse | null> {
    const response = await this.composio.connectedAccounts.list({
      userIds: [userId],
      toolkitSlugs: [toolkitSlug],
      statuses: ['ACTIVE'],
    });

    return response.items[0] ?? null;
  }

  /**
   * List all active connected accounts for a user.
   * Pass toolkitSlugs to filter to specific toolkits.
   */
  async listConnectedAccounts(
    userId: string,
    toolkitSlugs?: string[],
  ): Promise<ConnectedAccountListResponse> {
    return this.composio.connectedAccounts.list({
      userIds: [userId],
      ...(toolkitSlugs ? { toolkitSlugs } : {}),
      statuses: ['ACTIVE'],
    });
  }

  /**
   * Disconnect a user from a specific connected account.
   */
  async disconnectAccount(connectedAccountId: string): Promise<void> {
    await this.composio.connectedAccounts.delete(connectedAccountId);
    console.log(`[ComposioService] Deleted connected account ${connectedAccountId}`);
  }

  // ─── Auth Flow ────────────────────────────────────────────────────────────

  /**
   * Initiate an OAuth/auth connection for a user and toolkit.
   *
   * Returns a ConnectionRequest with a redirectUrl — send the user there to
   * authorize with their third-party account (e.g. Google, GitHub, Slack).
   *
   * If no authConfigId is provided, Composio's managed auth config is used
   * (works out of the box for most popular toolkits).
   */
  async initiateConnection(
    userId: string,
    toolkitSlug: string,
    options: InitiateConnectionOptions = {},
  ): Promise<ConnectionRequest> {
    const { authConfigId, callbackUrl } = options;

    if (authConfigId) {
      const req = await this.composio.connectedAccounts.initiate(userId, authConfigId, {
        ...(callbackUrl ? { callbackUrl } : {}),
      });
      console.log(`[ComposioService] Initiated connection for user=${userId} toolkit=${toolkitSlug} authConfig=${authConfigId}`);
      return req;
    }

    // Use Composio-managed auth (default for most toolkits)
    const req = await this.composio.toolkits.authorize(userId, toolkitSlug);
    console.log(`[ComposioService] Initiated managed connection for user=${userId} toolkit=${toolkitSlug}`);
    return req;
  }

  /**
   * Wait for a connection to become ACTIVE after the user completes OAuth.
   * Useful for flows where you need to confirm auth before proceeding.
   *
   * @param connectedAccountId - The ID from the ConnectionRequest returned by initiateConnection
   * @param timeoutMs - Max time to wait in ms (default: 60000)
   */
  async waitForConnection(
    connectedAccountId: string,
    timeoutMs = 60_000,
  ): Promise<ConnectedAccountRetrieveResponse> {
    return this.composio.connectedAccounts.waitForConnection(connectedAccountId, timeoutMs);
  }

  // ─── Tools ────────────────────────────────────────────────────────────────

  /**
   * Get raw (non-provider-wrapped) tool schemas, ready to pass to any LLM.
   *
   * These are standard JSON Schema tool definitions — not tied to any provider format.
   * ToolListParams is a discriminated union: pass exactly one of toolkits, tools, or authConfigIds.
   */
  async getTools(options: GetToolsOptions = {}): Promise<ToolList> {
    const { toolkits, tools, authConfigIds, limit } = options;

    if (tools?.length) {
      return this.composio.tools.getRawComposioTools({ tools });
    }
    if (authConfigIds?.length) {
      return this.composio.tools.getRawComposioTools({
        authConfigIds,
        ...(limit ? { limit } : {}),
      });
    }
    if (toolkits?.length) {
      return this.composio.tools.getRawComposioTools({
        toolkits,
        ...(limit ? { limit } : {}),
      });
    }

    // No filter — fetch by limit only (returns popular/default tools)
    return this.composio.tools.getRawComposioTools({
      toolkits: [],
      ...(limit ? { limit } : {}),
    });
  }

  /**
   * Get raw tool schemas scoped to a specific user's connected accounts.
   *
   * Uses the user's active connected accounts to filter tools — only tools
   * the user has authorized will be returned. Pass toolkits to narrow the result.
   */
  async getToolsForUser(userId: string, options: GetToolsOptions = {}): Promise<ToolList> {
    const { toolkits, limit } = options;

    // Resolve which auth configs belong to this user's connected accounts
    const connectedAccounts = await this.composio.connectedAccounts.list({
      userIds: [userId],
      ...(toolkits ? { toolkitSlugs: toolkits } : {}),
      statuses: ['ACTIVE'],
    });

    const authConfigIds = [
      ...new Set(
        connectedAccounts.items
          .map((a) => a.authConfig?.id)
          .filter(Boolean) as string[],
      ),
    ];

    if (authConfigIds.length === 0) {
      return [] as unknown as ToolList;
    }

    // AuthConfigIdsOnlyParams: toolkits/tools must be absent
    return this.composio.tools.getRawComposioTools({
      authConfigIds,
      ...(limit ? { limit } : {}),
    });
  }

  /**
   * Execute a tool for a specific user.
   *
   * @param toolSlug - e.g. 'GMAIL_SEND_EMAIL'
   * @param options.userId - Your app's user ID
   * @param options.arguments - Tool input arguments
   */
  async executeTool(
    toolSlug: string,
    options: ExecuteToolOptions,
  ): Promise<ToolExecuteResponse> {
    const { userId, arguments: args, dangerouslySkipVersionCheck = false } = options;

    return this.composio.tools.execute(toolSlug, {
      userId,
      arguments: args,
      dangerouslySkipVersionCheck,
    });
  }

  /**
   * Execute a tool via a user-scoped ToolRouter session.
   *
   * Pass toolkitSlugs to tell the session which toolkits to include —
   * the session won't pick up connected accounts automatically without this.
   */
  async executeToolForUser(
    userId: string,
    toolSlug: string,
    args: Record<string, unknown>,
    toolkitSlugs?: string[],
  ): Promise<unknown> {
    // Resolve connected account IDs — the ToolRouter session requires explicit
    // connectedAccounts wiring, passing toolkits alone is not sufficient.
    const connected = await this.composio.connectedAccounts.list({
      userIds: [userId],
      ...(toolkitSlugs?.length ? { toolkitSlugs } : {}),
      statuses: ['ACTIVE'],
    });

    const connectedAccountsMap: Record<string, string> = {};
    for (const account of connected.items) {
      const slug = (account as any).toolkit?.slug;
      if (slug && account.id) connectedAccountsMap[slug] = account.id;
    }

    const session = await this.composio.create(userId, {
      ...(toolkitSlugs?.length ? { toolkits: toolkitSlugs } : {}),
      ...(Object.keys(connectedAccountsMap).length ? { connectedAccounts: connectedAccountsMap } : {}),
    });

    return session.execute(toolSlug, args);
  }
}
