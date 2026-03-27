import { Agent } from '../../utils/agent/agent.js';
import { App } from '../../app.js';
import { User } from '../../data/userRepository/types.js';
import { Session } from '../../services/sessionService/session.js';
import { OrchestratorFlow } from './flow.js';

export class OrchestratorAgent extends Agent<App, User, Session> {
  name = 'orchestrator';
  description = 'Orchestrator agent — understands user requests, breaks them into tasks, and dispatches the right agents.';
  flowConstructors = { OrchestratorFlow };
}
