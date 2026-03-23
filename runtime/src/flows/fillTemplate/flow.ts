import { Flow, type FlowSchema, packet } from '../../utils/agent/flow.js';
import { PrepareInput, DecideAction, AskUser, SubmitTemplate, UserResponse, WriteTempFile } from './nodes.js';
import { fillTemplateInputSchema, type FillTemplateContext } from './types.js';
import { App } from '../../app.js';
import { User } from '../../data/userRepository/types.js';
import { Session } from '../../services/sessionService/session.js';
import { createSystemPrompt } from './prompts/index.js';
import { UserMessage } from '../../utils/message.js';

export const fillTemplateSchema: FlowSchema = {
  startNode: 'PrepareInput',
  nodes: {
    PrepareInput:   'DecideAction',
    DecideAction:   { write_temp_file: 'WriteTempFile', ask_user: 'AskUser', submit_template: 'SubmitTemplate' },
    WriteTempFile:  'DecideAction',
    AskUser:        { pause: 'UserResponse' },
    UserResponse:   'DecideAction',
    SubmitTemplate: null,
  },
};

export class FillTemplateFlow extends Flow<App, FillTemplateContext> {
  nodeConstructors = { PrepareInput, DecideAction, WriteTempFile, AskUser, UserResponse, SubmitTemplate };
}

export type FillTemplateFlowType = FillTemplateFlow;

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
  create: (schema: FlowSchema = fillTemplateSchema) => new FillTemplateFlow(schema),
  run: async (
    app: App,
    context: { user: User; parent?: Session },
    parameters: { message: string; template: string },
  ) => {
    const { message, template } = parameters;
    const { user, parent } = context;
    const session = await createSession(app, user, parent, message, template);
    const flow = new FillTemplateFlow(fillTemplateSchema);
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
