/**
 * Flow for the explore agent.
 *
 * Flow graph:
 *   PrepareInput → DecideAction ─┬─ ask_user       → AskUser        (pause)
 *                                ├─ tool_calls     → ToolCalls      (loops back to DecideAction)
 *                                └─ submit_result  → SubmitResult    (exit)
 */
import { Flow } from '../../utils/agent/flow.js';
import { PrepareInput, DecideAction, AskUser, UserResponse, ToolCalls, SubmitResult } from './nodes.js';
import { exploreInputSchema } from './types.js';
import type { ExploreContext, ExploreInput, ExploreResult } from './types.js';
import { App } from '../../app.js';
import { Session } from '../../services/sessionService/session.js';
import { createSystemPrompt, wrapUserPrompt } from './prompts/index.js';
import { SystemMessage, UserMessage } from '../../utils/message.js';
import { AGENT_TOOLS } from './tools.js';
import { FlowRunner } from '../../utils/agent/flowRunner.js';
import type { FlowContext } from '../index.js';

export type ExploreFlow = Flow<App, ExploreContext, ExploreInput, { exit: ExploreResult; loop: void }>;

export function createExploreFlow(): ExploreFlow {
  const prepareInput = new PrepareInput();
  const decideAction = new DecideAction();
  const askUser = new AskUser();
  const userResponse = new UserResponse();
  const toolCalls = new ToolCalls();
  const submitResult = new SubmitResult();

  prepareInput.next(decideAction);

  decideAction.branch('ask_user', askUser);
  decideAction.branch('tool_calls', toolCalls);
  decideAction.branch('submit_result', submitResult);
  decideAction.branch('loop', decideAction);

  askUser.branch('pause', userResponse);
  userResponse.next(decideAction);

  toolCalls.next(decideAction);

  return new Flow(prepareInput);
}

export class ExploreRunner extends FlowRunner<ExploreContext, ExploreInput> {
  readonly flowName = 'explore';
  readonly description =
    'Explore agent flow that allows users to explore and understand a codebase or problem domain. It helps to:\n• Map out project structure\n• Understand key files and their relationships\n• Identify modification targets and dependencies\n• Gather context for downstream agents';
  readonly parameters = exploreInputSchema;

  async createSession(app: App, flowContext: FlowContext, params: ExploreInput): Promise<Session> {
    const systemPrompt = createSystemPrompt();
    const userPrompt = wrapUserPrompt(params.message);

    const session = await app.services.sessionService.create({
      parentSessionId: flowContext.parent?.id,
      userId: flowContext.user.id,
      flowName: 'explore',
      systemPrompt,
    });

    session.addAgentTools(AGENT_TOOLS as any);

    await session.addMessages([{ message: new SystemMessage(systemPrompt).toJSON() }]);
    await session.addUserMessage(new UserMessage(userPrompt));

    return session;
  }

  async createContext(
    _app: App,
    flowContext: FlowContext,
    session: Session,
    params: ExploreInput,
  ): Promise<ExploreContext> {
    // On restore, re-register agent tools so session.getAgentTool() works
    if (session.tools.length === 0) {
      session.addAgentTools(AGENT_TOOLS as any);
    }
    return { parent: flowContext.parent, user: flowContext.user, message: params.message ?? '', session };
  }

  createFlow(): ExploreFlow {
    return createExploreFlow();
  }

  protected _buildStartPacket(params: ExploreInput, context: ExploreContext, app: App) {
    return { data: params.message, context, deps: app };
  }
}
