// ─── Shared provider types ────────────────────────────────────────────────────

/** A toolkit available in the provider's catalogue. */
export interface ProviderToolkitInfo {
  slug: string;
  name: string;
  description: string;
  logo: string;
  categories: string[];
  authSchemes: string[];
  noAuth: boolean;
}

/**
 * Returned when a connection is initiated.
 * externalUserId is the provider-side account ID (e.g. Composio's ca_xxxxx).
 * Send the user to redirectUrl to complete OAuth.
 */
export interface ProviderConnectionRequest {
  externalUserId: string;
  redirectUrl: string;
}

/** The state of a connected account after auth completes. */
export interface ProviderConnection {
  externalUserId: string;
  authConfigId: string;
  status: 'ACTIVE' | 'INITIATED' | 'INITIALIZING';
  toolkitSlug: string;
}

/** Raw tool schema from the provider — inputParameters is standard JSON Schema. */
export interface ProviderToolSchema {
  slug: string;
  name: string;
  description: string;
  inputParameters: Record<string, unknown>;
  outputParameters: Record<string, unknown>;
  tags: string[];
  version: string;
}

/** Result of executing a provider tool. */
export interface ProviderToolResult {
  data: unknown;
  error: string | null;
  successful: boolean;
}

// ─── ToolProvider interface ───────────────────────────────────────────────────

export interface ToolProvider {
  readonly name: string;

  // ── Discover ────────────────────────────────────────────────────────────────

  listCategories(): Promise<string[]>;

  listToolkits(params: { category?: string }): Promise<ProviderToolkitInfo[]>;

  // ── Auth ────────────────────────────────────────────────────────────────────

  initiateConnection(params: {
    userId: string;
    toolkitSlug: string;
  }): Promise<ProviderConnectionRequest>;

  waitForConnection(params: {
    externalUserId: string;
    timeoutMs?: number;
  }): Promise<ProviderConnection>;

  getConnection(params: {
    userId: string;
    toolkitSlug: string;
  }): Promise<ProviderConnection | null>;

  disconnectAccount(params: {
    externalUserId: string;
  }): Promise<void>;

  // ── Schemas ─────────────────────────────────────────────────────────────────

  getToolSchemas(params: {
    externalUserId: string;
    authConfigId: string;
    limit?: number;
  }): Promise<ProviderToolSchema[]>;

  // ── Execute ─────────────────────────────────────────────────────────────────

  executeTool(params: {
    toolSlug: string;
    userId: string;
    externalUserId: string;
    arguments: Record<string, unknown>;
  }): Promise<ProviderToolResult>;
}

// ─── Provider registry ────────────────────────────────────────────────────────

export class ToolProviderRegistry {
  private providers = new Map<string, ToolProvider>();

  register(provider: ToolProvider): void {
    this.providers.set(provider.name, provider);
  }

  get(name: string): ToolProvider {
    const provider = this.providers.get(name);
    if (!provider) throw new Error(`[ToolProviderRegistry] Unknown provider: "${name}"`);
    return provider;
  }

  has(name: string): boolean {
    return this.providers.has(name);
  }

  names(): string[] {
    return [...this.providers.keys()];
  }
}
