# Design

## Core Abstractions

### App

App is a generic class and also a runnable instance.

App is also referred to as an Agentic App because it contains flows - agentic flows.

Agentic App is an App with flows.

App is also a container with all of the dependencies needed for services and flows.

App contains infra, data, services, flows, skills, and tools.

One App could be run inside another one; multiple Apps could be run in the same runtime or in separate ones.

### Layers

Infra, data, services, flows, skills, and tools of the Apps are layers.

Each layer contains its own modules.

A module is encapsulated and could be small, big, complex, or simple.

Modules are registered in the app and could be used across each other.

Modules could and even must use functionality of neighboring or other layer modules if they are hard dependent on them.
e.g.

- User Repository could be a hard dependency for multiple repositories or services.
- Infra Bus is a hard dependency for services and flows to make async communication.

Hierarchy:

Services are on top - they can use everything.

Flows - they are a bit lower; they could use everything, but they are used from services.

Skills, tools - they are most of the time used by flows, but could be used in services as well.

Data - they are used by everyone; they use infra or only their internal db/cache related code.

Infra - on the bottom. Could use data, but mostly independent.

### Boundaries

Boundaries are borders between layers that help develop code without abstraction leaks.

Boundaries are defined like this: A module in the data layer can use DB connectors, dependencies, or infra, but it can't use services because it is out of the data layer scope.

Responsibilities of the modules must be defined corresponding to the definition and meaning. A module has responsibilities of a similar kind and nature.

e.g.

- Repository that is responsible for scheduler jobs storage can not be responsible for message history.
- Service that is responsible for telegram integration can not be responsible for scheduling jobs.
- Flow that does web search can not be responsible for scheduling jobs or coding or tasks orchestration.
- Skills can not contain anything except skills related files.

You often like to cross boundaries for a fast hacky solution - avoid it at all costs. Always think about boundaries and reflect on where a feature must be placed exactly.

Boundaries are super important to define and follow.

**Abstraction Leak** - typical mistake that happens when boundaries are broken and functionality is leaked through a layer or even between layers. This is insanely bad because it quickly makes applications unmaintainable and features become buggy and unfixable.

### Infra Layer

Infra is used for cross-service communication to avoid cross-service dependencies.

Infra is used as a generic cross-service communication mechanism - because you can process messages from a single source through multiple sources in parallel.

**Best practice**

- Send messages through infra bus with `<producer>:<messageType>` convention to be able to extend message consuming with multiple services any time in the future.

**Exceptions**

- Logger is the only good thing to replace the Node.js global environment. Console is often used for logging, and to not create any confusion, just replace console with logger - this is the only case when patching global is fine.

Infra layer contains system programming scope modules that are for infrastructure between different layers of the App or multiple Apps.

e.g. Bus (EventBus, MessageQueue), Monitoring, etc.

### Data Layer

Data layer contains storage related things, references to Repository pattern in a wider sense with or without ORM.
Data layer is just a collection of interfaces for storages - databases, file storages, caches, etc.

### Services Layer

Services are code/programming units that are used to encapsulate certain features.
e.g.

- Telegram service - telegram bot integration
- Scheduler service - job scheduler, etc.
- Heartbeat service
- Dashboard service
- Chat service

A service has its own database or repositories, utilities, sub-services/sub-modules - it is a fully independent unit of code and could grow as much as needed.

### Flows

Flows are agentic parts (agentic means LLM API calls used); flows are written in a specific way on top of the PocketFlow tiny framework.

Flows are executed with App and Context in PocketFlow SharedStore.

- **App is immutable** - needed to access app layers functionality on need, used as a dependencies container.
- **Context is mutable** - here all the data that is flow scope is stored; it is a temporary cache that exists during the flow execution.

Flow's Nodes can have their own sub-context which is just a descendant of flow Context.

A Node in a flow just represents a logical step to do; it could be LLM related or just code related.

Flows could be combined into a Workflow - basically just multiple flows combined into a bigger multi-agent system.
e.g. Chat flow with WebSearch flow with Coding flow with Scheduler flow

Flow, Agent, Sub Agent are often the same thing

Agent could be a workflow or multiple flows combined if there are many features that require breaking up. User often could reference multi-flow multi-agent system as just an agent.

Flows often use tools and skills to run.

Flow contains flow, nodes, its own unique tools or its own unique skills and prompts.

Prompts are markdown files for system prompt or regular prompt with template vars.

### Skills

Flows (Agents) use Skills.

Skills are the implementation of agent skills standard.
Skills are capabilities that are used with LLM and that are adjustable to LLM's instructions.

Skills layer is present to share skills between flows (agents). Skills library.

**Spec** - each skill must contain `SKILL.md` file that starts with name and description in YAML and then describes what the skill does. And often a good practice is to define which tools are required for the skill.

Some skills require skill-specific runtime - sandbox (often just docker container), installing dependencies, running scripts in this sandbox, etc.

Skill can contain multiple files that are related to a skill.

### Tools

Flows (Agents) use Tools.

Tools are capabilities that are provided to a model to allow the model to perform actions in the real world.

Tools layer contains only tools that are shared between multiple flows.

Tools layer is present to share tools between flows (agents). Tools library.
