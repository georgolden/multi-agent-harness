/**
 * PocketFlow flow for the reminder agent.
 * Connects all nodes in a clear, directed graph.
 */
import { Flow } from 'pocketflow';
import { DecideAction, AskUser, ToolCalls } from './nodes.js';
import type { SharedStore } from '../../types.js';

export type ReminderFlow = Flow<SharedStore>;

/**
 * Create and return the reminder agent flow
 */
export function createReminderFlow(): Flow<SharedStore> {
  // Create nodes
  const decideAction = new DecideAction();
  const askUser = new AskUser();
  const toolCalls = new ToolCalls();

  // DecideAction routes to different actions
  decideAction.on('need_info', askUser);
  decideAction.on('tool_calls', toolCalls);

  // AskUser ends the flow (response is the question)

  // ToolCalls loop to decideAction
  toolCalls.next(decideAction);

  // Create flow starting with DecideAction
  return new Flow<SharedStore>(decideAction);
}
