export interface ComposioProviderData {
  externalUserId: string; // ca_xxxxx — Composio connected account ID
  authConfigId: string;   // ac_xxxxx — Composio auth config ID
}

export interface UserToolkitData {
  id: string;
  userId: string;
  provider: string;       // 'composio'
  toolkitSlug: string;    // e.g. 'github'
  name: string;
  description: string;
  logo: string;
  categories: string[];
  providerData: Record<string, unknown>; // opaque in DB — typed per provider at service layer
  status: string;
  connectedAt: Date;
  updatedAt: Date;
}
