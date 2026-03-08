/**
 * Flow for the explore agent.
 * Connects all nodes in a clear, directed graph.
 *
 * Flow graph:
 *   PrepareInput → DecideAction ─┬─ ask_user       → AskUser        (pause; session stays running)
 *                                ├─ tool_calls     → ToolCalls      (loops back to DecideAction)
 *                                └─ submit_result  → SubmitResult    (exit; session completed)
 */
import { Flow } from '../../utils/agent/flow.js';
import { PrepareInput, DecideAction, AskUser, UserResponse, ToolCalls, SubmitResult } from './nodes.js';
import { exploreInputSchema } from './types.js';
import type { ExploreContext, ExploreInput, ExploreResult } from './types.js';
import { App } from '../../app.js';
import { Session } from '../../services/sessionService/session.js';
import { User } from '../../data/userRepository/types.js';
import { createSystemPrompt, wrapUserPrompt } from './prompts/index.js';
import { SystemMessage, UserMessage } from '../../utils/message.js';
import { AGENT_TOOLS } from './tools.js';

export type ExploreFlow = Flow<App, ExploreContext, ExploreInput, { exit: ExploreResult; loop: void }>;

/**
 * Create and return the explore agent flow
 */
export function createExploreFlow(): ExploreFlow {
  // Create nodes
  const prepareInput = new PrepareInput();
  const decideAction = new DecideAction();
  const askUser = new AskUser();
  const userResponse = new UserResponse();
  const toolCalls = new ToolCalls();
  const submitResult = new SubmitResult();

  // PrepareInput runs once, then goes to DecideAction
  prepareInput.next(decideAction);

  // DecideAction routes to different actions
  decideAction.branch('ask_user', askUser);
  decideAction.branch('tool_calls', toolCalls);
  decideAction.branch('submit_result', submitResult);
  decideAction.branch('loop', decideAction);

  // AskUser pauses and resumes with UserResponse
  askUser.branch('pause', userResponse);
  userResponse.next(decideAction);

  // ToolCalls loops back to DecideAction
  toolCalls.next(decideAction);

  // Create flow starting with PrepareInput
  return new Flow(prepareInput);
}

async function createSession(app: App, user: User, parent: Session | undefined, message: string): Promise<Session> {
  const systemPrompt = createSystemPrompt();
  const userPrompt = wrapUserPrompt(message);

  const session = await app.services.sessionService.create({
    parentSessionId: parent?.id,
    userId: user.id,
    flowName: 'explore',
    systemPrompt,
  });

  session.addAgentTools(AGENT_TOOLS as any);

  await session.addMessages([
    { message: new SystemMessage(systemPrompt).toJSON() },
    { message: new UserMessage(userPrompt).toJSON() },
  ]);

  return session;
}

export const exploreFlow = {
  name: 'explore',
  description:
    'Explore agent flow that allows users to explore and understand a codebase or problem domain. It helps to:\n• Map out project structure\n• Understand key files and their relationships\n• Identify modification targets and dependencies\n• Gather context for downstream agents',
  parameters: exploreInputSchema,
  create: createExploreFlow,
  run: async (app: App, { parent, user }: { parent?: Session; user: User }, { message }: { message: string }) => {
    const session = await createSession(app, user, parent, message);
    const flow = createExploreFlow();
    const context: ExploreContext = { parent, user, message, session };
    const result = await flow.run({ context, deps: app, data: message });
    return result.data;
  },
};
