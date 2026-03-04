
## Tasks

- [x] test sanbox service that will work with sanbox runtimes

- [x] write task scheduler agent - derive from reminder task will be flow so agent scheduler agent
  - [x] use flow session repository instead of message history

- [x] do message history handling properly context management
  - strategies:
    rolling history window - most common best one,
    important context,
    0 history window (less likely due to often tool call requirements),
  - observability - needs for ui integration to see what is in mesages history
  - using relevant knowledge samples
  - treat memory not as personalization but as learning

- [x] move all specifics and make a generic flows:
  - universal agentic tool call loop - similar as web search or reminder
    - [x] universal agent loop
    - [x] make fill tempalte flow
    - [x] use prompt template with fill tempalte flow
    - [x] make context retrieval flow (explore)
  - [x] add llm message models and update session repo and usage everywhere to handle messages via message model
  - [x] make own version of a pocketflow that works nice with stack trace, respects options and that works with not shared store but with result state as well

- [ ] Finish agentic app
  - agent flows must be used as skills or tools with similar schema and syntax
  - for schema based agents they must be executed with a schema
  - execute agent flow tool
  - user's channel to runtime
  - dashboard of agents that hold all running agents (and history probably) it could or could not communicate with orchestrator agent, but it uses async messaging to comminucate with users and used by UI to show all the running agents and their statuses.
  - orchestrator agent
  - 1st application - just executable that glues and runs everything
  - agent builder of agents
  - build secretary agent/agents
  - execute skill tool
  - UI
  - Telegram Channel
  - autonomous mode - mimic user is the best way to not tweak agent. agent could be user of another agent
  - sandboxing and security tweaks for outside agents
  - agents for creating skills/tools
  - introspection reflection agents
  - memory agents
  - coding agents
  - business automation agents
  - application dynamic load to runtime - will allow to create any programmatic parts on demand
  - MCP running tool
  - Software as skill/agent/tool - e.g. use any agentic software withing your own agents - not even required to learn stuff
  - multi user
  - edit all agents not only schema, but also built in agents must be editable such as orchestrator, task scheduler, agent builder

  1. Agent that builds agent - minimal fill schema and make helpers on each step and have defaults
  2. Main agent that orchestrates between agents
    - agent invocation manually invoked by user or other agent or as task with scheduler
    - orchestrator must based on user query use task scheduler agent with flow and parameters or just run agent session in background
  3. Runtime: orchestrator agent running with other agents inside the dashboard of agents which has ui and fully observable
  4. UI: Board of agents. Left column list to spawn agents default session is orchestrator. Central column - chat with agent where you do task. Right column - running sessions that are working with notifications: Done, User required, Failed. Somewhere history of sessions.
    - User can just type what he wants and he will go through orchesrator agent
    - User can pick agent himself to run with a task from the list of agents
    - User resolves notifications blockers and reviews done agentic jobs - it could be done with central column split on push notification
    - UI is a channel as well
  5. Channels:
    - Telegram:
      - Capabilites: message with options or command.
      - Best usage: use as main chat but on notification have buttons to reply, review to not interfere with main session.
      - On scale need to switch between modes and probably have an agent that operates in the middle to resolve tons of notifications or assign tasks

- [ ] write reflection agent - this agent must reflect and log success and failure of each flow/workflow run

- [ ] create common generic workflows:
  - ralph wiggum loop - iterative improvement until task done
    - preprocessing agent here to ask for writing prompt in a template
    - good context management here - maybe via review agents will be nice
  - continious learning

- Backlog:
  - universal map/reduce agent processing flow - for batch processing
  - agentic map reduce - 2 prompts combination of first 2 for unstructured input like user's queries and parallel agent executions
  - use context retrieval flow

Ralph loop:

user prompt template use!!!

tasks goes from user and then there is a manager agent for a task

manager agent 


# Ralph Wiggum Plugin

Implementation of the Ralph Wiggum technique for iterative, self-referential AI development loops in Claude Code.

## What is Ralph?

Ralph is a development methodology based on continuous AI agent loops. As Geoffrey Huntley describes it: **"Ralph is a Bash loop"** - a simple `while true` that repeatedly feeds an AI agent a prompt file, allowing it to iteratively improve its work until completion.

The technique is named after Ralph Wiggum from The Simpsons, embodying the philosophy of persistent iteration despite setbacks.

### Core Concept

This plugin implements Ralph using a **Stop hook** that intercepts Claude's exit attempts:

```bash
# You run ONCE:
/ralph-loop "Your task description" --completion-promise "DONE"

# Then Claude Code automatically:
# 1. Works on the task
# 2. Tries to exit
# 3. Stop hook blocks exit
# 4. Stop hook feeds the SAME prompt back
# 5. Repeat until completion
```

The loop happens **inside your current session** - you don't need external bash loops. The Stop hook in `hooks/stop-hook.sh` creates the self-referential feedback loop by blocking normal session exit.

This creates a **self-referential feedback loop** where:
- The prompt never changes between iterations
- Claude's previous work persists in files
- Each iteration sees modified files and git history
- Claude autonomously improves by reading its own past work in files

## Quick Start

```bash
/ralph-loop "Build a REST API for todos. Requirements: CRUD operations, input validation, tests. Output <promise>COMPLETE</promise> when done." --completion-promise "COMPLETE" --max-iterations 50
```

Claude will:
- Implement the API iteratively
- Run tests and see failures
- Fix bugs based on test output
- Iterate until all requirements met
- Output the completion promise when done

## Commands

### /ralph-loop

Start a Ralph loop in your current session.

**Usage:**
```bash
/ralph-loop "<prompt>" --max-iterations <n> --completion-promise "<text>"
```

**Options:**
- `--max-iterations <n>` - Stop after N iterations (default: unlimited)
- `--completion-promise <text>` - Phrase that signals completion

### /cancel-ralph

Cancel the active Ralph loop.

**Usage:**
```bash
/cancel-ralph
```

## Prompt Writing Best Practices

### 1. Clear Completion Criteria

❌ Bad: "Build a todo API and make it good."

✅ Good:
```markdown
Build a REST API for todos.

When complete:
- All CRUD endpoints working
- Input validation in place
- Tests passing (coverage > 80%)
- README with API docs
- Output: <promise>COMPLETE</promise>
```

### 2. Incremental Goals

❌ Bad: "Create a complete e-commerce platform."

✅ Good:
```markdown
Phase 1: User authentication (JWT, tests)
Phase 2: Product catalog (list/search, tests)
Phase 3: Shopping cart (add/remove, tests)

Output <promise>COMPLETE</promise> when all phases done.
```

### 3. Self-Correction

❌ Bad: "Write code for feature X."

✅ Good:
```markdown
Implement feature X following TDD:
1. Write failing tests
2. Implement feature
3. Run tests
4. If any fail, debug and fix
5. Refactor if needed
6. Repeat until all green
7. Output: <promise>COMPLETE</promise>
```

### 4. Escape Hatches

Always use `--max-iterations` as a safety net to prevent infinite loops on impossible tasks:

```bash
# Recommended: Always set a reasonable iteration limit
/ralph-loop "Try to implement feature X" --max-iterations 20

# In your prompt, include what to do if stuck:
# "After 15 iterations, if not complete:
#  - Document what's blocking progress
#  - List what was attempted
#  - Suggest alternative approaches"
```

**Note**: The `--completion-promise` uses exact string matching, so you cannot use it for multiple completion conditions (like "SUCCESS" vs "BLOCKED"). Always rely on `--max-iterations` as your primary safety mechanism.

## Philosophy

Ralph embodies several key principles:

### 1. Iteration > Perfection
Don't aim for perfect on first try. Let the loop refine the work.

### 2. Failures Are Data
"Deterministically bad" means failures are predictable and informative. Use them to tune prompts.

### 3. Operator Skill Matters
Success depends on writing good prompts, not just having a good model.

### 4. Persistence Wins
Keep trying until success. The loop handles retry logic automatically.

## When to Use Ralph

**Good for:**
- Well-defined tasks with clear success criteria
- Tasks requiring iteration and refinement (e.g., getting tests to pass)
- Greenfield projects where you can walk away
- Tasks with automatic verification (tests, linters)

**Not good for:**
- Tasks requiring human judgment or design decisions
- One-shot operations
- Tasks with unclear success criteria
- Production debugging (use targeted debugging instead)

## Real-World Results

- Successfully generated 6 repositories overnight in Y Combinator hackathon testing
- One $50k contract completed for $297 in API costs
- Created entire programming language ("cursed") over 3 months using this approach

## Learn More

- Original technique: https://ghuntley.com/ralph/
- Ralph Orchestrator: https://github.com/mikeyobrien/ralph-orchestrator

## For Help

Run `/help` in Claude Code for detailed command reference and examples.
