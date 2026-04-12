import type {
  ToolKitListResponse,
  ConnectedAccountListResponse,
  ConnectedAccountRetrieveResponse,
  ConnectionRequest,
  ToolList,
  ToolExecuteResponse,
  AuthConfigListResponse,
  AuthConfigRetrieveResponse,
} from '@composio/core';

// Re-export composio types we use throughout the app
export type {
  ToolKitListResponse,
  ConnectedAccountListResponse,
  ConnectedAccountRetrieveResponse,
  ConnectionRequest,
  ToolList,
  ToolExecuteResponse,
  AuthConfigListResponse,
  AuthConfigRetrieveResponse,
};

// ToolKitListResponse is a plain array of toolkit items
export type ToolkitItem = ToolKitListResponse[number];

export interface ToolkitsByCategory {
  [category: string]: ToolkitItem[];
}

export interface GetToolsOptions {
  /** Filter by toolkit slugs, e.g. ['gmail', 'github'] */
  toolkits?: string[];
  /** Filter by specific tool slugs, e.g. ['GMAIL_SEND_EMAIL'] */
  tools?: string[];
  /** Filter by auth config IDs */
  authConfigIds?: string[];
  /** Max tools to return */
  limit?: number;
}

export interface ExecuteToolOptions {
  /** Your app's user ID */
  userId: string;
  /** Arguments to pass to the tool */
  arguments: Record<string, unknown>;
  /** Skip version check — only use in development */
  dangerouslySkipVersionCheck?: boolean;
}

export interface InitiateConnectionOptions {
  /** Auth config ID to use. If omitted, Composio-managed auth is used */
  authConfigId?: string;
  /** URL to redirect the user to after OAuth completes */
  callbackUrl?: string;
}
