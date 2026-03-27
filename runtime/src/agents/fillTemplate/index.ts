import { Agent } from '../../utils/agent/agent.js';
import { App } from '../../app.js';
import { User } from '../../data/userRepository/types.js';
import { Session } from '../../services/sessionService/session.js';
import { FillTemplateFlow } from './flow.js';

export class FillTemplateAgent extends Agent<App, User, Session> {
  name = 'fillTemplate';
  description = 'FillTemplate agent — guides users through filling a template conversationally, collecting information step by step.';
  flowConstructors = { FillTemplateFlow };
}
