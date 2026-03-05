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
import { PrepareInput, DecideAction, AskUser, SubmitTemplate, UserResponse } from './nodes.js';
import { fillTemplateInputSchema, type FillTemplateContext } from './types.js';
import { App } from '../../app.js';
import { User } from '../../data/userRepository/types.js';
import { Session } from '../../services/sessionService/session.js';

export type FillTemplateFlow = Flow<App, FillTemplateContext>;

export function createFillTemplateFlow(): FillTemplateFlow {
  const prepareInput = new PrepareInput();
  const decideAction = new DecideAction();
  const askUser = new AskUser();
  const userResponse = new UserResponse();
  const submitTemplate = new SubmitTemplate();

  // PrepareInput runs once, then goes to DecideAction
  prepareInput.next(decideAction);

  // DecideAction routes based on LLM response
  decideAction.branch('ask_user', askUser);
  askUser.branch('pause', userResponse);
  userResponse.next(decideAction);
  decideAction.branch('submit_template', submitTemplate);

  // AskUser ends the flow run (no successor); session stays 'running'
  // SubmitTemplate ends the flow run (no successor); session marked 'completed'

  return new Flow(prepareInput);
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
    const flow = createFillTemplateFlow();
    const { message, template } = parameters;
    const { user, parent } = context;
    const result = await flow.run(
      packet({
        data: message,
        context: { userId: user.id, template, parentId: parent?.id },
        deps: app,
      }),
    );
    return result.data;
  },
};
