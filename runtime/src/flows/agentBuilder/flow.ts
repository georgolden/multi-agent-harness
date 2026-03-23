/**
 * agentBuilder flow.
 *
 * Flow graph:
 *   PrepareInput → DecideAction ─┬─ write_temp_file → WriteTempFile ─┐
 *                                │                                    └→ DecideAction (loop)
 *                                ├─ ask_user        → AskUser (pause)
 *                                │                        └→ UserResponse → DecideAction
 *                                └─ submit_answer   → SubmitAnswer (exit)
 */
import { Flow, packet } from '../../utils/agent/flow.js';
import { PrepareInput, DecideAction, WriteTempFile, AskUser, UserResponse, SubmitAnswer } from './nodes.js';
import { agentBuilderInputSchema, type AgentBuilderContext } from './types.js';
import { App } from '../../app.js';
import { Session } from '../../services/sessionService/session.js';
import { UserMessage } from '../../utils/message.js';
import { createSystemPrompt } from './prompts/index.js';
import { FlowRunner } from '../../utils/agent/flowRunner.js';
import type { FlowContext } from '../index.js';
import { type Static } from '@sinclair/typebox';

export type AgentBuilderFlow = Flow<App, AgentBuilderContext>;

export function createAgentBuilderFlow(): AgentBuilderFlow {
  const prepareInput = new PrepareInput();
  const decideAction = new DecideAction();
  const writeTempFile = new WriteTempFile();
  const askUser = new AskUser();
  const userResponse = new UserResponse();
  const submitAnswer = new SubmitAnswer();

  prepareInput.next(decideAction);

  decideAction.branch('write_temp_file', writeTempFile);
  writeTempFile.next(decideAction);

  decideAction.branch('ask_user', askUser);
  askUser.branch('pause', userResponse);
  userResponse.next(decideAction);

  decideAction.branch('submit_answer', submitAnswer);

  return new Flow(prepareInput);
}

export type AgentBuilderParams = Static<typeof agentBuilderInputSchema>;

export class AgentBuilderRunner extends FlowRunner<AgentBuilderContext, AgentBuilderParams> {
  readonly flowName = 'agentBuilder';
  readonly description =
    'Agent Builder flow — guides the user through designing a complete AI agent by collaboratively filling the Agent Flow Schema, system prompt, and optional user prompt template. Produces a ready-to-use AgenticLoopSchema.';
  readonly parameters = agentBuilderInputSchema;

  async createSession(app: App, flowContext: FlowContext, params: AgentBuilderParams): Promise<Session> {
    const systemPrompt = createSystemPrompt();
    const session = await app.services.sessionService.create({
      parentSessionId: flowContext.parent?.id,
      userId: flowContext.user.id,
      flowName: 'agentBuilder',
      systemPrompt,
    });
    await session.addUserMessage(new UserMessage(params.message));
    return session;
  }

  async createContext(
    _app: App,
    flowContext: FlowContext,
    session: Session,
    _params: AgentBuilderParams,
  ): Promise<AgentBuilderContext> {
    return { user: flowContext.user, parent: flowContext.parent, session };
  }

  createFlow(): AgentBuilderFlow {
    return createAgentBuilderFlow();
  }

  protected sessionCarryingNodes(): string[] {
    return ['PrepareInput', 'DecideAction', 'WriteTempFile'];
  }

  protected _buildStartPacket(params: AgentBuilderParams, context: AgentBuilderContext, app: App) {
    return packet({ data: params, context, deps: app });
  }
}
