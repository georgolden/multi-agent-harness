import { Agent } from '../../utils/agent/agent.js';
import { App } from '../../app.js';
import { User } from '../../data/userRepository/types.js';
import { Session } from '../../services/sessionService/session.js';
import { ExploreFlow } from './flow.js';

export class ExploreAgent extends Agent<App, User, Session> {
  name = 'explore';
  description = 'Explore agent — maps project structure, understands key files and relationships, gathers context for downstream agents.';
  flowConstructors = { ExploreFlow };
}
