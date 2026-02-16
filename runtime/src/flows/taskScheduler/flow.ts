/**
 * PocketFlow flow for the reminder agent.
 * Connects all nodes in a clear, directed graph.
 */
import { Flow } from 'pocketflow';
import { PrepareInput, DecideAction, AskUser, ToolCalls } from './nodes.js';
import type { SharedStore } from '../../types.js';
import { taskSchedulerInputSchema, type TaskSchedulerContext } from './types.js';

export type TaskSchedulerFlow = Flow<SharedStore<TaskSchedulerContext>>;

/**
 * Create and return the reminder agent flow
 */
export function createTaskSchedulerFlow(): Flow<SharedStore<TaskSchedulerContext>> {
  // Create nodes
  const prepareInput = new PrepareInput();
  const decideAction = new DecideAction();
  const askUser = new AskUser();
  const toolCalls = new ToolCalls();

  // PrepareInput runs once, then goes to DecideAction
  prepareInput.next(decideAction);

  // DecideAction routes to different actions
  decideAction.on('ask_user', askUser);
  decideAction.on('tool_calls', toolCalls);

  // AskUser ends the flow (response is the question)

  // ToolCalls loops back to DecideAction
  toolCalls.next(decideAction);

  // Create flow starting with PrepareInput
  return new Flow<SharedStore<TaskSchedulerContext>>(prepareInput);
}

export const taskSchedulerFlow = {
  name: 'reminder',
  description:
    'TaskScheduler agent flow that allows users to schedule tasks. It helps to:\n• Schedule one-time tasks\n• Set up recurring tasks\n• List your active tasks\n• Cancel tasks',
  parameters: taskSchedulerInputSchema,
  create: createTaskSchedulerFlow,
};
