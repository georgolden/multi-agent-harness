import { Agent } from '../../utils/agent/agent.js';
import { App } from '../../app.js';
import { RuntimeUser } from '../../services/userService/index.js';
import { Session } from '../../services/sessionService/session.js';
import { AgentBuilderFlow } from './flow.js';

export class AgentBuilderAgent extends Agent<App, RuntimeUser, Session> {
  name = 'agentBuilder';
  description = 'Agent Builder — guides the user through designing a complete AI agent, producing a ready-to-use AgenticLoopSchema.';
  flowConstructors = { AgentBuilderFlow };
}
