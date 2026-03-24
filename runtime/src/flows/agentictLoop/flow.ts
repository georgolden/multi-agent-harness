import { Flow, type FlowSchema, error } from '../../utils/agent/flow.js';
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

// ─── AgenticLoopFlow ──────────────────────────────────────────────────────────

/**
 * Flow subclass that handles loop-exceeded errors via fallback.
 * If loopExit is 'bestAnswer', delegates to BestAnswer node for a final LLM call.
 * Otherwise fails the session.
 */
export class AgenticLoopFlow extends Flow<App, AgenticLoopContext, AgentFlowParameters>
  {

  name = 'Agentic Loop';
  description = 'Universal agentic flow that runs with schema';
  parameters = agentFlowParametersSchema;

  schema: FlowSchema = {
    startNode: 'PrepareInput',
    nodes: {
      PrepareInput:  'DecideAction',
      DecideAction:  { ask_user: 'AskUser', tool_calls: 'ToolCalls', submit_answer: 'SubmitAnswer', loop: 'DecideAction' },
      AskUser:       { pause: 'UserResponse' },
      UserResponse:  'DecideAction',
      ToolCalls:     { default: 'DecideAction', ask_user: 'AskUser' },
      SubmitAnswer:  null,
    },
  };

  nodeConstructors = { PrepareInput, DecideAction, AskUser, UserResponse, ToolCalls, SubmitAnswer };

  private bestAnswerNode = new BestAnswer();

  async createSession(app: App, user: User, _parent: Session | undefined, input: AgentFlowParameters): Promise<Session> {
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
    } = input.schema;

    const filledSystemPrompt = fillSystemPrompt(systemPrompt, user);

    const tools = app.tools.getSlice(toolNames);
    const skills = app.skills.getSlice(skillNames);

    const contextFiles = await readFilesWithLimit(contextPaths.files);
    const contextFoldersInfos = await readFoldersInfos(contextPaths.folders);

    const session = await app.services.sessionService.create({
      flowName,
      systemPrompt: filledSystemPrompt,
      userPromptTemplate,
      userId: user.id,
      messageWindowConfig: messageWindowConfig as MessageWindowConfig,
      tools,
      skills,
      contextFiles,
      contextFoldersInfos,
      callLlmOptions,
      agentLoopConfig,
    });

    await session.setFlowSchema(this.toSchema());

    return session;
  }

  async fallback(p: this['InError'], err: Error): Promise<this['Out']> {
    const { session } = p.context;
    const loopExit = session.agentLoopConfig?.loopExit ?? 'failure';
    const isLoopExceeded = err.message.includes('maxLoopEntering') || err.message.includes('exceeded');

    console.warn(`[AgenticLoopFlow.fallback] ${err.message}, loopExit: ${loopExit}`);

    if (isLoopExceeded && loopExit === 'bestAnswer') {
      try {
        return await this.bestAnswerNode.run({ data: err, context: p.context, deps: p.deps });
      } catch (bestAnswerErr) {
        console.error('[AgenticLoopFlow.fallback] bestAnswer call failed:', bestAnswerErr);
      }
    }

    await session.fail().catch(() => {});
    return error({ data: err, context: p.context, deps: p.deps });
  }
}
