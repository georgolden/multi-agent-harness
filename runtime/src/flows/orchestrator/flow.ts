/**
 * Orchestrator flow.
 *
 * Flow graph:
 *   PrepareInput → DecideAction ─┬─ tool_calls    → ToolCalls ─┐
 *                                │                               └→ DecideAction (loop)
 *                                ├─ loop          ──────────────→ DecideAction (loop)
 *                                ├─ ask_user      → AskUser (pause)
 *                                │                      └→ UserResponse → DecideAction
 *                                └─ submit_result → SubmitResult (exit)
 */
import { Flow, packet } from '../../utils/agent/flow.js';
import {
  PrepareInput,
  DecideAction,
  ToolCalls,
  AskUser,
  UserResponse,
  SubmitResult,
} from './nodes.js';
import { AGENT_TOOLS } from './tools.js';
import { orchestratorInputSchema, type OrchestratorContext } from './types.js';
import { App } from '../../app.js';
import { Session } from '../../services/sessionService/session.js';
import { UserMessage } from '../../utils/message.js';
import { createSystemPrompt } from './prompts/index.js';
import { FlowRunner } from '../../utils/agent/flowRunner.js';
import type { FlowContext } from '../index.js';
import { type Static } from '@sinclair/typebox';

export type OrchestratorFlow = Flow<App, OrchestratorContext>;

type OrchestratorParams = Static<typeof orchestratorInputSchema>;

export function createOrchestratorFlow(): OrchestratorFlow {
  const prepareInput = new PrepareInput();
  const decideAction = new DecideAction();
  const toolCalls = new ToolCalls();
  const askUser = new AskUser();
  const userResponse = new UserResponse();
  const submitResult = new SubmitResult();

  prepareInput.next(decideAction);

  decideAction.branch('tool_calls', toolCalls);
  toolCalls.next(decideAction);

  decideAction.branch('loop', decideAction);

  decideAction.branch('ask_user', askUser);
  askUser.branch('pause', userResponse);
  userResponse.next(decideAction);

  decideAction.branch('submit_result', submitResult);

  return new Flow(prepareInput);
}

export class OrchestratorRunner extends FlowRunner<OrchestratorContext, OrchestratorParams> {
  readonly flowName = 'orchestrator';
  readonly description =
    'Orchestrator flow — understands the user\'s request, breaks it into tasks, and dispatches the right agents. Routes simple tasks directly to spawn_agent, uses run_agent when output is needed for subsequent steps, and asks the user only when ambiguity would cause the wrong outcome.';
  readonly parameters = orchestratorInputSchema;

  async createSession(app: App, flowContext: FlowContext, params: OrchestratorParams): Promise<Session> {
    const timezone = await app.data.taskRepository.getUserTimezone(flowContext.user.id);
    const currentDate = new Date().toISOString();
    const flows = app.flows.getFlowsAsXml();
    const systemPrompt = createSystemPrompt(currentDate, timezone, flowContext.user.name ?? flowContext.user.id, flows);

    const session = await app.services.sessionService.create({
      parentSessionId: flowContext.parent?.id,
      userId: flowContext.user.id,
      flowName: 'orchestrator',
      systemPrompt,
    });

    session.addAgentTools(AGENT_TOOLS as any);
    await session.addUserMessage(new UserMessage(params.message));

    return session;
  }

  async createContext(
    _app: App,
    flowContext: FlowContext,
    session: Session,
    _params: OrchestratorParams,
  ): Promise<OrchestratorContext> {
    // On restore, re-register agent tools
    if (session.tools.length === 0) {
      session.addAgentTools(AGENT_TOOLS as any);
    }
    return { user: flowContext.user, parent: flowContext.parent, session };
  }

  createFlow(): OrchestratorFlow {
    return createOrchestratorFlow();
  }

  protected sessionCarryingNodes(): string[] {
    return ['PrepareInput', 'DecideAction'];
  }

  protected _buildStartPacket(params: OrchestratorParams, context: OrchestratorContext, app: App) {
    return packet({ data: { message: params.message }, context, deps: app });
  }
}
