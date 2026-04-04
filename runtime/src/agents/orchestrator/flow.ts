import { Flow, type FlowSchema } from '../../utils/agent/flow.js';
import { PrepareInput, DecideAction, ToolCalls, AskUser, UserResponse, SubmitResult } from './nodes.js';
import { AGENT_TOOLS } from './tools.js';
import { orchestratorInputSchema, type OrchestratorContext } from './types.js';
import { App } from '../../app.js';
import { User } from '../../data/userRepository/types.js';
import { Session } from '../../services/sessionService/session.js';
import { SystemMessage, UserMessage } from '../../utils/message.js';
import { createSystemPrompt } from './prompts/index.js';

export class OrchestratorFlow extends Flow<App, OrchestratorContext>
  {

  description =
    "Orchestrator flow — understands the user's request, breaks it into tasks, and dispatches the right agents. Routes simple tasks directly to spawn_agent, uses run_agent when output is needed for subsequent steps, and asks the user only when ambiguity would cause the wrong outcome.";
  parameters = orchestratorInputSchema;

  schema: FlowSchema = {
    startNode: 'PrepareInput',
    nodes: {
      PrepareInput:  'DecideAction',
      DecideAction:  { tool_calls: 'ToolCalls', ask_user: 'AskUser', submit_result: 'SubmitResult' },
      ToolCalls:     'DecideAction',
      AskUser:       { pause: 'UserResponse' },
      UserResponse:  'DecideAction',
      SubmitResult:  null,
    },
  };

  nodeConstructors = { PrepareInput, DecideAction, ToolCalls, AskUser, UserResponse, SubmitResult };

  async createSession(app: App, user: User, parent: Session | undefined, input: { message: string }): Promise<Session> {
    const timezone = await app.data.taskRepository.getUserTimezone(user.id);
    const currentDate = new Date().toISOString();
    const agents = app.agents.getAgentsAsXml();
    const systemPrompt = createSystemPrompt(currentDate, timezone, user.name ?? user.id, agents);

    const session = await app.services.sessionService.create({
      parentSessionId: parent?.id,
      userId: user.id,
      flowName: this.constructor.name,
      systemPrompt,
    });

    session.addAgentTools(AGENT_TOOLS as any);

    await session.addMessages([{ message: new SystemMessage(systemPrompt).toJSON() }]);

    await session.addUserMessage(new UserMessage(input.message));
    await session.setFlowSchema(this.toSchema());

    return session;
  }

  override async restoreSession(_app: App, _user: User, session: Session): Promise<void> {
    session.addAgentTools(AGENT_TOOLS as any);
  }
}

export type OrchestratorFlowType = OrchestratorFlow;
