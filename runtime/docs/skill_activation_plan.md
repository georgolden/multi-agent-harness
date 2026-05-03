# Skill Activation Plan

## Overview

Extend the runtime with:
1. A `skill` tool that loads a skill and activates it on the session
2. Session-level enabled-skill tracking persisted to DB
3. `SandboxService.createSandboxedTools()` — sandboxed bash/read/edit/write
4. `session.addOrReplaceAgentTools()` — conflict-safe tool registration

---

## What the skill tool does

The `skill` tool is the activation trigger. When the agent calls `skill({ name: "foo" })`:

1. Loads SKILL.md content + file list (informational)
2. Appends SKILL.md to the session system prompt
3. Persists `{ name }` to `enabledSkills` on the session in DB
4. If `skill.runtime` is defined:
   - Calls `SandboxService.createSkillSession({ session, skill })`
   - Calls `SandboxService.createSandboxedTools(execSession)` to get sandboxed bash/read/edit/write
   - Calls `session.addOrReplaceAgentTools([...sandboxedTools])` — replaces any existing bash/read/edit/write with the sandboxed variants
5. Returns skill content to the LLM plus a note that sandboxed tools are now active

Loading IS activation — no separate "activate" call needed.

---

## Part 1 — Sandboxed tools factory in `SandboxService`

**File:** `runtime/src/services/sandbox/index.ts`

New public method:

```ts
createSandboxedTools(execSession: SkillExecutionSession): {
  bash: AgentTool,
  read: AgentTool,
  edit: AgentTool,
  write: AgentTool,
}
```

Each tool is built using the existing `create*Tool(cwd, { operations })` pattern. The operations
implementations delegate to the realm host path instead of the real host filesystem.

### bash

Uses `BashOperations`. The sandboxed `exec` calls:
```ts
sandbox.executeSkillCommands({ session, commands: [command] })
```
The `cwd` parameter passed by the tool is ignored — the container uses its own `containerWorkingDir`.
stdout/stderr are streamed back through the existing result structure.

### read

Uses `ReadOperations`. All path operations are rewritten to `<realmHostPath>/<filename>`.
Implements `readFile`, `access`, `readdir`, `stat` on the realm folder.
The bind-mount means the container sees the same files at `containerWorkingDir/<filename>`.

### edit

Uses `EditOperations`. `readFile`, `writeFile`, `access` operate on `<realmHostPath>/<filename>`.
The sync cycle in `executeSkillCommands` propagates changes back to the session.

### write

Uses `WriteOperations`. Writes land in the realm folder, picked up by sync-out.

**Path translation rule:** strip any absolute prefix and resolve relative to `realmHostPath`.
Paths outside the realm are rejected with an error.

---

## Part 2 — Skill tool

**File:** `runtime/src/tools/skill.ts` (NEW)

```ts
export function createSkillTool(
  skills: Skills,
  sandbox: SandboxService,
  session: Session,
): AgentTool
```

**Input schema:** `{ name: string }`

**execute:**
1. `const skill = skills.getSkill(name)` — throw with available names if not found
2. Guard: already enabled on this session → return "already active"
3. `const md = await skill.readSkillMd()`
4. `const files = await skill.readContent()` — cap at 10, format as `<file>` tags
5. Build new system prompt = `${session.systemPrompt}\n\n<skill name="${name}">\n${md}\n</skill>`
6. `await session.upsertSystemPrompt(newPrompt)`
7. `await session.enableSkill(name, { skill, sandboxSession: null })` — DB persist + in-memory
8. If `skill.runtime`:
   - `const execSession = await sandbox.createSkillSession({ session, skill })`
   - Update in-memory entry: `{ skill, sandboxSession: execSession }`
   - `const sandboxedTools = sandbox.createSandboxedTools(execSession)`
   - `session.addOrReplaceAgentTools([sandboxedTools.bash, sandboxedTools.read, sandboxedTools.edit, sandboxedTools.write])`
9. Return `<skill_content name="...">` wrapper with md body, base dir, file list, and (if sandboxed) a note that bash/read/edit/write now operate inside the skill sandbox

---

## Part 3 — Session changes

**File:** `runtime/src/services/sessionService/session.ts`

### New private field

```ts
private _enabledSkills: Map<string, EnabledSkill> = new Map()
```

### New / changed methods

```ts
// Replaces tools by name — adds if not present, replaces if name already exists
addOrReplaceAgentTools(tools: AgentTool[]): void

// Called by skill tool — updates DB record + stores in-memory entry
async enableSkill(name: string, entry: EnabledSkill): Promise<this>

// Cleanup sandbox session, remove from DB, remove from in-memory map, strip prompt block
async disableSkill(name: string, sandbox?: SandboxService): Promise<this>

// Re-hydrate in-memory map after crash-recovery from DB enabledSkills records
async rehydrateEnabledSkills(skills: Skills, sandbox?: SandboxService): Promise<this>

// Cleanup all sandbox sessions — call on session teardown
async cleanupSkillSessions(sandbox: SandboxService): Promise<void>
```

### Accessors

```ts
get enabledSkillRecords(): EnabledSkillRecord[]     // from sessionData (DB-backed)
get enabledSkills(): EnabledSkill[]                 // live in-memory entries
getEnabledSkill(name: string): EnabledSkill | undefined
```

### `addOrReplaceAgentTools` logic

```ts
addOrReplaceAgentTools(tools: AgentTool[]): void {
  for (const tool of tools) {
    const idx = this.tools.findIndex(t => t.name === tool.name)
    if (idx >= 0) this.tools[idx] = tool
    else this.tools.push(tool)
  }
}
```

### `rehydrateEnabledSkills` logic

Iterates `sessionData.enabledSkills` (from DB), looks up each skill by name via `skills.getSkill(name)`,
re-injects SKILL.md into system prompt, re-creates sandbox session if `skill.runtime` is defined,
re-creates sandboxed tools, calls `addOrReplaceAgentTools`.

### `disableSkill` logic

1. Get entry from `_enabledSkills` — return early if not found
2. If `entry.sandboxSession && sandbox`: `await sandbox.cleanupSkillSession({ session: this })`
3. `this._enabledSkills.delete(name)`
4. `await this.app.data.flowSessionRepository.disableSkill(this.id, name)`
5. Strip `<skill name="${name}">...</skill>` block from system prompt, call `upsertSystemPrompt`

---

## Part 4 — Repository

**File:** `runtime/src/data/flowSessionRepository/index.ts`

- **`mapRow`:** add `enabledSkills: (row.enabledSkills as EnabledSkillRecord[]) || []`
- **`createSession`:** persist `enabledSkills: params.enabledSkills ?? []`
- **`enableSkill(sessionId, name)`:** append `{ name }` if not already present, update DB, emit bus event
- **`disableSkill(sessionId, name)`:** filter out, update DB, emit bus event

---

## Part 5 — Types

**File:** `runtime/src/services/sessionService/types.ts`

```ts
export interface EnabledSkillRecord {
  name: string
}

export interface EnabledSkill {
  skill: Skill                              // from Skills class (in-memory only)
  sandboxSession: SkillExecutionSession | null  // from SandboxService (in-memory only)
}
```

Add to `SessionData`:
```ts
enabledSkills: EnabledSkillRecord[]
```

Add to `CreateSessionParams`:
```ts
enabledSkills?: EnabledSkillRecord[]
```

---

## Part 6 — Prisma schema + migration

**File:** `runtime/prisma/schema.prisma`

Add to `FlowSession` model:
```prisma
enabledSkills Json @default("[]") @map("enabled_skills")
```

Then run:
```
npx prisma migrate dev --name add_enabled_skills
```

---

## Part 7 — Tool registry

**File:** `runtime/src/tools/index.ts`

- Export `createSkillTool`
- `Tools` constructor accepts optional `skills?: Skills`, `sandbox?: SandboxService`, `session?: Session`
- If all three provided, adds `skill: createSkillTool(skills, sandbox, session)` to `toolsMap`

---

## File summary

| File | Change |
|---|---|
| `runtime/prisma/schema.prisma` | Add `enabledSkills Json @default("[]")` to `FlowSession` |
| `runtime/prisma/migrations/…` | New migration |
| `runtime/src/services/sessionService/types.ts` | `EnabledSkillRecord`, `EnabledSkill`, extend `SessionData` + `CreateSessionParams` |
| `runtime/src/data/flowSessionRepository/index.ts` | `mapRow`, `createSession`, `enableSkill`, `disableSkill` |
| `runtime/src/services/sessionService/session.ts` | `_enabledSkills` map, `addOrReplaceAgentTools`, 4 new methods, accessors |
| `runtime/src/services/sandbox/index.ts` | Add `createSandboxedTools(execSession)` method |
| `runtime/src/tools/skill.ts` | NEW — `createSkillTool(skills, sandbox, session)` |
| `runtime/src/tools/index.ts` | Export skill tool; `Tools` accepts skills/sandbox/session |
