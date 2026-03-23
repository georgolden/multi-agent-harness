/**
 * PocketFlow flow for the fillTemplate agent.
 *
 * Graph:
 *   PrepareInput → DecideAction ─┬─ write_temp_file → WriteTempFile → DecideAction (loop)
 *                                ├─ ask_user        → AskUser (pause) → UserResponse → DecideAction
 *                                └─ submit_template → SubmitTemplate (exit)
 */
import { Flow, packet } from '../../utils/agent/flow.js';
import { PrepareInput, DecideAction, AskUser, SubmitTemplate, UserResponse, WriteTempFile } from './nodes.js';
import { fillTemplateInputSchema, type FillTemplateContext } from './types.js';
import { type Static } from '@sinclair/typebox';

type FillTemplateParams = Static<typeof fillTemplateInputSchema>;
import { App } from '../../app.js';
import { Session } from '../../services/sessionService/session.js';
import { createSystemPrompt } from './prompts/index.js';
import { UserMessage } from '../../utils/message.js';
import { FlowRunner } from '../../utils/agent/flowRunner.js';
import type { FlowContext } from '../index.js';

export type FillTemplateFlow = Flow<App, FillTemplateContext>;

export function createFillTemplateFlow(): FillTemplateFlow {
  const prepareInput = new PrepareInput();
  const decideAction = new DecideAction();
  const writeTempFile = new WriteTempFile();
  const askUser = new AskUser();
  const userResponse = new UserResponse();
  const submitTemplate = new SubmitTemplate();

  prepareInput.next(decideAction);

  decideAction.branch('write_temp_file', writeTempFile);
  writeTempFile.next(decideAction);
  decideAction.branch('ask_user', askUser);
  askUser.branch('pause', userResponse);
  userResponse.next(decideAction);
  decideAction.branch('submit_template', submitTemplate);

  return new Flow(prepareInput);
}

export class FillTemplateRunner extends FlowRunner<FillTemplateContext, FillTemplateParams> {
  readonly flowName = 'fillTemplate';
  readonly description =
    'FillTemplate agent flow that guides users through filling a template conversationally. It helps to:\n• Collect information step by step\n• Fill all template sections and variables\n• Submit the completed template';
  readonly parameters = fillTemplateInputSchema;

  async createSession(app: App, flowContext: FlowContext, params: FillTemplateParams): Promise<Session> {
    const timezone = await app.data.taskRepository.getUserTimezone(flowContext.user.id);
    const currentDate = new Date().toISOString();
    const systemPrompt = createSystemPrompt(currentDate, timezone, params.template);

    const session = await app.services.sessionService.create({
      parentSessionId: flowContext.parent?.id,
      userId: flowContext.user.id,
      flowName: 'fillTemplate',
      systemPrompt,
    });

    await session.addUserMessage(new UserMessage(params.message));
    return session;
  }

  async createContext(
    _app: App,
    flowContext: FlowContext,
    session: Session,
    _params: FillTemplateParams,
  ): Promise<FillTemplateContext> {
    return { user: flowContext.user, parent: flowContext.parent, session };
  }

  createFlow(): FillTemplateFlow {
    return createFillTemplateFlow();
  }

  protected sessionCarryingNodes(): string[] {
    return ['PrepareInput', 'DecideAction', 'WriteTempFile'];
  }

  protected _buildStartPacket(params: FillTemplateParams, context: FillTemplateContext, app: App) {
    return packet({ data: params, context, deps: app });
  }
}
