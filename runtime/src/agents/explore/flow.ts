import { Flow, type FlowSchema } from '../../utils/agent/flow.js';
import { PrepareInput, DecideAction, AskUser, UserResponse, ToolCalls, SubmitResult } from './nodes.js';
import { exploreInputSchema } from './types.js';
import type { ExploreContext, ExploreInput, ExploreResult } from './types.js';
import { App } from '../../app.js';
import { Session } from '../../services/sessionService/session.js';
import { AGENT_TOOLS } from './tools.js';

export class ExploreFlow extends Flow<App, ExploreContext, ExploreInput, { exit: ExploreResult; loop: void }> {
  description =
    'Explore agent flow that allows users to explore and understand a codebase or problem domain. It helps to:\n• Map out project structure\n• Understand key files and their relationships\n• Identify modification targets and dependencies\n• Gather context for downstream agents';
  parameters = exploreInputSchema;

  schema: FlowSchema = {
    startNode: 'PrepareInput',
    nodes: {
      PrepareInput:  'DecideAction',
      DecideAction:  { ask_user: 'AskUser', tool_calls: 'ToolCalls', submit_result: 'SubmitResult' },
      AskUser:       { pause: 'UserResponse' },
      UserResponse:  'PrepareInput',
      ToolCalls:     'PrepareInput',
      SubmitResult:  null,
    },
  };

  nodeConstructors = { PrepareInput, DecideAction, AskUser, UserResponse, ToolCalls, SubmitResult };

  async createSession(app: App, user: unknown, parent: Session | undefined, _input: ExploreInput): Promise<Session> {
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

export type ExploreFlowType = ExploreFlow;
