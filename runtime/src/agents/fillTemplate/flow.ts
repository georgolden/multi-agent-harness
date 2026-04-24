import { Flow, type FlowSchema } from '../../utils/agent/flow.js';
import { PrepareInput, DecideAction, AskUser, SubmitTemplate, UserResponse, WriteTempFile } from './nodes.js';
import { fillTemplateInputSchema, type FillTemplateContext } from './types.js';
import type { Static } from '@sinclair/typebox';
import { App } from '../../app.js';
import { Session } from '../../services/sessionService/session.js';

export class FillTemplateFlow extends Flow<App, FillTemplateContext> {
  description =
    'FillTemplate agent flow that guides users through filling a template conversationally. It helps to:\n• Collect information step by step\n• Fill all template sections and variables\n• Submit the completed template';
  parameters = fillTemplateInputSchema;

  schema: FlowSchema = {
    startNode: 'PrepareInput',
    nodes: {
      PrepareInput:   'DecideAction',
      DecideAction:   { write_temp_file: 'WriteTempFile', ask_user: 'AskUser', submit_template: 'SubmitTemplate' },
      WriteTempFile:  'PrepareInput',
      AskUser:        { pause: 'UserResponse' },
      UserResponse:   'PrepareInput',
      SubmitTemplate: null,
    },
  };

  nodeConstructors = { PrepareInput, DecideAction, WriteTempFile, AskUser, UserResponse, SubmitTemplate };

  async createSession(app: App, user: unknown, parent: Session | undefined, _input: Static<typeof fillTemplateInputSchema>): Promise<Session> {
    const session = await app.services.sessionService.create({
      parentSessionId: parent?.id,
      userId: (user as { id: string }).id,
      flowName: this.constructor.name,
    });
    await session.setFlowSchema(this.toSchema());
    return session;
  }
}

export type FillTemplateFlowType = FillTemplateFlow;
