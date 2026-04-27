# Sandbox Realm Bind-Mount Redesign — Implementation Plan

Status: planned, awaiting implementation.
Scope: rewrite of `runtime/src/services/sandbox/` and supporting types so that skill executions run inside containers backed by a per-session **host realm folder** with bind-mounted context files/folders, and so that skill-execution state stays bidirectionally synced with the flow `Session` across long-running sessions.

This document is intentionally exhaustive: every concept, decision, file, type, behavior, and test case derived from the planning conversation is recorded here so the implementation can be performed without re-deriving anything.

---

## 1. Background and motivation

### 1.1 Two distinct session objects

The runtime has two completely separate concepts of "session" that must not be conflated:

- **Session** (formerly `FlowSession`) — the agent flow runtime object defined in `runtime/src/services/sessionService/session.ts`. Backed by `flowSessionRepository`. Long-lived. Source of truth for: `tempFiles`, `contextFiles`, `contextFoldersInfos`, plus all the agent-flow state (messages, status, schemas, etc.). Mutated by user actions (uploads, new context attachments) and by other parts of the flow during execution.
- **SkillExecutionSession** — sandbox-internal object created by `SandboxService.createSkillSession(session, skill)`. Owns a **host realm folder** plus a container. Its sole job: keep its host realm folder synced with the parent flow `Session` and propagate skill-produced artifacts back into the flow `Session`. It holds a reference to the flow `Session` but is its own independent lifecycle.

A single flow `Session` may have at most one live `SkillExecutionSession` at a time (keyed by `session.id` inside the sandbox).

### 1.2 Why bind mounts instead of `podman cp`

The current sandbox at `runtime/src/services/sandbox/index.ts` is an early proof-of-concept that uses `podman cp` to copy files into a long-lived sleeping container. Problems:

- Copying large host files/folders is slow and doubles disk usage.
- Edits inside the container don't propagate back to the host without an explicit copy-out step (which doesn't exist).
- Sync between the host file and the in-container copy is brittle.

Bind mounts (`podman run --mount type=bind,source=...,target=...`) expose host paths directly inside the container. Edits flow to the host immediately. Zero copy. The constraint: **mounts must be declared at container `run` time** — they cannot be added to a running container.

### 1.3 Why symlinks don't work

A symlink stored at `<realm>/foo.docx → /home/user/Documents/foo.docx` is just a string. The kernel resolves it inside the **container's** mount namespace. There is no `/home/user/` inside the container, so the open fails. Hardlinks fail too: same-filesystem only, files only (not folders), and break across filesystems with `EXDEV`. Bind mounts are the only viable mechanism.

### 1.4 Why bind-mount onto a flat session folder

The agent inside the container must see all relevant files (skill files, temp files, context files, context folders) **flat at its working directory**, with no organizing subfolders forced by the runtime. This is a hard requirement — the agent will get confused about paths otherwise.

The trick: bind mounts compose. A single `--mount` exposes the realm folder at `/workspace/`, and additional `--mount` flags can place individual host files/folders onto placeholders inside that folder. From the skill's perspective it's one flat directory; under the hood each context entry is its own mount.

### 1.5 Why the pool simplifies to a counter

The original sandbox keeps a pool of pre-warmed containers and reuses them across sessions to amortize startup. Container startup is actually cheap (~50–300 ms). The real work is image build (already a one-time cost handled by `runtime/src/sandbox/build.ts`). The pool's true value is **resource throttling** — capping how many heavy containers (LibreOffice, Playwright) run concurrently so the host doesn't get overwhelmed.

This redesign collapses the pool concept to: **a counter capped per runtime, with a queue when full**. No container reuse across sessions. Each exclusive-mode session gets a fresh container, destroyed on cleanup.

### 1.6 Why two modes (shared / exclusive)

- Lightweight runtimes (the current `generic`) safely support many concurrent skill executions in one container. Spawning a fresh container per session for these would be wasteful. → **shared mode**: one long-lived container per runtime, sessions live as subfolders inside a shared realm root, the sandbox throttles concurrent **command executions** with a semaphore.
- Heavy runtimes (`office`, `pdf`, `web-testing`) and any session that needs per-session bind-mounted context files/folders need their own container. → **exclusive mode**: one container per session, mounts baked at spawn, container destroyed at cleanup, the sandbox throttles concurrent **container spawns** by capping live container count.

Both modes are uniform from the public API perspective.

### 1.7 Why session ↔ realm sync runs around every command

A flow `Session` is long-running. Between two `executeSkillCommands` calls:

- The user may have uploaded a new temp file (`session.writeTempFile(...)`).
- The flow may have attached new context files/folders (`session.addContextFiles(...)`, `session.addContextFoldersInfos(...)`).
- The flow may have removed entries.

And between calls the skill may have:

- Created new files inside the realm.
- Modified existing temp files.
- Deleted files.
- Modified bind-mounted context files (already on host via the mount).
- Modified copied-in context files/folders (need to be flushed back to host).

So `executeSkillCommands` does three things atomically per call (under a per-session mutex):
1. **sync-in**: realm ← flow Session.
2. Execute commands.
3. **sync-out**: flow Session ← realm.

---

## 2. Concepts

### 2.1 Host realm layout

```
~/.agi/sandbox-realm/                       (SANDBOX_REALM_ROOT, configurable via constructor for tests)
  <runtimeName>/
    shared/                                 (only present for mode=shared)
      <sessionId-A>/                        agent's working dir for session A
        SKILL.md
        helpers/                            (skill files)
        upload-from-user.png                (a tempFile)
      <sessionId-B>/
        ...
    exclusive/                              (only present for mode=exclusive)
      <sessionId-C>/                        mounted as /workspace in C's container
        SKILL.md
        report.docx                         (placeholder for bind-mounted context file)
        project-folder/                     (placeholder for bind-mounted context folder)
        new-output.md                       (skill-created temp file → synced to session)
        .meta/
          path-map.json                     (host-side bookkeeping; not exposed to skill)
```

Notes:
- For shared runtimes, every session is a subfolder of `<realmRoot>/<runtime>/shared/`. The shared container has `<realmRoot>/<runtime>/shared` bind-mounted to `/realm`. Each session's working dir inside the container is `/realm/<sessionId>`.
- For exclusive runtimes, every session is a subfolder of `<realmRoot>/<runtime>/exclusive/`. Each session's container has only that session's folder mounted, at `/workspace`. Working dir inside the container is `/workspace`.
- The `.meta/path-map.json` records `containerPath → hostPath` for context entries. It is a host-side bookkeeping file only and is NOT exposed to the skill.

### 2.2 Two sandbox modes

| Mode | Realm mount inside container | Container instances | `limit` semantics |
|---|---|---|---|
| **shared** | `<realmRoot>/<runtime>/shared/` → `/realm` | **one** long-lived container per runtime, lazy-spawned on first session | max concurrent command executions (semaphore) |
| **exclusive** | `<realmHostPath>` → `/workspace`, plus per-context binds | **one per session**, destroyed on cleanup | max live containers (queue) |

### 2.3 Mounted vs. copied context entries

Each context file or folder lives in the realm in one of two states:

- **mounted** — declared at container spawn via `--mount type=bind`. Edits flow to the host automatically. Zero copy. Available only for entries known **at create time**.
- **copied** — physical copy in the realm (file copy or recursive folder copy), with a recorded `hostPath`. Used for entries added **mid-session** (after the container is already running). On sync-out, the realm content is flushed back to the host path.

Once an entry is in either state, it stays in that state for the life of the skill execution. Mounted entries never become copied; copied entries never become mounted.

### 2.4 Skill files vs. user files inside the realm

To know whether a file in the realm came from the skill (input, ignore on sync-out) or from the session/user (output, sync back), the sandbox tracks a per-session `skillFileNames: Set<string>`. The set is populated once at create time from `await skill.readContent()`. Anything not in `skillFileNames` and not a context-mount placeholder name is treated as belonging to the session's `tempFiles`.

### 2.5 Realm flatness — hard requirement

The realm folder is flat at the top level. Skill files, temp files, context files, and context folders all appear as direct children. There must be no organizing subdirectories imposed by the runtime, because the agent works in pwd and gets confused otherwise.

Skill output: if the skill creates a top-level subdirectory under the realm, sync-out **ignores it with a warning** (top-level files only). `tempFiles` is a flat `{name, content}` list and cannot represent a tree. If a skill needs to emit a tree, it should write into a context folder, where the whole subtree is mirrored back to host.

---

## 3. Sync rules (locked, per user instruction)

Quoting the user's final ruleset, formalized:

### 3.1 At `createSkillSession` (initial population of the realm)

- **A. Temp files (`session.tempFiles`)**: for each entry, write `<realm>/<name>` if missing or content differs.
- **B. Context files (`session.contextFiles`)**: mount each one. Create empty placeholder file in the realm; bake `--mount type=bind,source=<hostPath>,target=/workspace/<dedupedName>` into the spawn argv.
- **C. Context folders (`session.contextFoldersInfos`)**: mount each one. Create empty placeholder dir in the realm; bake `--mount type=bind,source=<hostPath>,target=/workspace/<dedupedName>` into the spawn argv.

(Shared-mode sessions cannot have any context entries — see §6.)

### 3.2 At `executeSkillCommands` — sync-in (realm ← session, before commands)

- **A. Temp files**: realm reflects current `session.tempFiles`. Add new, update changed, delete those removed from the session (only deleting realm files that the sandbox itself wrote, i.e., names tracked in `knownTempFileSnapshot` and not in `skillFileNames` / context placeholders).
- **B. Context files**: for any new path that wasn't in `contextEntries`, **copy** the host file into the realm and record `state: 'copied'`. (Cannot mount on a running container.) For entries removed from the session: if `state === 'copied'`, unlink from realm; if `state === 'mounted'`, **ignore** the deletion request (cannot unmount; per user decision).
- **C. Context folders**: same logic as B, with recursive copy. Removed-and-mounted folders are **emptied** host-side (delete the folder's contents, leave the directory as a still-mounted empty dir; per user decision).

### 3.3 After commands run — sync-out (session ← realm)

- **A. Temp files**: **realm is authoritative.** Walk top level of `<realm>/`. Skip `.meta/`, every name in `skillFileNames`, every `realmName` in `contextEntries`, and every subdirectory (top-level files only, with a warning logged for any subdirectory found that isn't a context folder placeholder).
  - For each remaining file, read as `Buffer`. If it's not in `session.tempFiles` or its content differs, call `await session.writeTempFile({ name, content })`.
  - For each name in `session.tempFiles` (per the last snapshot) that's no longer present at the top level, call `await session.removeTempFile(name)`.
- **B. Context files**: for every entry with `state === 'copied'` and `type === 'file'`, if `<realm>/<realmName>` differs from `<entry.hostPath>`, write realm → host. Mounted files: nothing to do (mount handles persistence).
- **C. Context folders**: for every entry with `state === 'copied'` and `type === 'folder'`, **rsync-style mirror with deletions** from `<realm>/<realmName>/` → `<entry.hostPath>/`. Additions, modifications, and removals all applied to the host. Mounted folders: nothing to do.

### 3.4 At `cleanupSkillSession`

**No final sync.** Per user decision, cleanup just wipes everything. The user will manually trigger cleanup during testing; advanced cleanup triggers (auto-cleanup at session-end, etc.) are deferred.

- `rm -rf <realmHostPath>` on host.
- Exclusive: `podman rm -f <container.id>`, remove from set, drain queue.
- Shared: leave container alive; just drop the session subfolder.
- Drop internal state.

---

## 4. Constants

New file `runtime/src/sandbox/constants.ts`:

```ts
import path from 'node:path';
import os from 'node:os';

export const SANDBOX_REALM_ROOT = path.join(os.homedir(), '.agi/sandbox-realm');
```

Production code uses `SANDBOX_REALM_ROOT`. Tests pass an override into the `SandboxService` constructor so they don't write to the user's real home.

---

## 5. Type changes

### 5.1 `runtime/src/sandbox/types.ts` — full rewrite

```ts
export type SandboxMode = 'shared' | 'exclusive';
export type NetworkMode = 'none' | 'slirp4netns';

export interface RuntimeConfig {
  name: string;                // e.g. 'generic', 'office', 'pdf', 'web-testing'
  image: string;               // '<name>-runtime:latest'
  mode: SandboxMode;           // shared = one container per runtime; exclusive = one per session
  limit: number;               // shared: max concurrent executions; exclusive: max live containers
  network: NetworkMode;
  executionTimeout: number;    // ms per executeSkillCommands batch
}

export interface SkillContextMount {
  hostPath: string;            // host absolute path
  name: string;                // basename inside container; deduped at build time
  type: 'file' | 'folder';
}
```

**Removed from existing types**: `PoolConfig`, `RuntimeType` (string-literal union). Runtimes are looked up by `string`.

### 5.2 `runtime/src/services/sessionService/types.ts` — widen content type

```ts
// Was:
tempFiles: Array<{ name: string; content: string }>;

// Becomes:
tempFiles: Array<{ name: string; content: string | Buffer }>;
```

This is required because skills will write binary outputs (e.g. `.docx`, `.png`) to the realm and the sandbox must round-trip those faithfully without encoding/serialization. Per user: "if binary file it will stays binary if it will be transformed in some other string encoding it will lose its content for sure docx example is the nice thing here ... we must here be accurate without encoding/serialization."

### 5.3 `runtime/src/services/sessionService/session.ts` — additions

Add a method:

```ts
async removeTempFile(name: string): Promise<this> {
  const tempFiles = await this.app.data.flowSessionRepository.removeTempFile(this.sessionData.id, name);
  this.sessionData.tempFiles = tempFiles;
  return this;
}
```

`writeTempFile` continues to accept `{ name; content: string | Buffer }` (signature implicitly widened by §5.2).

### 5.4 `runtime/src/data/flowSessionRepository/index.ts` — additions and changes

Current `writeTempFile` (lines 323–339) signature uses `content: string`. Widen it to `string | Buffer`.

**Storage layer concern**: the repository persists `tempFiles` to a database (`client.flowSession.update({ ... data: { tempFiles: tempFiles as any } })`). If the underlying column is JSON, `Buffer` cannot be JSON-serialized natively. The storage layer must encode `Buffer` → base64 string with a marker (e.g., `{ name, content, encoding: 'base64' }`) on write, and decode back to `Buffer` on read. This encoding/decoding happens **only at the storage boundary**. The Session API surface continues to expose `string | Buffer` to callers — sandbox and other consumers see `Buffer` if it was written as a `Buffer`.

Add `removeTempFile(sessionId: string, name: string): Promise<Array<{ name: string; content: string | Buffer }>>`:

```ts
async removeTempFile(sessionId: string, name: string): Promise<Array<{ name: string; content: string | Buffer }>> {
  const session = await this.getSession(sessionId);
  if (!session) throw new Error(`Session '${sessionId}' not found`);
  const tempFiles = (session.tempFiles ?? []).filter((f) => f.name !== name);
  const client = this._client(sessionId) as any;
  await client.flowSession.update({ where: { id: sessionId }, data: { tempFiles: tempFiles as any } });
  this.app.infra.bus.emit('flowSession:tempFileRemoved', { sessionId, name, tempFiles });
  console.log(`[SessionDataRepository] Removed temp file '${name}' from session '${sessionId}'`);
  return tempFiles;
}
```

The repository's row-reading code at `runtime/src/data/flowSessionRepository/index.ts:134`:

```ts
tempFiles: (row.tempFiles as { name: string; content: string }[]) || [],
```

must become:

```ts
tempFiles: (row.tempFiles as Array<{ name: string; content: string | Buffer; encoding?: 'base64' }>)
  .map((f) => f.encoding === 'base64' ? { name: f.name, content: Buffer.from(f.content as string, 'base64') } : { name: f.name, content: f.content as string }) || [],
```

(or equivalent — implementer decides exact decode logic; the contract is: round-trip preserves `Buffer` vs `string` identity.)

---

## 6. `SandboxService` public API (new)

`runtime/src/services/sandbox/index.ts` — full rewrite. Public surface:

```ts
class SandboxService {
  constructor(app: App, opts?: { cwd?: string; realmRoot?: string });

  start(): Promise<void>;
  stop(): Promise<void>;

  createSkillSession(opts: { session: Session; skill: Skill }): Promise<SkillExecutionSession>;
  executeSkillCommands(opts: { session: Session; commands: string[] }): Promise<ExecuteCommandsResult>;
  cleanupSkillSession(opts: { session: Session }): Promise<void>;

  getRuntimeForSkill(skillName: string): string | null;
  getRuntimeConfigs(): Map<string, RuntimeConfig>;
}

export interface SkillExecutionSession {
  id: string;                 // === session.id
  runtimeName: string;
  mode: SandboxMode;
  realmHostPath: string;
  containerWorkingDir: string;  // /realm/<id> (shared) or /workspace (exclusive)
}

export interface ExecuteCommandsResult {
  results: Array<{ command: string; stdout: string; stderr: string }>;
}
```

Note: callers do NOT pass a `sessionId: string`. They pass the runtime `Session` object (the OOP-style runtime representation of the row). The sandbox keys its internal state by `session.id` but the API surface is in terms of `Session`. Per user: "I expect to work with runtime objects instead of dealing with repositories that are out of service scope."

The `Skill` type comes from `runtime/src/skills/index.ts`:
```ts
export type Skill = {
  location: string;
  name: string;
  description: string;
  runtime?: string;            // resolved from skill-runtimes.json
  readSkillMd: () => Promise<string>;
  readContent: () => Promise<SkillFile[]>;
};
export type SkillFile = { path: string; content: string };
```

---

## 7. Internal state

```ts
type ContextEntryState = 'mounted' | 'copied';

interface ContextEntry {
  hostPath: string;
  realmName: string;          // basename inside the realm folder
  type: 'file' | 'folder';
  state: ContextEntryState;
}

interface SkillExecutionState {
  session: Session;                            // FlowSession reference (held for sync calls)
  skill: Skill;
  runtimeName: string;
  mode: SandboxMode;
  container: Container;
  realmHostPath: string;
  containerWorkingDir: string;                 // /realm/<id> | /workspace

  skillFileNames: Set<string>;                 // exclude on temp-file sync-out
  contextEntries: Map<string, ContextEntry>;   // key = hostPath
  knownTempFileSnapshot: Map<string, Buffer>;  // last seen content; for sync-in deletion detection

  syncMutex: AsyncLock;                        // serialize sync+exec per session
}

interface Container {
  id: string;
  runtimeName: string;
  mode: SandboxMode;
  // For exclusive containers: list of mounts baked at spawn (for debugging only).
  // For shared containers: tracks active session count if needed.
}
```

Service-level state:

```ts
private sharedContainers: Map<string /*runtimeName*/, Container>;
private exclusiveContainers: Map<string /*runtimeName*/, Set<Container>>;
private activeExecutions: Map<string /*runtimeName*/, number>;          // shared-mode semaphore
private executionQueue: Array<{ runtimeName: string; resolve: () => void; reject: (e: Error) => void }>;
private containerQueue: Array<{ runtimeName: string; spawn: () => Promise<Container>; resolve: (c: Container) => void; reject: (e: Error) => void }>;
private sessions: Map<string /*session.id*/, SkillExecutionState>;
private runtimeConfigs: Map<string, RuntimeConfig>;
private skillRuntimes: Record<string, string>;
private realmRoot: string;
private isStarted: boolean;
```

`AsyncLock` can be a tiny inline class — a chain of pending promises per key. No external dep needed.

---

## 8. Lifecycle behavior

### 8.1 `start()`

1. Verify `podman --version`.
2. Load runtime configs: read every `<sandboxDir>/<name>/config.json` (where `sandboxDir = <cwd>/src/sandbox/runtimes`).
3. Load `skill-runtimes.json` from `<cwd>/src/skills/skill-runtimes.json`.
4. `mkdirp <realmRoot>`.
5. For each runtime: `mkdirp <realmRoot>/<runtimeName>/<mode>/`.
6. Initialize `activeExecutions[runtimeName] = 0` for every runtime (used only by shared mode).
7. **No container warm-up** — containers are spawned lazily.
8. Set `isStarted = true`.

### 8.2 `stop()`

1. Reject every pending entry in `executionQueue` and `containerQueue` with an `Error('SandboxService is stopping')`.
2. For every shared container (`sharedContainers.values()`): `podman rm -f <id>`.
3. For every exclusive container (`exclusiveContainers.values().flat()`): `podman rm -f <id>`.
4. For every runtime: `rm -rf <realmRoot>/<runtimeName>/<mode>/<*>` (delete session subfolders, leave the parent dirs).
5. Clear all maps. Set `isStarted = false`.

### 8.3 `createSkillSession({ session, skill })`

1. Throw if `!isStarted`.
2. `runtimeName = skill.runtime`. Throw `Error('Skill X has no runtime')` if undefined. Throw `Error('Unknown runtime: ...')` if not in `runtimeConfigs`.
3. `mode = config.mode`.
4. Throw `Error('Session ${session.id} already has a SkillExecutionSession')` if `sessions.has(session.id)`.
5. Compute `realmHostPath = <realmRoot>/<runtimeName>/<mode>/<session.id>/`. `mkdirp` it.
6. Read skill files: `const files = await skill.readContent()`. For each, write to `<realmHostPath>/<basename(file.path)>`. Track basenames in `skillFileNames`. (Skills may have files in subfolders relative to `skill.location`; per the realm-flatness requirement, files are written **flat** at their basename. Collisions among skill file basenames are unlikely; if they occur, this implementation will throw — skills should not have duplicate-basename files.)
7. **Temp files** (rule 3.1.A): for each `f ∈ session.tempFiles`, write `<realmHostPath>/<f.name>` if missing or its content (`Buffer.from(content)` if string) differs. Populate `knownTempFileSnapshot[name] = Buffer.from(content)`.
8. **Context files** (rule 3.1.B): for each `cf ∈ session.contextFiles`:
   - `realmName = dedupe(basename(cf.path), usedNames)` where `usedNames` is the union of skill file basenames, temp file names, and previously-allocated context names. Dedup pattern: `name.dup.N.ext` (e.g., `report.dup.1.docx`).
   - Create empty placeholder file at `<realmHostPath>/<realmName>` (just `touch`).
   - Record `contextEntries.set(cf.path, { hostPath: cf.path, realmName, type: 'file', state: 'mounted' })`.
9. **Context folders** (rule 3.1.C): for each `cfo ∈ session.contextFoldersInfos`:
   - `realmName = dedupe(basename(cfo.path), usedNames)`.
   - `mkdirp <realmHostPath>/<realmName>` (empty dir placeholder).
   - Record `contextEntries.set(cfo.path, { hostPath: cfo.path, realmName, type: 'folder', state: 'mounted' })`.
10. Write `<realmHostPath>/.meta/path-map.json` with `{ "<containerWorkingDir>/<realmName>": "<hostPath>" }` for every context entry.
11. Acquire container per mode:
    - **shared**: `getOrSpawnSharedContainer(runtimeName)` — lazy single instance. If `contextEntries.size > 0`, throw `Error('Shared runtime cannot have context mounts')`.
    - **exclusive**: `acquireExclusiveContainer(runtimeName, realmHostPath, contextEntries)` — capped by `config.limit`, queued if full. Spawns a fresh container with the full mount set baked in.
12. Compute `containerWorkingDir`:
    - shared: `/realm/<session.id>`.
    - exclusive: `/workspace`.
13. Create `SkillExecutionState` and store in `sessions.set(session.id, state)`.
14. Return the public `SkillExecutionSession` handle.

### 8.4 `executeSkillCommands({ session, commands })`

```
state = sessions.get(session.id)
if (!state) throw new Error(`No skill session for ${session.id}`)

await state.syncMutex.acquire()
try {
  await this.syncRealmFromSession(state)
  if (state.mode === 'shared') {
    await this.acquireExecutionSlot(state.runtimeName, config.limit)
  }
  try {
    const results = await this.runCommands(state, commands)
    return { results }
  } finally {
    if (state.mode === 'shared') {
      this.releaseExecutionSlot(state.runtimeName)
    }
  }
} finally {
  await this.syncSessionFromRealm(state)  // runs even on command failure/timeout, per user rule
  state.syncMutex.release()
}
```

(Note: sync-out runs in `finally` because user said sync-out happens "after commands were executed or exited with timeout".)

### 8.5 `syncRealmFromSession(state)` — sync-in

**Temp files** (rule 3.2.A):
```
current = new Map(state.session.tempFiles.map(f => [f.name, toBuffer(f.content)]))

for ([name, contentBuf] of current) {
  realmPath = join(realmHostPath, name)
  if (!exists(realmPath) || readFile(realmPath).compare(contentBuf) !== 0) {
    writeFile(realmPath, contentBuf)
  }
}

for (name of state.knownTempFileSnapshot.keys()) {
  if (!current.has(name)
      && !state.skillFileNames.has(name)
      && !contextRealmNames(state).has(name)) {
    unlinkIfExists(join(realmHostPath, name))
  }
}

state.knownTempFileSnapshot = current
```

**Context files** (rule 3.2.B):
```
currentContextFilePaths = new Set(state.session.contextFiles.map(cf => cf.path))
currentContextFolderPaths = new Set(state.session.contextFoldersInfos.map(cfo => cfo.path))

for (cf of state.session.contextFiles) {
  if (!state.contextEntries.has(cf.path)) {
    realmName = dedupe(basename(cf.path), allUsedNames(state))
    cp(cf.path, join(realmHostPath, realmName))
    state.contextEntries.set(cf.path, { hostPath: cf.path, realmName, type: 'file', state: 'copied' })
  }
}

for ([hostPath, entry] of state.contextEntries) {
  if (entry.type === 'file' && !currentContextFilePaths.has(hostPath)) {
    if (entry.state === 'copied') {
      unlinkIfExists(join(realmHostPath, entry.realmName))
      state.contextEntries.delete(hostPath)
    } // else: state === 'mounted' — IGNORE (cannot unmount)
  }
}
```

**Context folders** (rule 3.2.C):
```
for (cfo of state.session.contextFoldersInfos) {
  if (!state.contextEntries.has(cfo.path)) {
    realmName = dedupe(basename(cfo.path), allUsedNames(state))
    cpRecursive(cfo.path, join(realmHostPath, realmName))
    state.contextEntries.set(cfo.path, { hostPath: cfo.path, realmName, type: 'folder', state: 'copied' })
  }
}

for ([hostPath, entry] of state.contextEntries) {
  if (entry.type === 'folder' && !currentContextFolderPaths.has(hostPath)) {
    if (entry.state === 'copied') {
      rmRfIfExists(join(realmHostPath, entry.realmName))
      state.contextEntries.delete(hostPath)
    } else {
      // state === 'mounted' — empty the host folder (per user decision)
      // Cannot unmount, so we keep the placeholder dir mounted but clear contents on host:
      emptyDirectory(hostPath)  // rm -rf of all children, keep the directory itself
    }
  }
}
```

### 8.6 `runCommands(state, commands)`

```
results = []
for (cmd of commands) {
  try {
    const { stdout, stderr } = await execFileAsync(
      'podman',
      ['exec', '-w', state.containerWorkingDir, state.container.id, 'bash', '-c', cmd],
      { timeout: config.executionTimeout, maxBuffer: <reasonable, e.g. 16MB> }
    )
    results.push({ command: cmd, stdout, stderr })
  } catch (err) {
    const timedOut = err.killed === true
    results.push({
      command: cmd,
      stdout: err.stdout ?? '',
      stderr: timedOut ? `Command killed: exceeded ${config.executionTimeout}ms timeout` : (err.stderr ?? err.message),
    })
    if (timedOut) break
  }
}
return results
```

### 8.7 `syncSessionFromRealm(state)` — sync-out

**Temp files** (rule 3.3.A):
```
contextRealmNameSet = new Set([...state.contextEntries.values()].map(e => e.realmName))
seen = new Set<string>()

for (entry of readdir(realmHostPath)) {
  if (entry.name === '.meta') continue
  if (state.skillFileNames.has(entry.name)) continue
  if (contextRealmNameSet.has(entry.name)) continue
  if (entry.isDirectory()) {
    console.warn(`[SandboxService] Skill created top-level subdirectory '${entry.name}' in flat realm; ignored on sync-out`)
    continue
  }
  const filePath = join(realmHostPath, entry.name)
  const buf = await readFile(filePath)
  const existing = state.session.tempFiles.find(f => f.name === entry.name)
  const existingBuf = existing ? toBuffer(existing.content) : null
  if (!existingBuf || existingBuf.compare(buf) !== 0) {
    await state.session.writeTempFile({ name: entry.name, content: buf })
  }
  seen.add(entry.name)
}

// Deletions: remove from session anything that was a temp file but is gone from realm
for (f of state.session.tempFiles) {
  if (state.skillFileNames.has(f.name)) continue
  if (contextRealmNameSet.has(f.name)) continue
  if (!seen.has(f.name)) {
    await state.session.removeTempFile(f.name)
  }
}

// Refresh snapshot to current realm state
state.knownTempFileSnapshot = new Map(seen.values().map(n => [n, /* contentBuf already read above */]))
```

**Context files** (rule 3.3.B):
```
for (entry of state.contextEntries.values()) {
  if (entry.state !== 'copied' || entry.type !== 'file') continue
  const realmPath = join(realmHostPath, entry.realmName)
  const realmBuf = await readFile(realmPath)
  const hostBuf = await readFile(entry.hostPath).catch(() => null)
  if (!hostBuf || realmBuf.compare(hostBuf) !== 0) {
    await writeFile(entry.hostPath, realmBuf)
  }
}
```

**Context folders** (rule 3.3.C — rsync-style mirror with deletions):
```
for (entry of state.contextEntries.values()) {
  if (entry.state !== 'copied' || entry.type !== 'folder') continue
  const realmDir = join(realmHostPath, entry.realmName)
  await mirrorDirectory(realmDir, entry.hostPath)  // additions, modifications, deletions
}
```

`mirrorDirectory(src, dst)` algorithm:
1. Walk `src` recursively. For every file, if missing or differs at `dst/<relativePath>`, write it. For every directory, ensure it exists at `dst/<relativePath>`.
2. Walk `dst` recursively. For every file/directory not present at the corresponding `src` path, delete it (`unlink` for files, `rm -rf` for empty dirs after children processed).

Implementation detail: easiest done via two passes; or shell out to `rsync -a --delete <src>/ <dst>/` if available. Either acceptable. Pure-Node implementation preferred to avoid runtime dependency.

### 8.8 `cleanupSkillSession({ session })`

```
state = sessions.get(session.id)
if (!state) throw new Error(`No skill session for ${session.id}`)

sessions.delete(session.id)

await rmRf(state.realmHostPath)

if (state.mode === 'exclusive') {
  await execFileAsync('podman', ['rm', '-f', state.container.id]).catch(() => {})
  this.exclusiveContainers.get(state.runtimeName)?.delete(state.container)
  this.drainContainerQueue(state.runtimeName)
}
// shared: leave container alive
```

---

## 9. Container spawn argv

### 9.1 Shared container (lazy, one per runtime)

```
podman run -d \
  --name <runtimeName>-shared-<short-uuid> \
  --network=<config.network> \
  --userns=keep-id \
  --mount type=bind,source=<realmRoot>/<runtimeName>/shared,target=/realm \
  <config.image> \
  sleep infinity
```

### 9.2 Exclusive container (per session)

```
podman run -d \
  --name <runtimeName>-exclusive-<short-uuid> \
  --network=<config.network> \
  --userns=keep-id \
  --mount type=bind,source=<realmHostPath>,target=/workspace \
  [for each entry in contextEntries with state==='mounted':
    --mount type=bind,source=<entry.hostPath>,target=/workspace/<entry.realmName>]
  <config.image> \
  sleep infinity
```

### 9.3 Why `--userns=keep-id`

In rootless Podman, container processes by default run under a UID mapped via `/etc/subuid`. Files written by the container to a bind-mounted host path end up owned by that subuid (e.g., `100999`), not the host user. `--userns=keep-id` maps the container UID 1:1 to the host user, so bind-mount writes preserve correct ownership. This is required for any path that the host user will subsequently read or edit.

---

## 10. `config.json` migration

Each runtime's `config.json` rewrites the shape:

**Removed fields**: `pool` (with `min`, `max`), `parallelExecutions`, `maxParallelExecutions`.
**New fields**: `mode`, `limit`.

**Migration table** (preserving existing `network` and `executionTimeout` exactly):

`runtime/src/sandbox/runtimes/generic/config.json`:
```json
{
  "name": "generic",
  "image": "generic-runtime:latest",
  "mode": "shared",
  "limit": 4,
  "network": "none",
  "executionTimeout": 180000
}
```

`runtime/src/sandbox/runtimes/office/config.json`:
```json
{
  "name": "office",
  "image": "office-runtime:latest",
  "mode": "exclusive",
  "limit": 3,
  "network": "none",
  "executionTimeout": 300000
}
```

`runtime/src/sandbox/runtimes/pdf/config.json`:
```json
{
  "name": "pdf",
  "image": "pdf-runtime:latest",
  "mode": "exclusive",
  "limit": 2,
  "network": "none",
  "executionTimeout": 300000
}
```

`runtime/src/sandbox/runtimes/web-testing/config.json`:
```json
{
  "name": "web-testing",
  "image": "web-testing-runtime:latest",
  "mode": "exclusive",
  "limit": 2,
  "network": "slirp4netns",
  "executionTimeout": 600000
}
```

(Reasoning: previous `pool.max` becomes `limit` for exclusive mode. `generic` previously had `parallelExecutions: true, maxParallelExecutions: 4` and `pool.max: 2` — under the new model it's a single shared container with `limit: 4` controlling execution semaphore, matching its prior `maxParallelExecutions`.)

---

## 11. Acquire / release / queue logic

### 11.1 Shared mode

`getOrSpawnSharedContainer(runtimeName)`:
- If `sharedContainers.has(runtimeName)`, return it.
- Else `spawnSharedContainer(runtimeName)`, store, return.

`acquireExecutionSlot(runtimeName, limit)`:
- If `activeExecutions[runtimeName] < limit`, increment and resolve.
- Else queue: `executionQueue.push({ runtimeName, resolve, reject })`.

`releaseExecutionSlot(runtimeName)`:
- Find first queued entry with matching `runtimeName`. If found, splice and resolve it (count stays the same — slot handed off directly). Else decrement.

### 11.2 Exclusive mode

`acquireExclusiveContainer(runtimeName, realmHostPath, contextEntries)`:
- Build the spawn function:
  ```
  spawn = () => spawnExclusiveContainer(runtimeName, realmHostPath, contextEntries)
  ```
- If `(exclusiveContainers.get(runtimeName)?.size ?? 0) < config.limit`, immediately call `spawn()`, add to set, return.
- Else queue: `containerQueue.push({ runtimeName, spawn, resolve, reject })`.

`drainContainerQueue(runtimeName)` (called from `cleanupSkillSession` after a container is removed):
- Find first queued entry with matching `runtimeName`. If found and current size < limit, splice, call `entry.spawn()`, add to set, resolve.

### 11.3 Per-session mutex

Each `SkillExecutionState` has a `syncMutex` that serializes `executeSkillCommands` calls for that session. Different sessions run concurrently up to `config.limit`.

Inline implementation (no external dep):

```ts
class AsyncLock {
  private q: Promise<void> = Promise.resolve();
  acquire(): Promise<() => void> {
    let release!: () => void;
    const next = new Promise<void>(r => (release = r));
    const prev = this.q;
    this.q = this.q.then(() => next);
    return prev.then(() => release);
  }
}
```

---

## 12. Helper utilities (inline in `services/sandbox/index.ts`)

- `dedupe(name: string, used: Set<string>): string` — appends `.dup.1`, `.dup.2`, … before extension if collision.
- `allUsedNames(state): Set<string>` — union of skill file basenames, current `state.knownTempFileSnapshot.keys()`, current `contextEntries.values().map(e => e.realmName)`.
- `contextRealmNames(state): Set<string>` — `new Set([...state.contextEntries.values()].map(e => e.realmName))`.
- `toBuffer(content: string | Buffer): Buffer` — `Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8')`.
- `mirrorDirectory(src: string, dst: string): Promise<void>` — rsync-style mirror with deletions, pure Node.
- `cpRecursive(src: string, dst: string): Promise<void>` — `fs.cp(src, dst, { recursive: true })` (Node 16.7+).
- `emptyDirectory(dir: string): Promise<void>` — `rm -rf` of all children, leave the dir itself.
- `unlinkIfExists`, `rmRfIfExists`, `existsAsync`, etc. — standard fs helpers.

---

## 13. Files to modify, add, leave alone

### Modify
- `runtime/src/sandbox/types.ts` — full rewrite per §5.1.
- `runtime/src/sandbox/runtimes/generic/config.json` — rewrite per §10.
- `runtime/src/sandbox/runtimes/office/config.json` — rewrite per §10.
- `runtime/src/sandbox/runtimes/pdf/config.json` — rewrite per §10.
- `runtime/src/sandbox/runtimes/web-testing/config.json` — rewrite per §10.
- `runtime/src/services/sandbox/index.ts` — full rewrite per §6–§12.
- `runtime/src/services/sandbox/sandbox.test.ts` — full rewrite per §14.
- `runtime/src/services/sessionService/types.ts` — widen `tempFiles[].content` per §5.2.
- `runtime/src/services/sessionService/session.ts` — add `removeTempFile` per §5.3; ensure `writeTempFile` accepts `Buffer`.
- `runtime/src/data/flowSessionRepository/index.ts` — add `removeTempFile`; widen `writeTempFile`; update row decode to round-trip `Buffer` per §5.4.

### Add
- `runtime/src/sandbox/constants.ts` — per §4.

### Untouched (out of scope for this PR)
- `runtime/src/sandbox/build.ts` — image builds unaffected.
- `runtime/src/sandbox/runtimes/*/Dockerfile` — unaffected.
- `runtime/src/skills/*` — unaffected.
- All flow agents (`runtime/src/agents/*`) — this PR does not wire the new sandbox into existing agent flows. Caller wiring is a follow-up.
- `runtime/src/services/sessionService/session.ts` other methods — no changes other than the additions in §5.3.

---

## 14. Test plan — `runtime/src/services/sandbox/sandbox.test.ts`

### 14.1 Setup

- Constructor accepts an `opts.realmRoot` override. All tests pass a temp `realmRoot` under `tmpdir()` to avoid touching the user's real home.
- Test config writes two runtimes:
  - **shared**: `name: 'shared-test'`, `image: 'generic-runtime:latest'`, `mode: 'shared'`, `limit: 2`, `network: 'none'`, `executionTimeout: 30000`.
  - **exclusive**: `name: 'exclusive-test'`, `image: 'generic-runtime:latest'` (reuse generic image; mode is what matters), `mode: 'exclusive'`, `limit: 2`, `network: 'none'`, `executionTimeout: 30000`.
- Mock `Session` and `Skill` objects:
  - `Session` mock implements: `id`, `tempFiles`, `contextFiles`, `contextFoldersInfos`, `writeTempFile({ name, content })`, `removeTempFile(name)`. Backed by in-memory state (no real repository).
  - `Skill` mock implements: `name`, `runtime`, `readContent()` returning a fixed `SkillFile[]`.

### 14.2 Lifecycle

- `start()` creates `<realmRoot>/<runtimeName>/<mode>/` for every runtime.
- `stop()` removes session subfolders and tears down all containers (verify with `podman ps`).

### 14.3 Shared mode

- First `createSkillSession` for the runtime lazy-spawns the shared container. Verify `podman inspect` shows the realm bind mount.
- Second session for the same runtime reuses the same container.
- `cleanupSkillSession` removes the session's realm folder; container remains running.
- `executeSkillCommands` honors the `limit` semaphore: when `limit + 1` calls run concurrently, the (limit+1)-th queues until one releases.
- `createSkillSession` with `session.contextFiles.length > 0` for a shared runtime throws.

### 14.4 Exclusive mode

- Each `createSkillSession` spawns a fresh container with the per-session realm mounted at `/workspace`.
- `cleanupSkillSession` destroys the container (verify with `podman ps`).
- When `limit` containers are alive, the next `createSkillSession` queues until one is cleaned up.

### 14.5 Sync-in (realm ← session)

- New temp file added to session via `session.writeTempFile(...)` between two `executeSkillCommands` calls → file appears in realm at next call.
- Temp file removed from session via `session.removeTempFile(...)` → file gone from realm at next call.
- New context file added via `session.addContextFiles([...])` mid-session → entry recorded as `state: 'copied'`, file appears flat in realm; reading inside container returns its host content.
- New context folder added via `session.addContextFoldersInfos([...])` mid-session → recursive copy appears in realm.
- Mounted context file removed from session → ignored, entry stays, no warning required (per user decision).
- Mounted context folder removed from session → host folder emptied (children deleted), directory itself remains.
- Copied context file removed from session → realm copy deleted.
- Copied context folder removed from session → realm copy deleted recursively.

### 14.6 Sync-out (session ← realm)

- Skill creates a new top-level file in realm → appears in `session.tempFiles`.
- Skill modifies an existing temp file → `session.tempFiles` entry updated.
- Skill deletes a temp file → `session.removeTempFile` was called, entry gone.
- Skill writes a binary file (e.g., 256 random bytes including null bytes) → round-trips faithfully as `Buffer` via `session.writeTempFile`.
- Skill creates a top-level subdirectory under the realm (not a context folder) → ignored on sync-out; warning logged.
- Skill edits a mounted context file → host file reflects the edit (mount-driven; no extra sync work; assert by reading host file after `executeSkillCommands` returns).
- Skill edits a copied context file → host file updated by sync-out.
- Skill modifies a file inside a copied context folder → host folder reflects the change.
- Skill deletes a file inside a copied context folder → host folder reflects the deletion.
- Skill adds a new file inside a copied context folder → host folder reflects the addition.
- Skill modifies a file inside a mounted context folder → host file reflects the change immediately (mount-driven).

### 14.7 Cleanup

- `cleanupSkillSession` removes `<realmHostPath>` from disk.
- `cleanupSkillSession` does NOT run a final sync-out (per user decision).
- Cleanup of an unknown session throws.

### 14.8 Concurrency

- Two parallel `executeSkillCommands` calls for the **same** session serialize via `syncMutex`. The second only starts after the first returns (verify via timestamps or sentinel files written by sleep commands).
- Two parallel `executeSkillCommands` calls for **different** sessions on a shared runtime both run, gated only by the execution semaphore.

### 14.9 Errors

- `createSkillSession` for unknown runtime throws.
- `createSkillSession` when service not started throws.
- `executeSkillCommands` for non-existent session throws.
- `cleanupSkillSession` for non-existent session throws.

### 14.10 Timeout

- Command exceeding `executionTimeout` is killed; result `stderr` contains the timeout message; subsequent commands in the batch are not executed.
- Sync-out still runs after a timeout (per `finally` clause in §8.4).

### 14.11 Path collisions

- Two context files with the same basename get distinct realm names (e.g. `report.docx` and `report.dup.1.docx`); both readable inside the container; both flush to the correct host path.

### 14.12 path-map.json

- After `createSkillSession`, `<realmHostPath>/.meta/path-map.json` exists and contains `{ "<containerWorkingDir>/<realmName>": "<hostPath>" }` for every context entry. Not asserted to be exposed inside the container — host-side file only.

### 14.13 Tests dropped from the existing suite

- Warm-pool tests.
- Container reuse across sessions tests.
- `inputFiles` / `.old.N` rename tests.
- `parallelExecutions` flag tests.
- The current `Session Isolation` test is **revised**: for shared mode, sibling sessions can see each other's folders via `cd ..` (soft isolation, by design, per user trust assumption for `parallelExecutions: true` runtimes; the redesign preserves this). The hard-isolation guarantee applies to exclusive mode (each session has its own container). Test asserts: exclusive sessions cannot see each other's data because they are in different containers; shared sessions can cd to siblings (this is the trust model).

---

## 15. Decisions baked in (consolidated)

For the implementer's reference, the following decisions were locked during planning and must be respected:

1. `mode` and `limit` replace `pool.{min,max}`, `parallelExecutions`, `maxParallelExecutions`. No backward-compat shim. Existing configs are rewritten in this PR.
2. `RuntimeType` (string-literal union) is removed. Runtimes are looked up by `string`.
3. Shared mode = exactly one container per runtime, lifetime = service lifetime. Lazy-spawned on first session.
4. Exclusive mode = one container per session. Destroyed on cleanup. Capped by `limit`, queued when full.
5. Context entries (files or folders) are not allowed on shared-mode sessions. Throw at `createSkillSession`.
6. No container pre-warm. First session for each runtime pays the spawn cost.
7. `inputFiles` is removed from the public API entirely. Replaced by `tempFiles` (set on Session before create) and `contextFiles`/`contextFoldersInfos` (mounted at create or copied mid-session).
8. `stop()` destroys all containers (no reattach on next start).
9. `--userns=keep-id` on every spawn so host file ownership stays sane after container writes.
10. `<realm>/.meta/path-map.json` written for host-side bookkeeping; not exposed to skill.
11. Realm is strictly flat at the top level. Skill files, temp files, context entries all appear as direct children of the working dir.
12. Skill-created top-level subdirectories under the realm are ignored on sync-out with a warning.
13. `tempFiles[].content` widened to `string | Buffer`. Storage layer encodes Buffer as base64 with a marker, transparently to the API.
14. `Session.removeTempFile(name)` added. Required for sync-out deletion semantics.
15. Mounted context file removed from session mid-flight: ignored (cannot unmount).
16. Mounted context folder removed from session mid-flight: host folder emptied (children removed, directory itself stays mounted).
17. Copied context file/folder removed from session: realm copy deleted; nothing flushed to host.
18. Sync-out for context folders is rsync-style with deletions (additions, modifications, removals all applied to host).
19. `cleanupSkillSession` does NOT run a final sync. Wipes realm and tears container down.
20. `executeSkillCommands` for the same session is serialized with a per-session async mutex. Different sessions run concurrently up to `config.limit`.
21. Sync-out runs in a `finally` block — even on command failure or timeout.
22. The flow `Session` (formerly `FlowSession`) is the single source of truth for `tempFiles`, `contextFiles`, `contextFoldersInfos`. The sandbox owns the realm and the container; it never persists session state outside of calling `session.*` methods.
23. The sandbox API is in terms of `Session` runtime objects, not `sessionId: string`. Per OOP-style runtime representation pattern used elsewhere.
24. Caller wiring (which agent flow invokes the sandbox, how `Session` and `Skill` are passed in) is OUT OF SCOPE for this PR.

---

## 16. Implementation order

1. Add `runtime/src/sandbox/constants.ts`.
2. Rewrite `runtime/src/sandbox/types.ts`.
3. Read existing `runtime/src/sandbox/runtimes/{generic,office,pdf,web-testing}/config.json` (already done during planning; values captured in §10) and rewrite them.
4. Update `runtime/src/services/sessionService/types.ts` — widen `tempFiles[].content`.
5. Update `runtime/src/services/sessionService/session.ts` — add `removeTempFile`, ensure Buffer pass-through for `writeTempFile`.
6. Update `runtime/src/data/flowSessionRepository/index.ts` — add `removeTempFile`, widen `writeTempFile` to accept Buffer, update row-decode to round-trip Buffer via base64+marker at the storage boundary only.
7. Full rewrite of `runtime/src/services/sandbox/index.ts` per §6–§12.
8. Full rewrite of `runtime/src/services/sandbox/sandbox.test.ts` per §14.
9. Run `cd runtime && npx vitest run src/services/sandbox/sandbox.test.ts`. Iterate on failures.
10. Run the full repo test suite to confirm nothing else regressed (especially anything that imported the old `RuntimeType` or `PoolConfig` types — there should be none outside of `sandbox/types.ts` per the planning grep, but verify).

---

## 17. Reference: existing code touched

For the implementer's quick orientation. All paths relative to the repo root.

### `runtime/src/services/sandbox/index.ts` (current — POC, to be fully rewritten)
- Class `SandboxService` exposing `start`, `stop`, `createSession`, `executeCommands`, `cleanupSession`, `getRuntimeForSkill`, `getRuntimeConfigs`.
- Container pool, semaphore, queueing logic.
- `copyToContainer`, `copyInputWithRename`, `fileExistsInContainer` — all dead in new model, will be removed.
- Constructor signature: `constructor(app: App, cwd: string = process.cwd())`. New constructor: `constructor(app: App, opts?: { cwd?: string; realmRoot?: string })`.

### `runtime/src/sandbox/types.ts` (current)
- `NetworkMode = 'none' | 'slirp4netns'` — kept.
- `PoolConfig { min: number; max: number }` — removed.
- `RuntimeConfig` — rewritten per §5.1.
- `SkillRuntimesMap` — kept (used by skill-runtimes.json loader).
- `RuntimeType = 'office' | 'pdf' | 'web-testing' | 'generic'` — removed; runtimes identified by `string`.

### `runtime/src/sandbox/build.ts`
- Discovers runtime subfolders via `Dockerfile` presence, builds each via `podman build -t <name>-runtime:latest`. Unaffected by this PR.

### `runtime/src/services/sessionService/session.ts`
- `Session` class with all the accessors and mutators. Already imports `FileInfo`, `FolderInfo` from `utils/file.ts`, `utils/folder.ts`. Already has `writeTempFile`, `addContextFiles`, `addContextFoldersInfos`. Add `removeTempFile`.

### `runtime/src/services/sessionService/types.ts`
- `SessionData.tempFiles: Array<{ name: string; content: string }>` — widen `content` to `string | Buffer`.
- `CreateSessionParams`, `SessionMessage`, `MessageWindowConfig`, `SessionStatus`, etc. — unaffected.

### `runtime/src/data/flowSessionRepository/index.ts`
- Row decode at line 134: `tempFiles: (row.tempFiles as { name: string; content: string }[]) || []`. Update per §5.4.
- `writeTempFile` at lines 323–339. Widen content type. Encode Buffer as `{ name, content: <base64>, encoding: 'base64' }` for the DB row.
- Add `removeTempFile` per §5.4. Mirror the `writeTempFile` pattern: read session, splice, update, emit bus event, log, return new array.

### `runtime/src/skills/index.ts`
- Defines `Skill`, `SkillFile`, `SkillSchema`, `SkillLog`. `Skill.runtime?: string` is set from `skill-runtimes.json`. The sandbox uses `skill.runtime` and `skill.readContent()`. Unaffected by this PR.

### `runtime/src/skills/skill-runtimes.json`
```json
{
  "docx": "office",
  "pptx": "office",
  "xlsx": "office",
  "pdf": "pdf",
  "webapp-testing": "web-testing",
  "skill-creator": "generic"
}
```
Unaffected by this PR; consumed by `Skills.loadSkillRuntimeMap` and by `SandboxService.getRuntimeForSkill`.

### `runtime/src/utils/file.ts` (FileInfo)
```ts
export interface FileInfo {
  path: string;
  content?: FileContent;
  description?: string;
  category: FileCategory;
}
```
Sandbox reads only `cf.path`.

### `runtime/src/utils/folder.ts` (FolderInfo)
```ts
export interface FolderInfo {
  path: string;
  tree: string;
}
```
Sandbox reads only `cfo.path`.

---

## 18. Open follow-ups (NOT in this PR)

Recorded so they aren't lost:

- Per-context read-only flag (`SkillContextMount.readonly?: boolean`). Default `false` (full rw). Defer until real usage warrants the complexity.
- Snapshot/backup of context files before exposing to skill, for rollback if the skill misbehaves. Defer.
- Dynamic re-mount on running container for mid-session context additions (would let mid-session adds become `mounted` instead of `copied`). Currently impossible without container respawn; defer until measured need.
- Auto-cleanup triggers (e.g., on `Session.complete()` / `Session.fail()`). Defer; manual cleanup for testing phase.
- Wiring the new sandbox into agent flows. Separate PR.
- `pool.min` warm-pool, if measured to matter. Defer.
- Limit on how many shared sandboxes exist concurrently across runtimes (a global cap). Out of scope per user.
- Cross-session shared realm folders for cooperative multi-session scenarios. Out of scope per user.
