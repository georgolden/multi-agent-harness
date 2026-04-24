import { Flow, type FlowSchema } from '../../utils/agent/flow.js';
import { PrepareInput, DecideAction, ToolCalls, Response } from './nodes.js';
import { taskSchedulerInputSchema, type TaskSchedulerContext } from './types.js';
import { App } from '../../app.js';
import { RuntimeUser } from '../../services/userService/index.js';
import { Session } from '../../services/sessionService/session.js';

export class TaskSchedulerFlow extends Flow<App, TaskSchedulerContext> {
  description =
    'TaskScheduler agent flow that allows users to schedule tasks. It helps to:\n• Schedule one-time reminders and agent flows\n• Set up recurring reminders and agent flows\n• List your active tasks\n• Cancel tasks';
  parameters = taskSchedulerInputSchema;

  schema: FlowSchema = {
    startNode: 'PrepareInput',
    nodes: {
      PrepareInput: 'DecideAction',
      DecideAction: { tool_calls: 'ToolCalls', response: 'Response' },
      ToolCalls:    'PrepareInput',
      Response:     null,
    },
  };

  nodeConstructors = { PrepareInput, DecideAction, ToolCalls, Response };

  async createSession(app: App, user: RuntimeUser, _parent: Session | undefined, _input: { message: string }): Promise<Session> {
    const session = await app.services.sessionService.create({
      userId: user.id,
      flowName: this.constructor.name,
    });
    await session.setFlowSchema(this.toSchema());
    return session;
  }
}
