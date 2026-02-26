/**
 * PocketFlow flow for the reminder agent.
 * Connects all nodes in a clear, directed graph.
 */
import { Flow } from '../../utils/agent/flow.js';
import { PrepareInput, DecideAction, ToolCalls } from './nodes.js';
import { exploreInputSchema } from './types.js';
import type { ExploreDeps, ExploreContext, ExploreInput, ExploreResult } from './types.js';
import { App } from '../../app.js';
import { Session } from '../../services/sessionService/session.js';
import { User } from '../../data/userRepository/types.js';

export type ExploreFlow = Flow<ExploreDeps, ExploreContext, ExploreInput, { exit: ExploreResult; loop: void }>;

/**
 * Create and return the explore agent flow
 */
export function createExploreFlow(): ExploreFlow {
  // Create nodes
  const prepareInput = new PrepareInput();
  const decideAction = new DecideAction();
  const toolCalls = new ToolCalls();

  // PrepareInput runs once, then goes to DecideAction
  prepareInput.next(decideAction);

  // DecideAction routes to different actions
  decideAction.branch('loop', decideAction);
  decideAction.branch('tool_calls', toolCalls);

  // ToolCalls: 'loop' continues back to DecideAction
  toolCalls.branch('loop', decideAction);

  // Create flow starting with PrepareInput
  return new Flow(prepareInput);
}

export const exploreFlow = {
  name: 'explore',
  description:
    'Explore agent flow that allows users to schedule tasks. It helps to:\n• Schedule one-time tasks\n• Set up recurring tasks\n• List your active tasks\n• Cancel tasks',
  parameters: exploreInputSchema,
  create: createExploreFlow,
  run: async (app: App, { parent, user, message }: { parent?: Session; user: User; message: string }) => {
    const flow = createExploreFlow();
    const context: ExploreContext = { parent, user, message, iterations: 0 };
    const deps: ExploreDeps = { app };
    const result = await flow.run({ context, deps, data: { message } });
    return result.data;
  },
};
