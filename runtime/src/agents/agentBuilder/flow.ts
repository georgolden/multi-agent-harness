import { Flow, type FlowSchema } from '../../utils/agent/flow.js';
import { PrepareInput, DecideAction, WriteTempFile, AskUser, UserResponse, SubmitAnswer } from './nodes.js';
import { agentBuilderInputSchema, type AgentBuilderContext } from './types.js';
import { App } from '../../app.js';
import { User } from '../../data/userRepository/types.js';
import { Session } from '../../services/sessionService/session.js';
import { UserMessage } from '../../utils/message.js';
import { createSystemPrompt } from './prompts/index.js';

export class AgentBuilderFlow extends Flow<App, AgentBuilderContext>
  {

  description =
    'Agent Builder flow — guides the user through designing a complete AI agent by collaboratively filling the Agent Flow Schema, system prompt, and optional user prompt template. Produces a ready-to-use AgenticLoopSchema.';
  parameters = agentBuilderInputSchema;

  schema: FlowSchema = {
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

  nodeConstructors = { PrepareInput, DecideAction, WriteTempFile, AskUser, UserResponse, SubmitAnswer };

  async createSession(app: App, user: User, parent: Session | undefined, input: { message: string }): Promise<Session> {
    const systemPrompt = createSystemPrompt();

    const session = await app.services.sessionService.create({
      parentSessionId: parent?.id,
      userId: user.id,
      flowName: this.constructor.name,
      systemPrompt,
    });

    await session.addUserMessage(new UserMessage(input.message));
    await session.setFlowSchema(this.toSchema());

    return session;
  }
}

export type AgentBuilderFlowType = AgentBuilderFlow;
