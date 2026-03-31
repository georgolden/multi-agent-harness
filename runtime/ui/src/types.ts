export type SessionStatus = 'created' | 'running' | 'completed' | 'failed' | 'paused';
export type AgentStatus = 'running' | 'completed' | 'failed' | 'paused';

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

export interface AgentSession {
  id: string;
  userId: string;
  agentName: string;
  status: AgentStatus;
  startedAt: string | Date;
  endedAt?: string | Date;
  flowSessions: AgentFlowSession[];
}

export interface TempFile {
  name: string;
  content: string;
}

export interface ToolCallInfo {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool_call' | 'tool_result' | 'result';
  content: string;
  resultData?: Record<string, unknown>;
  tempFiles?: TempFile[];
  toolCalls?: ToolCallInfo[];   // for role=tool_call messages
  toolCallId?: string;          // for role=tool_result, links back to tool_call
  timestamp: Date;
}

export interface ParsedFlowDescription {
  summary?: string;
  tags?: string[];
  [key: string]: unknown;
}
