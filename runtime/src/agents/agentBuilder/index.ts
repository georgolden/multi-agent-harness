import { Agent } from '../../utils/agent/agent.js';
import { App } from '../../app.js';
import { User } from '../../data/userRepository/types.js';
import { Session } from '../../services/sessionService/session.js';
import { AgentBuilderFlow } from './flow.js';

export class AgentBuilderAgent extends Agent<App, User, Session> {
  name = 'agentBuilder';
  description = 'Agent Builder — guides the user through designing a complete AI agent, producing a ready-to-use AgenticLoopSchema.';
  flowConstructors = { AgentBuilderFlow };
}
