import { Agent } from '../../utils/agent/agent.js';
import { App } from '../../app.js';
import { User } from '../../data/userRepository/types.js';
import { Session } from '../../services/sessionService/session.js';
import { TaskSchedulerFlow } from './flow.js';

export class TaskSchedulerAgent extends Agent<App, User, Session> {
  name = 'taskScheduler';
  description = 'TaskScheduler agent — schedule one-time and recurring reminders and agent flows, list and cancel tasks.';
  flowConstructors = { TaskSchedulerFlow };
}
