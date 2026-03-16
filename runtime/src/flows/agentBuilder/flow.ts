/**
 * agentBuilder flow.
 *
 * Flow graph:
 *   PrepareInput → DecideAction ─┬─ write_temp_file → WriteTempFile ─┐
 *                                │                                    └→ DecideAction (loop)
 *                                ├─ ask_user        → AskUser (pause)
 *                                │                        └→ UserResponse → DecideAction
 *                                └─ submit_answer   → SubmitAnswer (exit)
 */
import { Flow, packet } from '../../utils/agent/flow.js';
import { PrepareInput, DecideAction, WriteTempFile, AskUser, UserResponse, SubmitAnswer } from './nodes.js';
import { agentBuilderInputSchema, type AgentBuilderContext } from './types.js';
import { App } from '../../app.js';
import { User } from '../../data/userRepository/types.js';
import { Session } from '../../services/sessionService/session.js';
import { UserMessage } from '../../utils/message.js';
import { createSystemPrompt } from './prompts/index.js';

export type AgentBuilderFlow = Flow<App, AgentBuilderContext>;

export function createAgentBuilderFlow(): AgentBuilderFlow {
  const prepareInput = new PrepareInput();
  const decideAction = new DecideAction();
  const writeTempFile = new WriteTempFile();
  const askUser = new AskUser();
  const userResponse = new UserResponse();
  const submitAnswer = new SubmitAnswer();

  prepareInput.next(decideAction);

  decideAction.branch('write_temp_file', writeTempFile);
  writeTempFile.next(decideAction);

  decideAction.branch('ask_user', askUser);
  askUser.branch('pause', userResponse);
  userResponse.next(decideAction);

  decideAction.branch('submit_answer', submitAnswer);

  return new Flow(prepareInput);
}

async function createSession(app: App, user: User, parent: Session | undefined, message: string): Promise<Session> {
  const systemPrompt = createSystemPrompt();

  const session = await app.services.sessionService.create({
    parentSessionId: parent?.id,
    userId: user.id,
    flowName: 'agentBuilder',
    systemPrompt,
  });

  await session.addUserMessage(new UserMessage(message));

  return session;
}

export const agentBuilderFlow = {
  name: 'agentBuilder',
  description:
    'Agent Builder flow — guides the user through designing a complete AI agent by collaboratively filling the Agent Flow Schema, system prompt, and optional user prompt template. Produces a ready-to-use AgenticLoopSchema.',
  parameters: agentBuilderInputSchema,
  create: createAgentBuilderFlow,
  run: async (app: App, context: { user: User; parent?: Session }, parameters: { message: string }) => {
    const { user, parent } = context;
    const { message } = parameters;
    const session = await createSession(app, user, parent, message);
    const flow = createAgentBuilderFlow();
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
