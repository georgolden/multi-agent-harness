import type { Session } from './session.js';
import type { AgentLoopConfig } from '../../agents/agentictLoop/flow.js';
import type { CallLlmOptions } from '../../utils/callLlm.js';
import type { FileInfo } from '../../utils/file.js';
import type { FolderInfo } from '../../utils/folder.js';
import type { LLMMessageData } from '../../utils/message.js';
import type { ToolLog, ToolSchema } from '../../tools/index.js';
import type { SkillLog, SkillSchema } from '../../skills/index.js';
import type { Skill } from '../../skills/index.js';
import type { SkillExecutionSession } from '../sandbox/index.js';

export interface EnabledSkillRecord {
  name: string;
}

export interface EnabledSkill {
  skill: Skill;
  sandboxSession: SkillExecutionSession | null;
}

export type { ToolLog, ToolSchema };

export type { SkillLog, SkillSchema };

export type { FileInfo, FolderInfo };

// Message without id - index is the id
export interface SessionMessage {
  message: LLMMessageData;
  timestamp: Date;
}

// Message window configuration
export interface MessageWindowConfig {
  // Number of first messages to always keep (system + initial user task)
  keepFirstMessages: number;
  // Size of the sliding window for recent messages
  slidingWindowSize: number;
}

// Default message window configuration
export const DEFAULT_MESSAGE_WINDOW_CONFIG: MessageWindowConfig = {
  keepFirstMessages: 2,
  slidingWindowSize: 20,
};

// Session state - simplified
export type SessionStatus = 'created' | 'running' | 'completed' | 'failed' | 'paused';

// Create session parameters
export interface CreateSessionParams {
  sessionId?: string;
  userId: string;
  flowName: string;
  systemPrompt?: string;
  userPromptTemplate?: string;
  parentSessionId?: string;
  messageWindowConfig?: MessageWindowConfig;
  tools?: ToolSchema[];
  skills?: SkillSchema[];
  contextFiles?: FileInfo[];
  contextFoldersInfos?: FolderInfo[];
  callLlmOptions?: CallLlmOptions;
  agentLoopConfig?: AgentLoopConfig;
  agentSessionId?: string;
  enabledSkills?: EnabledSkillRecord[];
}

// Lightweight session info for tree traversal
export interface SessionTreeNode {
  id: string;
  userId: string;
  flowName: string;
  status: SessionStatus;
  parentSessionId?: string;
  createdAt: Date;
  childCount: number;
}

// Main flow session type
export interface SessionData {
  id: string;
  userId: string;
  flowName: string;
  systemPrompt: string;
  userPromptTemplate?: string;
  status: SessionStatus;

  // Tree structure
  parentSessionId?: string;

  // Message history (all messages) - uses OpenAI message format
  messages: SessionMessage[];

  // Active message window (computed based on config)
  activeMessages: SessionMessage[];

  // Message window configuration
  messageWindowConfig: MessageWindowConfig;

  // Context and tools
  contextFiles: FileInfo[];
  contextFoldersInfos: FolderInfo[];
  toolSchemas: ToolSchema[];
  skillSchemas: SkillSchema[];

  // temporary files
  tempFiles: Array<{
    name: string;
    content: string | Buffer;
  }>;

  callLlmOptions?: CallLlmOptions;
  agentLoopConfig?: AgentLoopConfig;

  // Execution logs
  toolLogs: ToolLog[];
  skillLogs: SkillLog[];

  // Timestamps - simple
  startedAt: Date;
  endedAt?: Date;

  // Flow schema — stored so the flow can be reconstructed from DB on restore
  flowSchema?: unknown;

  // Flow checkpoint — set transactionally after each node completes
  currentNodeName?: string;
  currentPacketData?: unknown;

  // Agent session this flow belongs to
  agentSessionId?: string;

  // Persisted enabled skills (DB-backed)
  enabledSkills: EnabledSkillRecord[];
}

export interface SessionDataTreeNode {
  id: string;
  userId: string;
  flowName: string;
  status: SessionStatus;
  parentSessionId?: string;
  createdAt: Date;
  childCount: number;
}

/**
 * Lifecycle hooks for a Session.
 *
 * onMessage       — fired after messages are added to the session
 * onStatusChange  — fired on every status transition (general hook)
 * onCompleted     — fired when status transitions to 'completed'
 * onFailed        — fired when status transitions to 'failed'
 * onPaused        — fired when status transitions to 'paused'
 *
 * All hooks receive the Session instance so they can read current state
 * or call further methods.  onStatusChange also receives previous status.
 *
 * Hooks are called AFTER the repository has been updated.
 */
export interface SessionHooks {
  onMessage?: (session: Session) => void | Promise<void>;
  onStatusChange?: (session: Session, from: SessionStatus, to: SessionStatus) => void | Promise<void>;
  onCompleted?: (session: Session) => void | Promise<void>;
  onFailed?: (session: Session) => void | Promise<void>;
  onPaused?: (session: Session) => void | Promise<void>;
}
