import { Flow, type FlowSchema } from '../../utils/agent/flow.js';
import { PrepareInput, DecideAction, AskUser, SubmitTemplate, UserResponse, WriteTempFile } from './nodes.js';
import { fillTemplateInputSchema, type FillTemplateContext } from './types.js';
import type { Static } from '@sinclair/typebox';
import { App } from '../../app.js';
import { RuntimeUser } from '../../services/userService/index.js';
import { Session } from '../../services/sessionService/session.js';
import { createSystemPrompt } from './prompts/index.js';
import { SystemMessage, UserMessage } from '../../utils/message.js';

export class FillTemplateFlow extends Flow<App, FillTemplateContext>
  {

  description =
    'FillTemplate agent flow that guides users through filling a template conversationally. It helps to:\n• Collect information step by step\n• Fill all template sections and variables\n• Submit the completed template';
  parameters = fillTemplateInputSchema;

  schema: FlowSchema = {
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

  nodeConstructors = { PrepareInput, DecideAction, WriteTempFile, AskUser, UserResponse, SubmitTemplate };

  async createSession(app: App, user: RuntimeUser, parent: Session | undefined, input: Static<typeof fillTemplateInputSchema>): Promise<Session> {
    const timezone = await app.data.taskRepository.getUserTimezone(user.id);
    const currentDate = new Date().toISOString();
    const systemPrompt = createSystemPrompt(currentDate, timezone, input.template);

    const session = await app.services.sessionService.create({
      parentSessionId: parent?.id,
      userId: user.id,
      flowName: this.constructor.name,
      systemPrompt,
    });

    await session.addMessages([{ message: new SystemMessage(systemPrompt).toJSON() }]);
    await session.addUserMessage(new UserMessage(input.message));
    await session.setFlowSchema(this.toSchema());

    return session;
  }
}

export type FillTemplateFlowType = FillTemplateFlow;

