import { Flow, type FlowSchema } from '../../utils/agent/flow.js';
import { PrepareInput, DecideAction, AskUser, UserResponse, ToolCalls, SubmitResult } from './nodes.js';
import { exploreInputSchema } from './types.js';
import type { ExploreContext, ExploreInput, ExploreResult } from './types.js';
import { App } from '../../app.js';
import { Session } from '../../services/sessionService/session.js';
import { User } from '../../data/userRepository/types.js';
import { createSystemPrompt, wrapUserPrompt } from './prompts/index.js';
import { SystemMessage, UserMessage } from '../../utils/message.js';
import { AGENT_TOOLS } from './tools.js';

export const exploreSchema: FlowSchema = {
  startNode: 'PrepareInput',
  nodes: {
    PrepareInput:  'DecideAction',
    DecideAction:  { ask_user: 'AskUser', tool_calls: 'ToolCalls', submit_result: 'SubmitResult', loop: 'DecideAction' },
    AskUser:       { pause: 'UserResponse' },
    UserResponse:  'DecideAction',
    ToolCalls:     'DecideAction',
    SubmitResult:  null,
  },
};

export class ExploreFlow extends Flow<App, ExploreContext, ExploreInput, { exit: ExploreResult; loop: void }> {
  nodeConstructors = { PrepareInput, DecideAction, AskUser, UserResponse, ToolCalls, SubmitResult };
}

export type ExploreFlowType = ExploreFlow;

async function createSession(app: App, user: User, parent: Session | undefined, message: string): Promise<Session> {
  const systemPrompt = createSystemPrompt();
  const userPrompt = wrapUserPrompt(message);

  const session = await app.services.sessionService.create({
    parentSessionId: parent?.id,
    userId: user.id,
    flowName: 'explore',
    systemPrompt,
  });

  session.addAgentTools(AGENT_TOOLS as any);

  await session.addMessages([{ message: new SystemMessage(systemPrompt).toJSON() }]);
  await session.addUserMessage(new UserMessage(userPrompt));

  return session;
}

export const exploreFlow = {
  name: 'explore',
  description:
    'Explore agent flow that allows users to explore and understand a codebase or problem domain. It helps to:\n• Map out project structure\n• Understand key files and their relationships\n• Identify modification targets and dependencies\n• Gather context for downstream agents',
  parameters: exploreInputSchema,
  create: (schema: FlowSchema = exploreSchema) => new ExploreFlow(schema),
  run: async (app: App, { parent, user }: { parent?: Session; user: User }, { message }: { message: string }) => {
    const session = await createSession(app, user, parent, message);
    const flow = new ExploreFlow(exploreSchema);
    const context: ExploreContext = { parent, user, message, session };
    const promise = flow.run({ context, deps: app, data: message });
    return { flow, session, promise };
  },
};
