export type AgentStatus = 'running' | 'completed' | 'failed' | 'paused';

export type AgentStepItem = {
  input: unknown;
  sessionId: string | null;
  status: 'running' | 'done' | 'failed';
  result?: unknown;
};

export type AgentStep = {
  mode: 'single' | 'parallel';
  flow: string;
  collect: string | null;
  items: AgentStepItem[];
};

export type AgentSessionData = {
  id: string;
  userId: string;
  agentName: string;
  agentSchema: unknown;
  status: AgentStatus;
  currentStep?: AgentStep;
  startedAt: Date;
  endedAt?: Date;
};

export type CreateAgentSessionParams = {
  id?: string;
  userId: string;
  agentName: string;
  agentSchema: unknown;
};
