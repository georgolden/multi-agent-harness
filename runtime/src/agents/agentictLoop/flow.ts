import { Flow, type FlowSchema, error } from '../../utils/agent/flow.js';
import { App } from '../../app.js';
import type { MessageWindowConfig } from '../../services/sessionService/types.js';
import { RuntimeUser } from '../../services/userService/index.js';
import type { CallLlmOptions } from '../../utils/callLlm.js';
import { PrepareInput, DecideAction, AskUser, UserResponse, ToolCalls, SubmitAnswer, BestAnswer } from './nodes.js';
import type { AgenticLoopContext } from './types.js';
import { Session } from '../../services/sessionService/session.js';
import { Type, type Static } from '@sinclair/typebox';
import type { AgentTool } from '../../types.js';
import { SUBMIT_RESULT_SCHEMA } from './tools.js';

export interface ToolkitConfig {
  slug: string;
  allowedTools: string[];  // empty means all tools are allowed
}

export interface AgenticLoopSchema {
  name: string;
  description: string;
  userPromptTemplate?: string;
  systemPrompt: string;
  toolNames: string[];          // built-in tool names, e.g. ['bash', 'read']
  skillNames: string[];
  toolkits: ToolkitConfig[];    // toolkit configs with per-toolkit tool restrictions
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
  name: Type.String({ description: 'Name of the agentic loop schema to run' }),
  message: Type.String({ description: 'User message to send to the flow' }),
});

export type AgentFlowParameters = Static<typeof agentFlowParametersSchema>;

// ─── AgenticLoopFlow ──────────────────────────────────────────────────────────

/**
 * Flow subclass that handles loop-exceeded errors via fallback.
 * If loopExit is 'bestAnswer', delegates to BestAnswer node for a final LLM call.
 * Otherwise fails the session.
 */
export class AgenticLoopFlow extends Flow<App, AgenticLoopContext, AgentFlowParameters> {
  override get name(): string {
    return 'AgenticLoopFlow';
  }
  description = 'Universal agentic flow that runs with schema';
  parameters = agentFlowParametersSchema;

  schema: FlowSchema = {
    startNode: 'PrepareInput',
    nodes: {
      PrepareInput: 'DecideAction',
      DecideAction: { ask_user: 'AskUser', tool_calls: 'ToolCalls', submit_result: 'SubmitAnswer' },
      AskUser: { pause: 'UserResponse' },
      UserResponse: 'PrepareInput',
      ToolCalls: { default: 'PrepareInput', ask_user: 'AskUser' },
      SubmitAnswer: null,
    },
  };

  nodeConstructors = { PrepareInput, DecideAction, AskUser, UserResponse, ToolCalls, SubmitAnswer };

  private bestAnswerNode = new BestAnswer();

  async createSession(
    app: App,
    user: RuntimeUser,
    _parent: Session | undefined,
    input: AgentFlowParameters,
  ): Promise<Session> {
    const schema = await app.data.agenticLoopSchemaRepository.getSchema(input.name);
    if (!schema) throw new Error(`AgenticLoopFlow: schema '${input.name}' not found`);

    const session = await app.services.sessionService.create({
      flowName: input.name,
      userId: user.id,
    });

    await session.setFlowSchema(this.toSchema());
    return session;
  }

  override async restoreSession(app: App, user: RuntimeUser, session: Session): Promise<void> {
    const allSchemaNames = session.toolSchemas.map((t) => t.name).filter((n) => n !== SUBMIT_RESULT_SCHEMA.name);

    const builtInTools = app.tools.getSlice(allSchemaNames);
    const builtInNames = new Set(builtInTools.map((t) => t.name));
    const providerToolNames = allSchemaNames.filter((n) => !builtInNames.has(n));

    let userTools: (AgentTool & { toolkitSlug: string })[] = [];
    if (providerToolNames.length > 0) {
      const runtimeUser = await app.services.userService.loadUser(user.id);
      const allUserTools = await runtimeUser.buildAgentTools();
      userTools = allUserTools.filter((t) => providerToolNames.includes(t.name));
    }

    session.tools = [...builtInTools, ...userTools];
  }

  async fallback(p: this['InError'], err: Error): Promise<this['Out']> {
    const { session } = p.context;
    const loopExit = session.agentLoopConfig?.loopExit ?? 'failure';
    console.warn(
      `[AgenticLoopFlow.fallback] err type=${typeof err} constructor=${(err as any)?.constructor?.name} value=${JSON.stringify(err)} loopExit=${loopExit}`,
    );
    const isLoopExceeded = err.message.includes('maxLoopEntering') || err.message.includes('exceeded');

    console.warn(`[AgenticLoopFlow.fallback] err.message='${err.message}' isLoopExceeded=${isLoopExceeded}`);

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
