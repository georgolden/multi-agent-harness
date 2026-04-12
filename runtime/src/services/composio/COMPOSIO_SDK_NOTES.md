# Composio SDK Notes (@composio/core)

Learned from live testing. Reduces need to browse node_modules typedefs.

---

## Package

```
@composio/core   // installed: 0.6.8, latest: 0.6.10
```

Import:
```ts
import { Composio } from '@composio/core';
const composio = new Composio({ apiKey: process.env.COMPOSIO_API_KEY });
```

---

## Core Entity Hierarchy

```
Composio API Key (project-level)
  └─ Auth Config (ac_xxxxx)     — HOW to auth a toolkit, one per toolkit per project
       └─ Connected Account (ca_xxxxx) — per-user tokens for a toolkit
            └─ ToolRouter Session (trs_xxxxx) — runtime context tied to a userId
                 └─ Tools — what agents call
```

- **userId** — your own string (e.g. `"user-123"`), not a Composio account. Old name: `entityId`.
- **Auth Config** — shared across all your users. Most popular toolkits have a Composio-managed one (free, zero setup). `isComposioManaged: true`.
- **Connected Account** — created when a user completes OAuth. Has `status: ACTIVE | INITIATED | INITIALIZING`.
- **ToolRouter Session** — created via `composio.create(userId)`. Does NOT auto-attach connected accounts — must pass them explicitly (see gotchas).

---

## Toolkits

```ts
// ToolKitListResponse is a PLAIN ARRAY (not { items: [] })
const toolkits: ToolKitListResponse = await composio.toolkits.get({});
// toolkits[0] shape:
{
  slug: 'github',
  name: 'GitHub',
  meta: {
    categories: [{ slug: 'developer-tools', name: 'developer tools' }],
    logo: 'https://logos.composio.dev/api/github',
    toolsCount: 867,
    triggersCount: 46,
    description: '...',
    appUrl: 'https://github.com/',
    createdAt: '...',
    updatedAt: '...',
    availableVersions: [...]
  },
  isLocalToolkit: false,
  authSchemes: ['OAUTH2'],
  composioManagedAuthSchemes: ['OAUTH2'],
  noAuth: false
}

// Filter by category
await composio.toolkits.get({ category: 'developer-tools' });

// Get single toolkit
await composio.toolkits.get('github'); // returns ToolkitRetrieveResponse (single object)
```

### listCategories() — DO NOT USE directly for category list

`composio.toolkits.listCategories()` returns `{ items, nextCursor, totalPages }` where `items` has **one entry per toolkit** (43k+ items), not a deduplicated list. Useless for building a category menu.

**Correct approach** — derive unique categories from the toolkit list:
```ts
const toolkits = await composio.toolkits.get({});
const seen = new Set<string>();
for (const t of toolkits) {
  for (const cat of t.meta?.categories ?? []) seen.add(cat.name);
}
const categories = [...seen].sort(); // string[]
```

**Grouping toolkits by category** — do it client-side from one fetch, NOT by calling `get({ category })` per category (that would be N parallel requests):
```ts
const result: Record<string, typeof toolkits> = {};
for (const toolkit of toolkits) {
  for (const cat of toolkit.meta?.categories ?? []) {
    (result[cat.name] ??= []).push(toolkit);
  }
}
```

---

## Auth Configs

```ts
// List auth configs (returns { items, nextCursor, totalPages })
const result = await composio.authConfigs.list({ toolkit: 'github' });
result.items[0] shape:
{
  id: 'ac_OWQ0Jjg0U8YK',
  authScheme: 'OAUTH2',
  isComposioManaged: true,
  isDisabled: false
}

// Get single
await composio.authConfigs.get('ac_xxxxx');

// Enable/disable
await composio.authConfigs.enable('ac_xxxxx');
await composio.authConfigs.disable('ac_xxxxx');
```

Most toolkits have `isComposioManaged: true` — no need to create custom configs unless you want your own OAuth app credentials / branding.

---

## Connected Accounts

```ts
// List — returns { items, nextCursor, totalPages }
const result = await composio.connectedAccounts.list({
  userIds: ['user-123'],
  toolkitSlugs: ['github'],
  statuses: ['ACTIVE'],   // ACTIVE | INITIATED | INITIALIZING
});

result.items[0] shape:
{
  id: 'ca_4uzB7V_vMj3p',
  status: 'ACTIVE',
  statusReason: null,
  isDisabled: false,
  toolkit: { slug: 'github' },
  authConfig: {
    id: 'ac_OWQ0Jjg0U8YK',
    authScheme: 'OAUTH2',
    isComposioManaged: true,
    isDisabled: false
  },
  data: {
    status: 'ACTIVE',
    access_token: 'gho_...',
    token_type: 'bearer',
    scope: 'repo,user,...',
    base_url: 'https://api.github.com',
    headers: { Authorization: 'Bearer ...' },
    ...
  },
  params: { /* same as data */ },
  state: { authScheme: 'OAUTH2', val: { status: 'ACTIVE', ... } },
  testRequestEndpoint: 'https://api.github.com/user',
  createdAt: '...',
  updatedAt: '...'
}

// Delete (disconnect)
await composio.connectedAccounts.delete('ca_xxxxx');

// Wait for connection to become ACTIVE (polling)
await composio.connectedAccounts.waitForConnection('ca_xxxxx', 120_000);
```

---

## Auth Flow (initiating OAuth for a user)

### Option A — Composio-managed auth (works for most toolkits, zero config)
```ts
const req = await composio.toolkits.authorize(userId, 'github');
// req shape: { id: 'ca_xxxxx', status: 'INITIATED', redirectUrl: 'https://...' }
// Send user to req.redirectUrl
// Wait for connection:
const account = await composio.connectedAccounts.waitForConnection(req.id, 120_000);
```

### Option B — Custom auth config
```ts
const req = await composio.connectedAccounts.initiate(userId, 'ac_xxxxx', {
  callbackUrl: 'https://yourapp.com/callback'
});
```

### ConnectionRequest shape
```ts
{
  id: 'ca_xxxxx',          // this is the connectedAccountId
  status: 'INITIATED',
  redirectUrl: 'https://backend.composio.dev/api/v3/s/...'
}
```

---

## Tools

### ToolListParams is a DISCRIMINATED UNION — cannot mix filter types

```ts
type ToolListParams =
  | { tools: string[]; toolkits?: never; ... }               // specific tool slugs
  | { toolkits: string[]; tools?: never; limit?: number; ... } // by toolkit
  | { authConfigIds: string[]; tools?: never; toolkits?: never; limit?: number; }
  | { search: string; ... }
  | { tags: string[]; ... }
```

Pick exactly one branch. Mixing `toolkits` + `authConfigIds` in the same object will cause a TS error.

### getRawComposioTools — returns plain array

```ts
const tools = await composio.tools.getRawComposioTools({ toolkits: ['github'], limit: 10 });
// tools is a plain array (ToolList = Tool[])
// tools[0] shape:
{
  slug: 'GITHUB_GET_THE_AUTHENTICATED_USER',
  name: 'Get Authenticated User',
  description: '...',
  inputParameters: { type: 'object', properties: {...}, required: [...] },
  outputParameters: { type: 'object', properties: { data, error, successful } },
  tags: ['...'],
  toolkit: { slug: 'github', name: 'github', logo: '...' },
  version: '20260410_00',
  availableVersions: ['20260410_00'],
  isDeprecated: false,
  scopes: ['repo', 'read:org', ...],
  isNoAuth: false
}
```

### tools.get — provider-wrapped format (for passing to LLM provider directly)
```ts
// Returns tools wrapped for the configured provider (default: OpenAI function calling format)
const tools = await composio.tools.get(userId, { toolkits: ['github'], limit: 10 });
```

### tools.execute
```ts
const result = await composio.tools.execute('GITHUB_GET_THE_AUTHENTICATED_USER', {
  userId: 'user-123',
  arguments: {},
  dangerouslySkipVersionCheck: true, // needed when no version pinned
});
// result shape:
{
  data: { /* tool-specific response */ },
  error: null,
  successful: true,
  logId: 'log_xxxxx'
}
```

---

## ToolRouter Session — CRITICAL GOTCHAS

### Creating a session
```ts
const session = await composio.create(userId, config?);
```

### GOTCHA: Sessions do NOT auto-attach connected accounts

Passing `toolkits: ['github']` alone is **not enough** — the session still can't find the user's connected account and throws:
```
400 No active connection found for toolkit(s) 'github' in this session.
To fix this, call COMPOSIO_MANAGE_CONNECTIONS...
```

**Fix:** Explicitly pass `connectedAccounts: { toolkitSlug: connectedAccountId }`:
```ts
// 1. Fetch the user's connected accounts first
const connected = await composio.connectedAccounts.list({
  userIds: [userId],
  toolkitSlugs: ['github'],
  statuses: ['ACTIVE'],
});

// 2. Build the map
const connectedAccountsMap: Record<string, string> = {};
for (const account of connected.items) {
  const slug = account.toolkit?.slug;
  if (slug && account.id) connectedAccountsMap[slug] = account.id;
}

// 3. Create session with both toolkits AND connectedAccounts
const session = await composio.create(userId, {
  toolkits: ['github'],
  connectedAccounts: connectedAccountsMap,  // { github: 'ca_xxxxx' }
});
```

### Session methods
```ts
session.sessionId  // 'trs_xxxxx'

// Execute a tool
const result = await session.execute('GITHUB_GET_THE_AUTHENTICATED_USER', {});
// result shape: { data: {...}, error: null, successful: true, logId: '...' }

// Get tools (provider-wrapped, not raw schemas)
const tools = await session.tools();

// Authorize a toolkit for the user (starts OAuth flow)
const req = await session.authorize('github', { callbackUrl: '...' });

// Query connection state of toolkits in the session
const state = await session.toolkits({ toolkit: ['github'] });
```

---

## ToolRouterCreateSessionConfig shape (relevant fields)

```ts
{
  toolkits?: string[],                           // toolkit slugs to include
  connectedAccounts?: Record<string, string>,    // { toolkitSlug: connectedAccountId }
  tools?: Record<string, string[]>,              // { toolkitSlug: ['TOOL_SLUG', ...] }
  authConfigs?: Record<string, string>,          // { toolkitSlug: authConfigId }
  manageConnections?: boolean | { enable: boolean, callbackUrl?: string },
}
```

---

## What ToolRouter session.tools() returns

`session.tools()` returns `ReturnType<TProvider['wrapTools']>` — provider-specific wrapped format. With the default `ComposioProvider` this is `Array<{ name: string }>` which is useless for raw schema access.

Use `composio.tools.getRawComposioTools({ authConfigIds })` for raw JSON Schema tool definitions instead.

---

## Getting raw tools scoped to a user (recommended pattern)

The ToolListParams `AuthConfigIdsOnlyParams` is the right way to get tools a specific user can use:

```ts
// 1. Get user's connected accounts
const connected = await composio.connectedAccounts.list({
  userIds: [userId],
  toolkitSlugs: ['github'],  // optional filter
  statuses: ['ACTIVE'],
});

// 2. Extract unique auth config IDs
const authConfigIds = [...new Set(
  connected.items.map(a => a.authConfig?.id).filter(Boolean)
)] as string[];

// 3. Get raw tool schemas
const tools = await composio.tools.getRawComposioTools({
  authConfigIds,
  limit: 10,
  // NOTE: cannot add toolkits here — AuthConfigIdsOnlyParams forbids it
});
```

---

## Known SDK Quirks

| Thing | Reality |
|---|---|
| `ToolKitListResponse` | Plain array, NOT `{ items: [] }` |
| `ToolList` | Plain array |
| `ConnectedAccountListResponse` | Object with `{ items, nextCursor, totalPages }` |
| `AuthConfigListResponse` | Object with `{ items, nextCursor, totalPages }` |
| `ToolkitRetrieveCategoriesResponse` | Object with `{ items, nextCursor, totalPages }` but items = one entry per toolkit (43k+), NOT deduplicated categories |
| `composio.toolkits.get({})` | Returns `ToolKitListResponse` (plain array) |
| `composio.toolkits.get('slug')` | Returns `ToolkitRetrieveResponse` (single object) |
| Session `toolkits` param | Insufficient alone — must also pass `connectedAccounts` map |
| `dangerouslySkipVersionCheck` | Required for `tools.execute` when no version is pinned in SDK config |
| Old name for userId | `entityId` — same concept, renamed in current API |
