# Declarative agent concept

Some agents and agentic systems (flows, workflows) could be described declaratively.

An Agent is a flow or multiple flows - workflows.

It works with input.

So there is an input source.

Then it does some flow with the input and then outputs information to an output source.

During the flow, it does useful side effects with tool usage.

## Why do we need declarative flows?

- To be able to quickly write flows and quickly ship systems.

- To be able to allow non-programmers to create their own flows.

- To be able to write autonomous or semi-autonomous systems.

## Requirements

Runtime required that has a general agent (orchestrator agent).

Some built-in agents and services.

Scheduler service, message channels services (to communicate with user), dashboard to track agents' execution.

Web search agent, browsing agent, agent that helps build declarative agents.

## Structure

### Flow Creation - Who and where creates a flow

1. User in general session creates a flow by message.
2. From user's pre-built schedule instructions - flow runs on schedule recurrent or one time.
3. Other flow (agent) direct creation with message.
4. Other flow (agent) on schedule.
5. External signal - from program, from users of a user in multi-user app.

### LLM Integration Part Parameters

- **System prompt** (optional but recommended)
  - Create a template here to fill.
  - Use general prompt template or suggest to pick from prompt templates if user doesn't want to create system prompt.
  - Ask to write about what NOT TO DO.

- **Temperature** (automatically picked)
  - Pick based on task type.
  - Low (0.3) for deterministic tasks like coding, scheduling ones that require reliable output.
  - Medium (0.6) for most of the tasks.
  - High (0.9) for creative tasks only where unexpected results are preferred.

- **Tools** (optional)
  - Add tools automatically that are easy to identify from requirements from tools library/layer.
  - Add security tools automatically if flow works with untrusted input sources.
  - Suggest tools to add if not sure if they are useful or not.

- **Skills** (optional)
  - Suggest skills that could be passed for agent from skills library/layer.
  - Prepare skills runtimes for selected skills that require separate runtime.

- **Regular prompt wrapper template** (optional)
  - Could be some query specific wrappers; suggest passing templates if they are available.

### Context

Important files, docs from internet, important info.

Could be system prompt scoped or regular prompt scoped.

### Input Data

Prompt text or images.

Determine what is supported by asking and what to do with each type.

Could lead to system prompt update or regular prompt template update.

### Features

Features are often related to some described tool use.

Also, skills could be created for the feature if they are useful.

Often files write, modify, check list fill, APIs call.

### Exiting Flow

Type of output - tool call or response.

If tool call: what tool?

If response: response format.

Summary of work is also a valid common option.

User could be asked about format.

Check list fulfilled, goal accomplished, task solved.

Could be exiting only via review of other flow.

## Format Design

Multiple files is a nice option.

### Flow creation could be formal type - YAML, JSON with a list of source types like:

Could also branch into 2 separate flows or to have different instructions for source type or actor type (agent, user, user's clients).

Source type: direct creation (event), scheduler - could be both.

And there could be source type related things.

Scheduler: scheduler parameters.

### Flow Description

Transitions between steps must be defined somehow; here need work to be done.
Most useful patterns - agent loop, map reduce, batched processing.
Existing flows from flows layer/library also could be useful here to add.

I need to find a good option here.

LLM part roles are useful here as well: decision maker, analytic, data transformer, content generator, and more.

### For LLM integration part parameters are

System prompt - MD file with template vars could be created via **system prompt creation guide** or from existing template or directly provided from user.

Temperature - auto picked based on tasks solved by flow and stored in JSON, YAML formal format to later modify by user if they know what it is.

Tools to pick for flow or for subtask - tool factories or schema references in formal JSON/YAML format.

Skills to pick for flow or for subtask - metadata of skills in formal JSON/YAML format.

Regular prompt wrapper template - MD file with template vars could be created or from existing template.

### Context

Could be fetched from internet.
Could be searched on disk and attached via paths or just copied.

### Input Data

Will lead to instructions updates.

### Features

Could be MD files descriptions of what features are - basically close to skills. But they are created from templates by breaking down user's requirements and asking questions about features to fill templates.

I NEED TO CREATE FEATURE TEMPLATE.

### Exiting Flow

Will lead to instructions update, potentially other flow creation or picking from existing flows.

## Notes

Each flow must be documented as well with `design.md` doc to just know what it does - update automatically with user's updates.

## Agent Design

TO-DO:

- Prepare runtime
- All flows here will be done in practice
- Test and write flows

For tests secretary system is perfect case to try and this one will be used immediately
