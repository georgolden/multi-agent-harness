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
import { Flow } from 'pocketflow';
import { PrepareInput, DecideAction, AskUser, SubmitTemplate } from './nodes.js';
import type { SharedStore } from '../../types.js';
import { fillTemplateInputSchema, type FillTemplateContext } from './types.js';
import { App } from '../../app.js';
import { User } from '../../data/userRepository/types.js';

export type FillTemplateFlow = Flow<SharedStore<FillTemplateContext>>;

export function createFillTemplateFlow(): Flow<SharedStore<FillTemplateContext>> {
  const prepareInput = new PrepareInput();
  const decideAction = new DecideAction();
  const askUser = new AskUser();
  const submitTemplate = new SubmitTemplate();

  // PrepareInput runs once, then goes to DecideAction
  prepareInput.next(decideAction);

  // DecideAction routes based on LLM response
  decideAction.on('ask_user', askUser);
  decideAction.on('submit_template', submitTemplate);

  // AskUser ends the flow run (no successor); session stays 'running'
  // SubmitTemplate ends the flow run (no successor); session marked 'completed'

  return new Flow<SharedStore<FillTemplateContext>>(prepareInput);
}

export const fillTemplateFlow = {
  name: 'fillTemplate',
  description:
    'FillTemplate agent flow that guides users through filling a template conversationally. It helps to:\n• Collect information step by step\n• Fill all template sections and variables\n• Submit the completed template',
  parameters: fillTemplateInputSchema,
  create: createFillTemplateFlow,
  run: async (
    app: App,
    { user, message, template, sessionId }: { user: User; message: string; template?: string; sessionId?: string },
  ) => {
    const flow = createFillTemplateFlow();
    const shared: SharedStore<FillTemplateContext> = {
      app,
      context: { userId: user.id, message, template, sessionId },
    };
    await flow.run(shared);
    return shared.context.result;
  },
};
