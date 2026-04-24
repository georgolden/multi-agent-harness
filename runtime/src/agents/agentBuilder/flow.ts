import { Flow, type FlowSchema } from '../../utils/agent/flow.js';
import { PrepareInput, DecideAction, WriteTempFile, GetToolkitTools, AskUser, UserResponse, SubmitAnswer } from './nodes.js';
import { agentBuilderInputSchema, type AgentBuilderContext } from './types.js';
import { App } from '../../app.js';
import { Session } from '../../services/sessionService/session.js';

export class AgentBuilderFlow extends Flow<App, AgentBuilderContext> {
  description =
    'Agent Builder flow — guides the user through designing a complete AI agent by collaboratively filling the Agent Flow Schema, system prompt, and optional user prompt template. Produces a ready-to-use AgenticLoopSchema.';
  parameters = agentBuilderInputSchema;

  schema: FlowSchema = {
    startNode: 'PrepareInput',
    nodes: {
      PrepareInput: 'DecideAction',
      DecideAction: { write_temp_file: 'WriteTempFile', get_toolkit_tools: 'GetToolkitTools', ask_user: 'AskUser', submit_result: 'SubmitAnswer' },
      WriteTempFile: 'PrepareInput',
      GetToolkitTools: 'PrepareInput',
      AskUser: { pause: 'UserResponse' },
      UserResponse: 'PrepareInput',
      SubmitAnswer: { error: 'PrepareInput' },
    },
  };

  nodeConstructors = { PrepareInput, DecideAction, WriteTempFile, GetToolkitTools, AskUser, UserResponse, SubmitAnswer };

  async createSession(
    app: App,
    user: unknown,
    parent: Session | undefined,
    _input: { message: string },
  ): Promise<Session> {
    const session = await app.services.sessionService.create({
      parentSessionId: parent?.id,
      userId: (user as { id: string }).id,
      flowName: this.constructor.name,
    });
    await session.setFlowSchema(this.toSchema());
    return session;
  }
}

export type AgentBuilderFlowType = AgentBuilderFlow;
