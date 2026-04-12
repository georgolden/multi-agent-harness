# Composio Integration Research

## Architecture Overview

Composio is a platform providing 1000+ third-party app integrations (toolkits) for AI agents. The hierarchy is:

```
Your Composio API Key
  └─ Auth Configs (ac_xxxxx)  ← project-level blueprint: HOW to auth a toolkit
       └─ Connected Accounts (ca_xxxxx)  ← per-user credentials for a toolkit
            └─ Sessions  ← runtime SDK context scoped to a user_id
                 └─ Tools  ← what your agents actually call
```

---

## Core Entities

### Auth Config (`ac_xxxxx`)

A **project-level template** that defines the auth mechanism for a toolkit (OAuth2, API Key, Bearer, etc.). It does NOT hold any user credentials — one auth config serves all your app's users for that toolkit. Most popular toolkits (Gmail, GitHub, Slack, Notion, etc.) already have Composio-managed auth configs available with zero setup. You can also create custom ones with your own OAuth app credentials (see [Custom Auth Configs](#custom-auth-configs)).

### Connected Account (`ca_xxxxx`)

Created **per-user, per-toolkit** when a user completes the OAuth/auth flow. This is where the actual tokens or API keys live, scoped to a `user_id`. One user can have multiple connected accounts for the same toolkit (e.g., two Gmail accounts).

### user_id

Your own identifier for your app's user (e.g., `"user_123"` from your database). Not a Composio account — just an opaque string you control. This is the isolation key: all connected accounts are grouped under it, and all tool executions are scoped to it. The old terminology in Composio docs was `entityId` — it is the same concept.

### Session

Created at runtime via `composio.create(user_id)`. Automatically resolves which connected accounts belong to that `user_id` and scopes all operations (tool discovery, tool execution) to them. Not a stored entity — it is an SDK-level context object.

---

## Toolkit Categories and Listing

```typescript
// Get all available categories
const { items: categories } = await composio.toolkits.listCategories();
// → ["Communication", "Productivity", "CRM", "Developer Tools", ...]

// Get toolkits filtered by category
const toolkits = await composio.toolkits.get({ category: 'Communication' });

// Each toolkit object:
{
  slug: "gmail",
  name: "Gmail",
  auth_schemes: ["OAUTH2"],
  composio_managed_auth_schemes: ["OAUTH2"],
  meta: {
    categories: ["Communication", "Email"],
    logo: "...",
    tool_count: 12,
    trigger_count: 3
  }
}
```

REST API:
```
GET https://backend.composio.dev/api/v3/toolkits?category=Communication&sort_by=usage
```

---

## Auth Configs

### Composio-Managed (Default)

Most popular toolkits have a Composio-managed auth config available out of the box. When using these, the OAuth consent screen will show "Composio wants access to your account." No setup required on your end — just initiate the auth flow and Composio handles the rest.

### Custom Auth Configs

Create a custom auth config when:
- You want **your app's name and branding** on the OAuth consent screen
- The toolkit has **no Composio-managed auth** (obscure or niche services)
- You need **custom OAuth scopes** beyond Composio's defaults
- You need **dedicated rate limits** (not shared across all Composio users)
- You need **shorter polling intervals** for triggers (Composio-managed has a 15-min minimum)
- Connecting to **self-hosted or regional instances** (e.g., private Salesforce org)

#### Creating a Custom Auth Config

**Dashboard:** Authentication Management → Create Auth Config → select toolkit and auth scheme → enter your client ID and secret → set callback URL to `https://backend.composio.dev/api/v3/toolkits/auth/callback`.

**TypeScript SDK:**
```typescript
const authConfig = await composio.authConfigs.create('gmail', {
  type: 'OAUTH2',
  authScheme: 'OAUTH2',
  credentials: {
    clientId: 'your-client-id',
    clientSecret: 'your-client-secret'
  }
});
// Returns: { id: 'ac_xxxxx', authScheme: 'OAUTH2', isComposioManaged: false, toolkit: { slug: 'gmail' } }
```

**REST API:**
```
POST https://backend.composio.dev/api/v3/auth_configs
Header: x-api-key: <your-composio-api-key>

{
  "toolkit": { "slug": "github" },
  "auth_config": {
    "type": "OAUTH2",
    "credentials": {
      "client_id": "...",
      "client_secret": "..."
    },
    "restrict_to_following_tools": ["GITHUB_GET_REPOS"]  // optional
  }
}
```

**Other SDK methods:**
```typescript
// List auth configs (optionally filter by toolkit)
const list = await composio.authConfigs.list({ toolkit: 'gmail' });

// Enable / disable
await composio.authConfigs.enable('ac_xxxxx');
await composio.authConfigs.disable('ac_xxxxx');
```

---

## Per-User Auth Flow

### 1. Check If User Already Connected

```typescript
const accounts = await composio.connectedAccounts.list({
  userIds: ['user_123'],
  toolkitSlugs: ['gmail'],
  statuses: ['ACTIVE']
});

if (accounts.items.length > 0) {
  // user is already connected, proceed to fetch tools
}
```

REST API:
```
GET https://backend.composio.dev/api/v3/connected_accounts
  ?user_ids=user_123
  &toolkit_slugs=gmail
  &statuses=ACTIVE
```

### 2. Initiate OAuth for a User

```typescript
const session = await composio.create("user_123");

// Using Composio-managed auth (default for most toolkits)
const connectionRequest = await session.authorize('gmail');

// OR using a custom auth config
const connectionRequest = await session.authorize('gmail', {
  authConfigId: 'ac_xxxxx'
});

// Redirect the user to this URL for OAuth consent
console.log(connectionRequest.redirectUrl);
```

Alternative via `connectedAccounts`:
```typescript
const connectionRequest = await composio.connectedAccounts.link(
  "user_123",
  "ac_xxxxx"  // auth config ID
);
console.log(connectionRequest.redirectUrl);

// Optionally wait for the user to complete auth
const connectedAccount = await connectionRequest.waitForConnection();
console.log(connectedAccount.id);  // ca_xxxxx
```

REST API:
```
POST https://backend.composio.dev/api/v3/connected_accounts
{
  "auth_config": { "id": "ac_xxxxx" },
  "connection": {
    "user_id": "user_123",
    "callback_url": "https://yourapp.com/oauth/callback",
    "state": {
      "authScheme": "OAUTH2",
      "val": { "status": "INITIALIZING" }
    }
  }
}
```

### 3. User Completes OAuth in Browser

Composio's callback URL receives the OAuth code, exchanges it for tokens, and stores them in the connected account. Status transitions: `INITIALIZING → INITIATED → ACTIVE`. Token refresh is handled automatically by Composio going forward.

### 4. Fetch Tools at Agent Runtime

```typescript
const session = await composio.create("user_123");

// All tools across all connected toolkits for this user
const tools = await session.tools();

// Filtered to specific toolkits
const gmailTools = await session.tools({ toolkits: ['gmail'] });

// tools are already formatted for your LLM provider
// (OpenAI function calling format, Anthropic tool format, etc.)
// based on the provider you configured in: new Composio({ provider })
```

Direct SDK without session:
```typescript
const tools = await composio.tools.get("user_123", {
  toolkits: ['gmail'],
  limit: 10
});
```

REST API:
```
GET https://backend.composio.dev/api/v3/tools
  ?toolkit_slug=gmail
  &auth_config_ids=ac_xxxxx
  &limit=20
```

### 5. Execute Tools

```typescript
const result = await composio.tools.execute('GMAIL_SEND_EMAIL', {
  userId: 'user_123',
  arguments: {
    to: 'someone@example.com',
    subject: 'Hello',
    body: 'World'
  }
});
```

---

## Complete Pipeline Example

```typescript
const composio = new Composio({ apiKey: process.env.COMPOSIO_API_KEY });

// ── UI: List available toolkits grouped by category ──────────────────────────
const { items: categories } = await composio.toolkits.listCategories();
// For each category, fetch toolkits to display in your UI

// ── User picks a toolkit (e.g. Gmail) ────────────────────────────────────────
const userId = "user_123";

// Check if user already has an active connected account
const existing = await composio.connectedAccounts.list({
  userIds: [userId],
  toolkitSlugs: ['gmail'],
  statuses: ['ACTIVE']
});

if (!existing.items.length) {
  // No active connection — initiate OAuth
  const session = await composio.create(userId);
  const req = await session.authorize('gmail');
  // Redirect user to req.redirectUrl → they authorize with their Google account
  return { redirectUrl: req.redirectUrl };
}

// ── Agent runtime ─────────────────────────────────────────────────────────────
const session = await composio.create(userId);
const tools = await session.tools({ toolkits: ['gmail'] });

// Pass tools to your LLM — they are scoped exclusively to user_123's account
// Other users' connected accounts are not accessible in this session
```

---

## Native Tools vs MCP

| | Native Tools | MCP |
|---|---|---|
| Token efficiency | High — load only what you select | Low — loads everything (~55K tokens for 5 servers) |
| Tool interception | Full — log, retry, require approval | Limited by MCP client |
| Per-user scoping | Via `composio.create(user_id)` | Via session URL + headers |
| Best for | Production multi-user apps | Simple integrations, MCP-native platforms |

**Native Tools:**
```typescript
const session = await composio.create("user_123");
const tools = await session.tools({ toolkits: ['gmail'] });
// pass tools to your LLM
```

**MCP:**
```typescript
const session = await composio.create("user_123");
const { url, headers } = session.mcp;
// pass url + headers to your MCP client
```

---

## Key Notes

- `user_id` is your own identifier — Composio never creates accounts for your users, it just stores their connected accounts keyed by whatever string you pass.
- The old term `entityId` in Composio docs is the same as `user_id` in the current API.
- One auth config serves all users of that toolkit — you do not create one per user.
- Connected accounts are one per user per toolkit (or more if the user connects multiple accounts of the same service).
- Composio automatically handles OAuth token refresh — you do not need to manage token expiry.
- Triggers (webhooks/polling) are scoped to connected accounts, not sessions.
