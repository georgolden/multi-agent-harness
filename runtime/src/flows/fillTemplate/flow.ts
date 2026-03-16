/**
 * PocketFlow flow for the fillTemplate agent.
 *
 * Graph (reverse of taskScheduler — ask_user loops, submit_template exits):
 *
 *   PrepareInput
 *       │
 *   DecideAction ──── ask_user ──────► AskUser        (ends run; session stays running)
 *       │
 *       └─────────── submit_template ► SubmitTemplate (ends run; session completed)
 *
 * When the user replies, the flow is re-entered with the sessionId so
 * PrepareInput resumes the existing session and DecideAction runs again.
 */
import { Flow, packet } from '../../utils/agent/flow.js';
import { PrepareInput, DecideAction, AskUser, SubmitTemplate, UserResponse, WriteTempFile } from './nodes.js';
import { fillTemplateInputSchema, type FillTemplateContext } from './types.js';
import { App } from '../../app.js';
import { User } from '../../data/userRepository/types.js';
import { Session } from '../../services/sessionService/session.js';
import { createSystemPrompt } from './prompts/index.js';
import { UserMessage } from '../../utils/message.js';

export type FillTemplateFlow = Flow<App, FillTemplateContext>;

export function createFillTemplateFlow(): FillTemplateFlow {
  const prepareInput = new PrepareInput();
  const decideAction = new DecideAction();
  const writeTempFile = new WriteTempFile();
  const askUser = new AskUser();
  const userResponse = new UserResponse();
  const submitTemplate = new SubmitTemplate();

  // PrepareInput runs once, then goes to DecideAction
  prepareInput.next(decideAction);

  // DecideAction routes based on LLM response
  decideAction.branch('write_temp_file', writeTempFile);
  writeTempFile.next(decideAction);
  decideAction.branch('ask_user', askUser);
  askUser.branch('pause', userResponse);
  userResponse.next(decideAction);
  decideAction.branch('submit_template', submitTemplate);

  // AskUser ends the flow run (no successor); session stays 'running'
  // SubmitTemplate ends the flow run (no successor); session marked 'completed'

  return new Flow(prepareInput);
}

async function createSession(
  app: App,
  user: User,
  parent: Session | undefined,
  message: string,
  template: string,
): Promise<Session> {
  const timezone = await app.data.taskRepository.getUserTimezone(user.id);
  const currentDate = new Date().toISOString();
  const systemPrompt = createSystemPrompt(currentDate, timezone, template);

  const session = await app.services.sessionService.create({
    parentSessionId: parent?.id,
    userId: user.id,
    flowName: 'fillTemplate',
    systemPrompt,
  });

  await session.addUserMessage(new UserMessage(message));

  return session;
}

export const fillTemplateFlow = {
  name: 'fillTemplate',
  description:
    'FillTemplate agent flow that guides users through filling a template conversationally. It helps to:\n• Collect information step by step\n• Fill all template sections and variables\n• Submit the completed template',
  parameters: fillTemplateInputSchema,
  create: createFillTemplateFlow,
  run: async (
    app: App,
    context: { user: User; parent?: Session },
    parameters: { message: string; template: string },
  ) => {
    const { message, template } = parameters;
    const { user, parent } = context;
    const session = await createSession(app, user, parent, message, template);
    const flow = createFillTemplateFlow();
    const promise = flow.run(
      packet({
        data: { message, template },
        context: { user, parent, session },
        deps: app,
      }),
    );
    return { flow, session, promise };
  },
};
