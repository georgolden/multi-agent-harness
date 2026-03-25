import { Flow, type FlowSchema } from '../../utils/agent/flow.js';
import { PrepareInput, DecideAction, AskUser, ToolCalls, Response, UserResponse } from './nodes.js';
import { taskSchedulerInputSchema, type TaskSchedulerContext } from './types.js';
import { App } from '../../app.js';
import { User } from '../../data/userRepository/types.js';
import { Session } from '../../services/sessionService/session.js';
import { createSystemPrompt } from './prompts/index.js';
import { UserMessage } from '../../utils/message.js';

export class TaskSchedulerFlow extends Flow<App, TaskSchedulerContext>
  {

  name = 'taskScheduler';
  description =
    'TaskScheduler agent flow that allows users to schedule tasks. It helps to:\n• Schedule one-time reminders and agent flows\n• Set up recurring reminders and agent flows\n• List your active tasks\n• Cancel tasks';
  parameters = taskSchedulerInputSchema;

  schema: FlowSchema = {
    startNode: 'PrepareInput',
    nodes: {
      PrepareInput: 'DecideAction',
      DecideAction: { ask_user: 'AskUser', tool_calls: 'ToolCalls', response: 'Response' },
      AskUser:      { pause: 'UserResponse' },
      UserResponse: 'DecideAction',
      ToolCalls:    'DecideAction',
      Response:     null,
    },
  };

  nodeConstructors = { PrepareInput, DecideAction, AskUser, ToolCalls, Response, UserResponse };

  async createSession(app: App, user: User, _parent: Session | undefined, input: { message: string }): Promise<Session> {
    const { data, services } = app;

    const userTasks = await data.taskRepository.getTasks(user.id);
    const timezone = await data.taskRepository.getUserTimezone(user.id);
    const currentDate = new Date().toISOString();
    const tasksSchema = app.tasks.getTasksSchema();

    const systemPrompt = createSystemPrompt(currentDate, timezone, JSON.stringify(userTasks), tasksSchema);

    const session = await services.sessionService.create({
      userId: user.id,
      flowName: this.name,
      systemPrompt,
    });

    await session.addUserMessage(new UserMessage(input.message));
    await session.setFlowSchema(this.toSchema());

    return session;
  }
}

