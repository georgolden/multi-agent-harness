import { Agent } from '../../utils/agent/agent.js';
import { App } from '../../app.js';
import { RuntimeUser } from '../../services/userService/index.js';
import { Session } from '../../services/sessionService/session.js';
import { TaskSchedulerFlow } from './flow.js';

export class TaskSchedulerAgent extends Agent<App, RuntimeUser, Session> {
  name = 'taskScheduler';
  description = 'TaskScheduler agent — schedule one-time and recurring reminders and agent flows, list and cancel tasks.';
  flowConstructors = { TaskSchedulerFlow };
}
