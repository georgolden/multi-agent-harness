import { Flow, packet, error } from '../../utils/agent/flow.js';
import { App } from '../../app.js';
import { MessageWindowConfig } from '../../services/sessionService/types.js';
import { User } from '../../data/userRepository/types.js';
import { CallLlmOptions } from '../../utils/callLlm.js';
import { fillSystemPrompt, readFilesWithLimit, readFoldersInfos } from './utils.js';
import { PrepareInput, DecideAction, AskUser, UserResponse, ToolCalls, SubmitAnswer, BestAnswer } from './nodes.js';
import type { AgenticLoopContext } from './types.js';

export interface AgenticLoopSchema {
  flowName: string;
  userPromptTemplate?: string;
  systemPrompt: string;
  toolNames: string[];
  skillNames: string[];
  contextPaths: {
    files: string[];
    folders: string[];
  };
  callLlmOptions: CallLlmOptions;
  messageWindowConfig: MessageWindowConfig;
  agentLoopConfig: AgentLoopConfig;
}

export type AgentLoopConfig = {
  onError: 'askUser' | 'retry';
  maxLoopEntering: number;
  loopExit: 'failure' | 'bestAnswer';

  useMemory: boolean;
  useKnowledgeBase: boolean;
};

// ─── AgenticLoopFlow ──────────────────────────────────────────────────────

/**
 * Flow subclass that handles loop-exceeded errors (maxLoopEntering) via fallback.
 * If loopExit is 'bestAnswer', delegates to BestAnswer node to make final LLM call.
 * Otherwise fails the session.
 */
class AgenticLoopFlow extends Flow<App, AgenticLoopContext, string> {
  private bestAnswerNode = new BestAnswer();

  async fallback(p: this['InError'], err: Error): Promise<this['Out']> {
    const { session } = p.context;
    const loopExit = session.agentLoopConfig?.loopExit ?? 'failure';
    const isLoopExceeded = err.message.includes('maxLoopEntering') || err.message.includes('exceeded');

    console.warn(`[AgenticLoopFlow.fallback] ${err.message}, loopExit: ${loopExit}`);

    if (isLoopExceeded && loopExit === 'bestAnswer') {
      try {
        // Delegate to BestAnswer node
        return await this.bestAnswerNode.run({ data: err, context: p.context, deps: p.deps });
      } catch (bestAnswerErr) {
        console.error('[AgenticLoopFlow.fallback] bestAnswer call failed:', bestAnswerErr);
        // Fall through to failure
      }
    }

    // failure or non-loop error or bestAnswer fallback
    await session.fail().catch(() => {});
    return error({ data: err, context: p.context, deps: p.deps });
  }
}

export function createAgenticLoopFlow({ maxLoopEntering }: { maxLoopEntering?: number } = {}) {
  const prepareInput = new PrepareInput();
  const decideAction = new DecideAction({ maxLoopEntering });
  const askUser = new AskUser();
  const userResponse = new UserResponse();
  const toolCalls = new ToolCalls();
  const submitAnswer = new SubmitAnswer();

  // PrepareInput runs once, then goes to DecideAction
  prepareInput.next(decideAction);

  // DecideAction routes to different actions
  decideAction.branch('ask_user', askUser);
  decideAction.branch('tool_calls', toolCalls);
  decideAction.branch('submit_answer', submitAnswer);
  decideAction.branch('loop', decideAction);

  // AskUser pauses and resumes with UserResponse
  askUser.branch('pause', userResponse);
  userResponse.next(decideAction);

  // ToolCalls loops back to DecideAction
  toolCalls.next(decideAction);
  // ToolCalls can also route to AskUser on error
  toolCalls.branch('ask_user', askUser);

  // Create flow starting with PrepareInput
  const flow = new AgenticLoopFlow(prepareInput);
  return flow;
}

export async function prepareAgenticLoop(app: App, schema: AgenticLoopSchema, user: User) {
  const {
    flowName,
    systemPrompt,
    toolNames,
    skillNames,
    contextPaths,
    callLlmOptions,
    messageWindowConfig,
    userPromptTemplate,
    agentLoopConfig,
  } = schema;

  const filledSystemPrompt = fillSystemPrompt(systemPrompt, user);

  const tools = app.tools.getSlice(toolNames);
  const skills = app.skills.getSlice(skillNames);

  const contextFiles = await readFilesWithLimit(contextPaths.files);
  const contextFoldersInfos = await readFoldersInfos(contextPaths.folders);

  const session = await app.services.sessionService.create({
    flowName,
    systemPrompt: filledSystemPrompt,
    userPromptTemplate: userPromptTemplate,
    userId: user.id,
    messageWindowConfig,
    tools,
    skills,
    contextFiles,
    contextFoldersInfos,
    callLlmOptions,
    agentLoopConfig,
  });

  const flow = createAgenticLoopFlow(agentLoopConfig);

  return {
    flow,
    session,
    run: (message: string) =>
      flow.run(
        packet({
          data: message,
          context: { session, user, tools, skills },
          deps: app,
        }),
      ),
  };
}
