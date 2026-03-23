import { Flow, type FlowSchema, packet } from '../../utils/agent/flow.js';
import { PrepareInput, DecideAction, WriteTempFile, AskUser, UserResponse, SubmitAnswer } from './nodes.js';
import { agentBuilderInputSchema, type AgentBuilderContext } from './types.js';
import { App } from '../../app.js';
import { User } from '../../data/userRepository/types.js';
import { Session } from '../../services/sessionService/session.js';
import { UserMessage } from '../../utils/message.js';
import { createSystemPrompt } from './prompts/index.js';

export const agentBuilderSchema: FlowSchema = {
  startNode: 'PrepareInput',
  nodes: {
    PrepareInput:  'DecideAction',
    DecideAction:  { write_temp_file: 'WriteTempFile', ask_user: 'AskUser', submit_answer: 'SubmitAnswer' },
    WriteTempFile: 'DecideAction',
    AskUser:       { pause: 'UserResponse' },
    UserResponse:  'DecideAction',
    SubmitAnswer:  null,
  },
};

export class AgentBuilderFlow extends Flow<App, AgentBuilderContext> {
  nodeConstructors = { PrepareInput, DecideAction, WriteTempFile, AskUser, UserResponse, SubmitAnswer };
}

export type AgentBuilderFlowType = AgentBuilderFlow;

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
  create: (schema: FlowSchema = agentBuilderSchema) => new AgentBuilderFlow(schema),
  run: async (app: App, context: { user: User; parent?: Session }, parameters: { message: string }) => {
    const { user, parent } = context;
    const { message } = parameters;
    const session = await createSession(app, user, parent, message);
    const flow = new AgentBuilderFlow(agentBuilderSchema);
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
