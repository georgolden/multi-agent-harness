export type AgentStatus = 'running' | 'completed' | 'failed' | 'paused';

export type AgentSessionData = {
  id: string;
  userId: string;
  agentName: string;
  agentSchema: unknown;
  status: AgentStatus;
  currentFlowName?: string;
  currentFlowInput?: unknown;
  startedAt: Date;
  endedAt?: Date;
};

export type CreateAgentSessionParams = {
  id?: string;
  userId: string;
  agentName: string;
  agentSchema: unknown;
};
