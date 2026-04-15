/**
 * Channel types and interfaces for multi-channel user interactions
 */

import type { SessionData } from '../sessionService/types.js';
import type { RuntimeUser } from '../userService/index.js';

export interface MessageDto {
  message: string;
  session: SessionData;
  user: RuntimeUser;
  [key: string]: unknown;
}

/**
 * Base interface for all channels
 * A channel is responsible for sending/receiving messages from external systems
 * (Telegram, WebSocket, Slack, etc.)
 */
export interface Channel {
  /** Unique channel identifier (e.g., "telegram", "web", "slack") */
  id: string;

  /** Send message to user via this channel */
  send(recipientId: string, message: MessageDto): Promise<void>;

  /** Register callback to receive user messages from this channel */
  receive(callback: (recipientId: string, message: MessageDto) => void): void;

  /** Cleanup resources */
  close(): Promise<void>;
}

/**
 * Channel event emitted when user sends a message through a channel
 */
export interface ChannelMessageEvent {
  userId: string;
  channelId: string;
  message: MessageDto;
}

/**
 * Channel event emitted when session needs to send message to user
 */
export interface SessionMessageEvent {
  userId: string;
  channelId: string;
  sessionId: string;
  message: string;
  metadata?: Record<string, unknown>;
}
