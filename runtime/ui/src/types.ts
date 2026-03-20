export type SessionStatus = 'created' | 'running' | 'completed' | 'failed' | 'paused';

export interface AgentFlow {
  name: string;
  description: string;
}

export interface AgentFlowSession {
  id: string;
  userId: string;
  flowName: string;
  status: SessionStatus;
  parentSessionId?: string;
  startedAt: string | Date;
  endedAt?: string | Date;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface ParsedFlowDescription {
  summary?: string;
  tags?: string[];
  [key: string]: unknown;
}
