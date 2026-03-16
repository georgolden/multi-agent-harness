/**
 * Orchestrator flow.
 *
 * Flow graph:
 *   PrepareInput → DecideAction ─┬─ tool_calls    → ToolCalls ─┐
 *                                │                               └→ DecideAction (loop)
 *                                ├─ loop          ──────────────→ DecideAction (loop)
 *                                ├─ ask_user      → AskUser (pause)
 *                                │                      └→ UserResponse → DecideAction
 *                                └─ submit_result → SubmitResult (exit)
 */
import { Flow, packet } from '../../utils/agent/flow.js';
import {
  PrepareInput,
  DecideAction,
  ToolCalls,
  AskUser,
  UserResponse,
  SubmitResult,
} from './nodes.js';
import { AGENT_TOOLS } from './tools.js';
import { orchestratorInputSchema, type OrchestratorContext } from './types.js';
import { App } from '../../app.js';
import { User } from '../../data/userRepository/types.js';
import { Session } from '../../services/sessionService/session.js';
import { UserMessage } from '../../utils/message.js';
import { createSystemPrompt } from './prompts/index.js';

export type OrchestratorFlow = Flow<App, OrchestratorContext>;

export function createOrchestratorFlow(): OrchestratorFlow {
  const prepareInput = new PrepareInput();
  const decideAction = new DecideAction();
  const toolCalls = new ToolCalls();
  const askUser = new AskUser();
  const userResponse = new UserResponse();
  const submitResult = new SubmitResult();

  prepareInput.next(decideAction);

  decideAction.branch('tool_calls', toolCalls);
  toolCalls.next(decideAction);

  decideAction.branch('loop', decideAction);

  decideAction.branch('ask_user', askUser);
  askUser.branch('pause', userResponse);
  userResponse.next(decideAction);

  decideAction.branch('submit_result', submitResult);

  return new Flow(prepareInput);
}

async function createSession(
  app: App,
  user: User,
  parent: Session | undefined,
  message: string,
): Promise<Session> {
  const timezone = await app.data.taskRepository.getUserTimezone(user.id);
  const currentDate = new Date().toISOString();
  const flows = app.flows.getFlowsAsXml();
  const systemPrompt = createSystemPrompt(currentDate, timezone, user.name ?? user.id, flows);

  const session = await app.services.sessionService.create({
    parentSessionId: parent?.id,
    userId: user.id,
    flowName: 'orchestrator',
    systemPrompt,
  });

  session.addAgentTools(AGENT_TOOLS as any);

  await session.addUserMessage(new UserMessage(message));

  return session;
}

export const orchestratorFlow = {
  name: 'orchestrator',
  description:
    'Orchestrator flow — understands the user\'s request, breaks it into tasks, and dispatches the right agents. Routes simple tasks directly to spawn_agent, uses run_agent when output is needed for subsequent steps, and asks the user only when ambiguity would cause the wrong outcome.',
  parameters: orchestratorInputSchema,
  create: createOrchestratorFlow,
  run: async (app: App, context: { user: User; parent?: Session }, parameters: { message: string }) => {
    const { user, parent } = context;
    const { message } = parameters;
    const session = await createSession(app, user, parent, message);
    const flow = createOrchestratorFlow();
    const promise = flow.run(
      packet({
        data: { message },
        context: { user, parent, session },
        deps: app,
      }),
    );
    return { flow, session, promise };
  },
};
