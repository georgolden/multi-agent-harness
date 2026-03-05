import { Flow, packet, error } from '../../utils/agent/flow.js';
import { App } from '../../app.js';
import { MessageWindowConfig } from '../../services/sessionService/types.js';
import { User } from '../../data/userRepository/types.js';
import { CallLlmOptions } from '../../utils/callLlm.js';
import { fillSystemPrompt, readFilesWithLimit, readFoldersInfos } from './utils.js';
import { PrepareInput, DecideAction, AskUser, UserResponse, ToolCalls, SubmitAnswer, BestAnswer } from './nodes.js';
import type { AgenticLoopContext } from './types.js';
import { Session } from '../../services/sessionService/session.js';
import { Type, type Static } from '@sinclair/typebox';

export interface AgenticLoopSchema {
  flowName: string;
  description: string;
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

export const agentFlowParametersSchema = Type.Object({
  schema: Type.Object(
    {
      flowName: Type.String({ description: 'Name of the agentic loop flow' }),
      userPromptTemplate: Type.Optional(Type.String({ description: 'Template for user prompt' })),
      systemPrompt: Type.String({ description: 'System prompt for the LLM' }),
      toolNames: Type.Array(Type.String(), { description: 'Array of tool names to use' }),
      skillNames: Type.Array(Type.String(), { description: 'Array of skill names to use' }),
      contextPaths: Type.Object(
        {
          files: Type.Array(Type.String(), { description: 'Context file paths' }),
          folders: Type.Array(Type.String(), { description: 'Context folder paths' }),
        },
        { description: 'Context paths for files and folders' },
      ),
      callLlmOptions: Type.Object({}, { description: 'LLM call options' }),
      messageWindowConfig: Type.Object({}, { description: 'Message window configuration' }),
      agentLoopConfig: Type.Object(
        {
          onError: Type.Union([Type.Literal('askUser'), Type.Literal('retry')], {
            description: 'Error handling strategy',
          }),
          maxLoopEntering: Type.Number({ description: 'Maximum loop iterations' }),
          loopExit: Type.Union([Type.Literal('failure'), Type.Literal('bestAnswer')], {
            description: 'Loop exit strategy',
          }),
          useMemory: Type.Boolean({ description: 'Enable memory' }),
          useKnowledgeBase: Type.Boolean({ description: 'Enable knowledge base' }),
        },
        { description: 'Agentic loop configuration' },
      ),
    },
    { description: 'Agentic loop schema configuration' },
  ),
  message: Type.String({ description: 'User message to send to the flow' }),
});

export type AgentFlowParameters = Static<typeof agentFlowParametersSchema>;

export const agenticLoopFlow = {
  name: 'Agentic Loop',
  description: 'Universal agentic flow that runs with schema',
  parameters: agentFlowParametersSchema,
  create: createAgenticLoopFlow,
  run: async (
    app: App,
    context: { user: User; parent?: Session },
    parameters: { schema: AgenticLoopSchema; message: string },
  ) => {
    const { user, parent } = context;
    const { schema, message } = parameters;
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
    return flow.run({ data: message, context: { session, user, tools, skills }, deps: app });
  },
};
