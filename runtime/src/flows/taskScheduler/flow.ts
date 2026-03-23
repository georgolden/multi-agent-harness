import type { Session } from '../../services/sessionService/index.js';
import { Flow, type FlowSchema } from '../../utils/agent/flow.js';
import { PrepareInput, DecideAction, AskUser, ToolCalls, Response, UserResponse } from './nodes.js';
import { taskSchedulerInputSchema, type TaskSchedulerContext } from './types.js';
import { App } from '../../app.js';
import { User } from '../../data/userRepository/types.js';
import { createSystemPrompt } from './prompts/index.js';
import { UserMessage } from '../../utils/message.js';

export const taskSchedulerSchema: FlowSchema = {
  startNode: 'PrepareInput',
  nodes: {
    PrepareInput: 'DecideAction',
    DecideAction: { ask_user: 'AskUser', tool_calls: 'ToolCalls', response: 'Response' },
    AskUser: { pause: 'UserResponse' },
    UserResponse: 'DecideAction',
    ToolCalls: 'DecideAction',
    Response: null,
  },
};

export class TaskSchedulerFlow extends Flow<App, TaskSchedulerContext> {
  nodeConstructors = { PrepareInput, DecideAction, AskUser, ToolCalls, Response, UserResponse };
}

async function createSession(app: App, user: User, message: string): Promise<Session> {
  const { data, services } = app;

  const userTasks = await data.taskRepository.getTasks(user.id);
  const timezone = await data.taskRepository.getUserTimezone(user.id);
  const currentDate = new Date().toISOString();
  const tasksSchema = app.tasks.getTasksSchema();

  const systemPrompt = createSystemPrompt(currentDate, timezone, JSON.stringify(userTasks), tasksSchema);

  const session = await services.sessionService.create({
    userId: user.id,
    flowName: 'taskScheduler',
    systemPrompt,
  });

  await session.addUserMessage(new UserMessage(message));

  return session;
}

export const taskSchedulerFlow = {
  name: 'taskScheduler',
  description:
    'TaskScheduler agent flow that allows users to schedule tasks. It helps to:\n• Schedule one-time reminders and agent flows\n• Set up recurring reminders and agent flows\n• List your active tasks\n• Cancel tasks',
  parameters: taskSchedulerInputSchema,
  create: (schema: FlowSchema = taskSchedulerSchema) => new TaskSchedulerFlow(schema),
  run: async (app: App, context: { user: User; parent?: Session }, parameters: { message: string }) => {
    const { user, parent } = context;
    const { message } = parameters;
    const session = await createSession(app, user, message);
    const flow = new TaskSchedulerFlow(taskSchedulerSchema);
    const promise = flow.run({ deps: app, context: { user, parent, session }, data: message });
    return { flow, session, promise };
  },
};
