import { Flow, type FlowSchema, packet } from '../../utils/agent/flow.js';
import { PrepareInput, DecideAction, ToolCalls, AskUser, UserResponse, SubmitResult } from './nodes.js';
import { AGENT_TOOLS } from './tools.js';
import { orchestratorInputSchema, type OrchestratorContext } from './types.js';
import { App } from '../../app.js';
import { User } from '../../data/userRepository/types.js';
import { Session } from '../../services/sessionService/session.js';
import { UserMessage } from '../../utils/message.js';
import { createSystemPrompt } from './prompts/index.js';

export const orchestratorSchema: FlowSchema = {
  startNode: 'PrepareInput',
  nodes: {
    PrepareInput:  'DecideAction',
    DecideAction:  { tool_calls: 'ToolCalls', loop: 'DecideAction', ask_user: 'AskUser', submit_result: 'SubmitResult' },
    ToolCalls:     'DecideAction',
    AskUser:       { pause: 'UserResponse' },
    UserResponse:  'DecideAction',
    SubmitResult:  null,
  },
};

export class OrchestratorFlow extends Flow<App, OrchestratorContext> {
  nodeConstructors = { PrepareInput, DecideAction, ToolCalls, AskUser, UserResponse, SubmitResult };
}

export type OrchestratorFlowType = OrchestratorFlow;

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
  create: (schema: FlowSchema = orchestratorSchema) => new OrchestratorFlow(schema),
  run: async (app: App, context: { user: User; parent?: Session }, parameters: { message: string }) => {
    const { user, parent } = context;
    const { message } = parameters;
    const session = await createSession(app, user, parent, message);
    const flow = new OrchestratorFlow(orchestratorSchema);
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
