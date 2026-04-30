# User Toolkits Integration — Implementation Plan

## Goal

Give each app user their own set of third-party tool connections (toolkits). Composio is the first provider. The system is provider-agnostic — everything the app cares about goes through a `ToolProvider` interface.

## Architecture

```
ToolProvider interface
  └─ ComposioService (implements it)

UserToolkit (DB record)
  └─ linked to User, holds provider name + opaque providerData JSON

RuntimeUser (functional object, mirrors Session pattern)
  └─ wraps User DB data + UserToolkit[]
  └─ buildAgentTools() → AgentTool[] via provider

AgenticLoopSchema
  └─ toolNames: string[]      ← built-in tools
  └─ toolkitSlugs: string[]   ← user's connected toolkits by slug
```

---

## Phase 1 — ToolProvider interface + shared types

**File: `src/services/toolProviders/toolProvider.ts`**

```ts
interface ProviderToolkitInfo {
  slug: string
  name: string
  description: string
  logo: string
  categories: string[]
  authSchemes: string[]
  noAuth: boolean
}

interface ProviderConnectionRequest {
  externalUserId: string   // connected account ID on provider side (e.g. ca_xxx)
  redirectUrl: string
}

interface ProviderConnection {
  externalUserId: string
  authConfigId: string
  status: 'ACTIVE' | 'INITIATED' | 'INITIALIZING'
  toolkitSlug: string
}

interface ProviderToolSchema {
  slug: string
  name: string
  description: string
  inputParameters: Record<string, unknown>   // JSON Schema
  outputParameters: Record<string, unknown>
  tags: string[]
  version: string
}

interface ProviderToolResult {
  data: unknown
  error: string | null
  successful: boolean
}

interface ToolProvider {
  readonly name: string

  // Discover
  listCategories(): Promise<string[]>
  listToolkits(params: { category?: string }): Promise<ProviderToolkitInfo[]>

  // Auth
  initiateConnection(params: {
    userId: string
    toolkitSlug: string
  }): Promise<ProviderConnectionRequest>

  waitForConnection(params: {
    externalUserId: string
    timeoutMs?: number
  }): Promise<ProviderConnection>

  getConnection(params: {
    userId: string
    toolkitSlug: string
  }): Promise<ProviderConnection | null>

  disconnectAccount(params: {
    externalUserId: string
  }): Promise<void>

  // Schemas
  getToolSchemas(params: {
    externalUserId: string
    authConfigId: string
    limit?: number
  }): Promise<ProviderToolSchema[]>

  // Execute
  executeTool(params: {
    toolSlug: string
    userId: string
    externalUserId: string
    arguments: Record<string, unknown>
  }): Promise<ProviderToolResult>
}
```

---

## Phase 2 — DB model

**New Prisma model `UserToolkit`:**

```prisma
model UserToolkit {
  id           String   @id @default(cuid())
  userId       String
  provider     String                  // 'composio'
  toolkitSlug  String                  // 'github'
  name         String
  description  String
  logo         String
  categories   String[]
  providerData Json                    // opaque: { externalUserId, authConfigId }
  status       String   @default("active")
  connectedAt  DateTime @default(now())
  updatedAt    DateTime @updatedAt

  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, provider, toolkitSlug])
}
```

No `UserToolSchema` table — schemas are always fetched from provider at runtime.

**`providerData` shape per provider (typed at service layer, opaque in DB):**

```ts
// composio
interface ComposioProviderData {
  externalUserId: string   // ca_xxxxx
  authConfigId: string     // ac_xxxxx
}
```

**New repository: `UserToolkitRepository`**

```ts
saveToolkit(params): Promise<UserToolkitData>
getToolkits(userId: string): Promise<UserToolkitData[]>
getToolkit(params: { userId, provider, toolkitSlug }): Promise<UserToolkitData | null>
deleteToolkit(id: string): Promise<void>
```

---

## Phase 3 — ComposioService refactored to implement ToolProvider

Rename/reshape existing `ComposioService` methods to match the interface.
Key renames:
- `connectedAccountId` → `externalUserId` everywhere
- All methods take a single params object (not positional args)

---

## Phase 4 — Provider tool schema → AgentTool conversion

**File: `src/services/toolProviders/toAgentTool.ts`**

```ts
function providerToolToAgentTool(
  schema: ProviderToolSchema,
  toolkit: UserToolkitData,
  provider: ToolProvider,
  userId: string,
): AgentTool

// AgentTool.execute calls provider.executeTool({ toolSlug, userId, externalUserId, arguments })
// AgentTool gets an extra field: toolkitSlug (for filtering in flow)
```

`inputParameters` from `ProviderToolSchema` is already JSON Schema — passed directly as `parameters`.

---

## Phase 5 — RuntimeUser (functional object, mirrors Session)

**File: `src/services/userService/user.ts`**

```ts
class RuntimeUser {
  data: User
  toolkits: UserToolkitData[]
  private app: App

  constructor(data: User, toolkits: UserToolkitData[], app: App)

  get id(): string
  get name(): string
  get timezone(): string

  getToolkit(provider: string, toolkitSlug: string): UserToolkitData | undefined

  // Fetches schemas from provider and converts to AgentTool[]
  // Pass slugs to filter — only those toolkits are included
  async buildAgentTools(toolkitSlugs?: string[]): Promise<AgentTool[]>
}
```

**File: `src/services/userService/userService.ts`**

```ts
class UserService {
  // Loads user + all their toolkits — single call, full runtime object
  async loadUser(userId: string): Promise<RuntimeUser>
}
```

Loading a user always loads their toolkits. No separate boot step needed.

---

## Phase 6 — UserToolkitService (orchestration)

**File: `src/services/userToolkits/userToolkitService.ts`**

```ts
class UserToolkitService {
  // Discovery
  listCategories(provider: string): Promise<string[]>
  listToolkits(provider: string, params: { category?: string }): Promise<ProviderToolkitInfo[]>

  // Connect
  initiateConnection(params: { userId, provider, toolkitSlug }): Promise<{ redirectUrl, externalUserId }>
  completeConnection(params: { userId, provider, toolkitSlug, externalUserId }): Promise<UserToolkitData>
    // → waitForConnection → save to DB

  // Manage
  getUserToolkits(userId: string): Promise<UserToolkitData[]>
  removeToolkit(params: { userId, userToolkitId }): Promise<void>
    // → provider.disconnectAccount + DB delete
}
```

---

## Phase 7 — AgenticLoopSchema extension

```ts
interface AgenticLoopSchema {
  toolNames: string[]       // e.g. ['bash', 'read', 'edit']   — built-in tools
  toolkitSlugs: string[]    // e.g. ['github', 'gmail']        — user's connected toolkits
  skillNames: string[]
  ...
}
```

In `AgenticLoopFlow.createSession` / `restoreSession`:

```ts
const user = await app.services.userService.loadUser(userId)
const userTools = await user.buildAgentTools(schema.toolkitSlugs)
const builtInTools = app.tools.getSlice(schema.toolNames)
session.tools = [...builtInTools, ...userTools]
```

`buildAgentTools` filters by `toolkitSlugs` internally. Empty array = no user tools injected.

---

## File Structure

```
src/
  services/
    toolProviders/
      toolProvider.ts          ← ToolProvider interface + all shared types
      toAgentTool.ts           ← providerToolToAgentTool()
      index.ts                 ← provider registry (name → ToolProvider instance)
    composio/
      composioService.ts       ← refactored to implement ToolProvider
    userToolkits/
      userToolkitService.ts
      index.ts
    userService/
      user.ts                  ← RuntimeUser
      userService.ts           ← loadUser()
      index.ts
  data/
    userToolkitRepository/
      index.ts
      types.ts                 ← UserToolkitData
  agents/
    agentictLoop/
      flow.ts                  ← toolkitSlugs added, user tools injected
```

---

## Implementation Order

1. `src/services/toolProviders/toolProvider.ts` — interface + types
2. Refactor `ComposioService` to implement `ToolProvider`
3. Prisma migration — `UserToolkit` model
4. `UserToolkitRepository` + `UserToolkitData` type
5. `src/services/toolProviders/toAgentTool.ts`
6. `RuntimeUser` + `UserService`
7. `UserToolkitService`
8. Wire into `Services` + `App`
9. `AgenticLoopSchema` — add `toolkitSlugs`, inject in flow
10. API endpoints — discovery, initiate auth, list user toolkits, remove toolkit
