/**
 * PocketFlow flow for the reminder agent.
 * Connects all nodes in a clear, directed graph.
 */
import { Flow } from 'pocketflow';
import { PrepareInput, DecideAction, ToolCalls } from './nodes.js';
import type { SharedStore } from '../../types.js';
import { exploreInputSchema, type ExploreContext } from './types.js';
import { App } from '../../app.js';
import { Session } from '../../services/sessionService/session.js';
import { User } from '../../data/userRepository/types.js';

export type ExploreFlow = Flow<SharedStore<ExploreContext>>;

/**
 * Create and return the reminder agent flow
 */
export function createExploreFlow(): Flow<SharedStore<ExploreContext>> {
  // Create nodes
  const prepareInput = new PrepareInput();
  const decideAction = new DecideAction();
  const toolCalls = new ToolCalls();

  // PrepareInput runs once, then goes to DecideAction
  prepareInput.next(decideAction);

  // DecideAction routes to different actions
  decideAction.on('loop', decideAction);
  decideAction.on('tool_calls', toolCalls);

  // AskUser ends the flow (response is the question)

  // ToolCalls: 'loop' continues back to DecideAction, 'done' ends the flow
  toolCalls.on('loop', decideAction);

  // Create flow starting with PrepareInput
  return new Flow<SharedStore<ExploreContext>>(prepareInput);
}

export const exploreFlow = {
  name: 'reminder',
  description:
    'Explore agent flow that allows users to schedule tasks. It helps to:\n• Schedule one-time tasks\n• Set up recurring tasks\n• List your active tasks\n• Cancel tasks',
  parameters: exploreInputSchema,
  create: createExploreFlow,
  run: async (app: App, { parent, user, message }: { parent?: Session; user: User; message: string }) => {
    const flow = createExploreFlow();
    const shared: SharedStore<ExploreContext> = { app, context: { parent, user, message, iterations: 0 } };
    await flow.run(shared);
    return shared.context.result;
  },
};
