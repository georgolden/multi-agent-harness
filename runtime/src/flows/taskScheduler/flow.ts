/**
 * Flow for the taskScheduler agent.
 */
import type { Session } from '../../services/sessionService/index.js';
import { Flow } from '../../utils/agent/flow.js';
import { PrepareInput, DecideAction, AskUser, ToolCalls, Response, UserResponse } from './nodes.js';
import { taskSchedulerInputSchema, type TaskSchedulerContext, type TaskSchedulerInput } from './types.js';
import { App } from '../../app.js';
import { createSystemPrompt } from './prompts/index.js';
import { UserMessage } from '../../utils/message.js';
import { FlowRunner } from '../../utils/agent/flowRunner.js';
import type { FlowContext } from '../index.js';

export type TaskSchedulerFlow = Flow<any, TaskSchedulerContext>;

export function createTaskSchedulerFlow(): TaskSchedulerFlow {
  const prepareInput = new PrepareInput();
  const decideAction = new DecideAction();
  const askUser = new AskUser();
  const userResponse = new UserResponse();
  const response = new Response();
  const toolCalls = new ToolCalls();

  prepareInput.next(decideAction);

  decideAction.branch('ask_user', askUser);
  decideAction.branch('tool_calls', toolCalls);
  decideAction.branch('response', response);

  askUser.branch('pause', userResponse);
  userResponse.next(decideAction);

  toolCalls.next(decideAction);

  return new Flow(prepareInput);
}

export class TaskSchedulerRunner extends FlowRunner<TaskSchedulerContext, TaskSchedulerInput> {
  readonly flowName = 'taskScheduler';
  readonly description =
    'TaskScheduler agent flow that allows users to schedule tasks. It helps to:\n• Schedule one-time reminders and agent flows\n• Set up recurring reminders and agent flows\n• List your active tasks\n• Cancel tasks';
  readonly parameters = taskSchedulerInputSchema;

  async createSession(app: App, flowContext: FlowContext, params: TaskSchedulerInput): Promise<Session> {
    const { data, services } = app;
    const user = flowContext.user;

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

    await session.addUserMessage(new UserMessage(params.message));
    return session;
  }

  async createContext(
    _app: App,
    flowContext: FlowContext,
    session: Session,
    _params: TaskSchedulerInput,
  ): Promise<TaskSchedulerContext> {
    return { user: flowContext.user, parent: flowContext.parent, session };
  }

  createFlow(): TaskSchedulerFlow {
    return createTaskSchedulerFlow();
  }

  protected _buildStartPacket(params: TaskSchedulerInput, context: TaskSchedulerContext, app: App) {
    return { deps: app, context, data: params.message };
  }
}
