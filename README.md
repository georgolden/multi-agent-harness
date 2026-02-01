# AGI

I am writing agents that will write agents and agents that will write programs.

Under human supervision, this will be AGI.

## Structure

- `docs` folder - to write high-level documentation.

- `PocketFlow-Typescript` submodule - PocketFlow TypeScript port that contains fewer examples in the cookbook.

- `superhuman` submodule - Previous iteration of the same thing (Python attempt). It contains:
    - `reminder-bot` submodule - Telegram agentic bot that schedules one-time and recurring cron reminders from natural language using PocketFlow and Superhuman's examples. Caveat: it is written partially by a code agent (lower code quality). Duplicated in `reminder-agent` in `superhuman`. Submodule is public and deployed.
    - `pocketflow` submodule - Main Python version of the PocketFlow framework. Super important - contains all the fresh cookbook examples and docs.
    - `src/agents/native-tools-agent` - Standalone agent example with tool use instead of PocketFlow YAML output. This one must be used as the main example of a flow agent with LLM decision branching instead of output format branching. It is a decent quality web search agent.

`pocketflow` contains docs.
`superhuman/reminder-bot` contains docs.

## Previous Iterations

### Superhuman

Was a nice try to build a similar thing to `clawdbot` - CLI everything LLM agent with heartbeat, skills, web search, subagents, coding agent, and many more.

What is done: Web search decent quality agent with DeepSeek and PocketFlow.
Partially coded with AI agent `reminder-bot` that is working decently in production with few users (but still has some minor bugs).

Then `clawdbot` hit, and I tried it immediately. After some usage and research, I came to the conclusion that `superhuman` is not what I want to build.

`clawdbot` flaws (why it is not great / why not use it for everything):
- Coding sucks: no nice context retrieval, same problems as with all CLI coding agents - no control over system prompt instructions, no LLM parameter adjustments, context flood, inconsistent output quality over time and between sessions.
- Token burning machine - costs are through the roof.
- Does not have anything to help work better with LLM at all: no context retrieval agents, no following templates, no asking user.
- Big and quite hard code base. No clear agent definitions, difficult to pick up what is going on and write something above.

`clawdbot` pros and must-haves for any agentic system now:
- Heartbeat
- Task schedules
- Autonomous agent spawning and scheduling
- Writing skills and sub-agents and agentic sub-systems (success case: it is my personal secretary now)

Why `superhuman` fails:

Mostly python issues:

1. I am unfamiliar with Python - I do not know best practices.
2. LLMs generate based on probability; without context, it is average low-quality code from their training data - bad code quality generation.
3. I do not have any production apps in Python to borrow from - bad code generation.
4. Tested with `reminder-bot`: tons of Python-related bugs that are hard to debug and hard to fix - needs both me and agent to fix.
5. Unclear scaling - async model is cringy compared to Node.js or Rust Tokio.
6. Prototyping below average - speed is low because lack of knowledge, not used, and bad code generation.
7. Production and maintenance - hell because of bugs that are hard to predict and require decent time to fix.
8. I can't automate something that I can not do consistently even with AI.

### Current State

I decided to go AGI.

I did tons of research on `clawdbot`, prompting, and agentic systems. Was in AI Skills conf. Read tons of articles from AI-first developers.

I am quite confident that I can build a system that will build almost everything for me and with less dependency on me.

Solving `superhuman` issues:

PocketFlow, despite being a new thing, is super tiny and easy to work with, so I decided to keep it.

But switch to TypeScript - so `PocketFlow-Typescript` is planned to be used.

### Plan

1. Port `reminder-bot` to TypeScript while fixing all its issues - this will verify that it is easier to do than with Python.

    - If verified: write agents for coding and agents to write agents.

    - If still bad experience: remove PocketFlow and write code fully myself with comfortable structure for generation - find one with trial and error process.

2. Write agents for coding and agents to write agents.

3. After this is done - write any piece of software I ever wanted to write in my entire life.

4. And write an even more powerful agentic system than `clawdbot`.

I bet on quality

1. is done

Insights: 

 - you need to write scripts for features better because model sucks on determine stuff

 - better model must use your expertise to extract good scripts from you

 - think about features nicely and write good feature description

 - research how to write feature descriptions and PRD short and nicely for LLMs

### Works fine with typescript

What went wrong with reminder bot:

No documentation done

No scripts, no feature guidelines done

No clear feature description

Result is a bit buggy but it is working anyways

Go to agents!

1. Write templates for system prompt and regular prompt templates for coding agent, then for context retriaval agent

2. Check instructions of other's agents and check Cody prompt it was super nice even back then

3. Feature description and PRD and system design templates and check lists

Do small setup for each agent to play around and quickly check results

Think about test cases - agents that are developing agent are also nice

When refactoring a mess needs breakdown and also needs to fill up feature guidelines with templates/check lists
