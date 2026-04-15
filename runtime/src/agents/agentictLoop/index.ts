import { Agent } from '../../utils/agent/agent.js';
import { App } from '../../app.js';
import { RuntimeUser } from '../../services/userService/index.js';
import { Session } from '../../services/sessionService/session.js';
import { AgenticLoopFlow } from './flow.js';

export class AgenticLoopAgent extends Agent<App, RuntimeUser, Session> {
  name = 'Agentic Loop';
  description = 'Universal agentic agent that runs with a schema — tools, skills, and configurable loop behaviour.';
  flowConstructors = { AgenticLoopFlow };
}
