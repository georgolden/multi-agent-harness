/**
 * Flow for the taskScheduler agent.
 * Connects all nodes in a clear, directed graph.
 */
import type { Session } from '../../services/sessionService/index.js';
import { Flow } from '../../utils/agent/flow.js';
import { PrepareInput, DecideAction, AskUser, ToolCalls, Response, UserResponse } from './nodes.js';
import { taskSchedulerInputSchema, type TaskSchedulerContext } from './types.js';
import { App } from '../../app.js';
import { User } from '../../data/userRepository/types.js';

export type TaskSchedulerFlow = Flow<any, TaskSchedulerContext>;

/**
 * Create and return the taskScheduler agent flow
 */
export function createTaskSchedulerFlow(): TaskSchedulerFlow {
  // Create nodes
  const prepareInput = new PrepareInput();
  const decideAction = new DecideAction();
  const askUser = new AskUser();
  const userResponse = new UserResponse();
  const response = new Response();
  const toolCalls = new ToolCalls();

  // PrepareInput runs once, then goes to DecideAction
  prepareInput.next(decideAction);

  // DecideAction routes to different actions
  decideAction.branch('ask_user', askUser);
  decideAction.branch('tool_calls', toolCalls);
  decideAction.branch('response', response);

  askUser.branch('pause', userResponse);

  userResponse.next(decideAction);

  // ToolCalls loops back to DecideAction
  toolCalls.next(decideAction);

  // Create flow starting with PrepareInput
  return new Flow(prepareInput);
}

export const taskSchedulerFlow = {
  name: 'taskScheduler',
  description:
    'TaskScheduler agent flow that allows users to schedule tasks. It helps to:\n• Schedule one-time reminders and agent flows\n• Set up recurring reminders and agent flows\n• List your active tasks\n• Cancel tasks',
  parameters: taskSchedulerInputSchema,
  create: createTaskSchedulerFlow,
  run: async (app: App, context: { user: User; parent?: Session }, parameters: { message: string }) => {
    const { user, parent } = context;
    const { message } = parameters;
    const flow = createTaskSchedulerFlow();
    return flow.run({ deps: app, context: { userId: user.id, parent }, data: message });
  },
};
