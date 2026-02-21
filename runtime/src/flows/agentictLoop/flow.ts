import { Flow } from 'pocketflow';
import { App } from '../../app.js';
import { MessageWindowConfig } from '../../data/flowSessionRepository/types.js';
import { User } from '../../data/userRepository/types.js';
import { CallLlmOptions } from '../../utils/callLlm.js';
import { fillSystemPrompt, readFilesWithLimit, readFoldersInfos } from './utils.js';
import { PrepareInput, DecideAction, AskUser, ToolCalls } from './nodes.js';

export interface AgenticLoopSchema {
  flowName: string;
  userPromptTemplate: string;
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
  maxIterations: number;
  maxIterationsExit: 'failureAdmit' | 'bestAnswer';

  useMemory: boolean;
  useKnowledgeBase: boolean;
};

export async function createAgetnicLoopFlow() {
  const prepareInput = new PrepareInput();
  const decideAction = new DecideAction();
  const askUser = new AskUser();
  const toolCalls = new ToolCalls();

  // PrepareInput runs once, then goes to DecideAction
  prepareInput.next(decideAction);

  // DecideAction routes to different actions
  decideAction.on('ask_user', askUser);
  decideAction.on('tool_calls', toolCalls);

  // AskUser ends the flow (response is the question)

  // ToolCalls loops back to DecideAction
  toolCalls.next(decideAction);

  // Create flow starting with PrepareInput
  return new Flow(prepareInput);
}

export async function prepareAgenticLoop(flow: Flow, app: App, schema: AgenticLoopSchema, user: User) {
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

  return (message: string) => flow.run({ app, context: { session, user, message, tools, skills } });
}
