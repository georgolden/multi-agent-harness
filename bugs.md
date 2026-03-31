# Bugs

## BUG-1: Session restore loses live tools — schema agents loop and fail

**File:** `runtime/src/agents/agentictLoop/flow.ts` `createSession()`
**Symptom:** On server restart, restored schema agent sessions have `session.tools = []`. Every tool call returns `"Tool 'X' not found"`, LLM loops until `maxLoopEntering` is hit, session fails.
**Root cause:** Live `Tool[]` objects are attached to `session.tools` only in `createSession()`. On restore, the session is reconstructed from DB — `session.tools` is never repopulated from `toolNames` stored in `toolSchemas`.
**Fix needed:** After restoring a session for `AgenticLoopFlow`, repopulate `session.tools` from `session.toolSchemas` names via `app.tools.getSlice()`.
