import { Flow, type FlowSchema } from '../../utils/agent/flow.js';
import { PrepareInput, DecideAction, ToolCalls, AskUser, UserResponse, SubmitResult } from './nodes.js';
import { AGENT_TOOLS } from './tools.js';
import { orchestratorInputSchema, type OrchestratorContext } from './types.js';
import { App } from '../../app.js';
import { Session } from '../../services/sessionService/session.js';

export class OrchestratorFlow extends Flow<App, OrchestratorContext> {
  description =
    "Orchestrator flow — understands the user's request, breaks it into tasks, and dispatches the right agents. Routes simple tasks directly to spawn_agent, uses run_agent when output is needed for subsequent steps, and asks the user only when ambiguity would cause the wrong outcome.";
  parameters = orchestratorInputSchema;

  schema: FlowSchema = {
    startNode: 'PrepareInput',
    nodes: {
      PrepareInput:  'DecideAction',
      DecideAction:  { tool_calls: 'ToolCalls', ask_user: 'AskUser', submit_result: 'SubmitResult' },
      ToolCalls:     'PrepareInput',
      AskUser:       { pause: 'UserResponse' },
      UserResponse:  'PrepareInput',
      SubmitResult:  null,
    },
  };

  nodeConstructors = { PrepareInput, DecideAction, ToolCalls, AskUser, UserResponse, SubmitResult };

  async createSession(app: App, user: unknown, parent: Session | undefined, _input: { message: string }): Promise<Session> {
    const session = await app.services.sessionService.create({
      parentSessionId: parent?.id,
      userId: (user as { id: string }).id,
      flowName: this.constructor.name,
    });
    session.addAgentTools(AGENT_TOOLS as any);
    await session.setFlowSchema(this.toSchema());
    return session;
  }

  override async restoreSession(_app: App, _user: unknown, session: Session): Promise<void> {
    session.addAgentTools(AGENT_TOOLS as any);
  }
}

export type OrchestratorFlowType = OrchestratorFlow;
