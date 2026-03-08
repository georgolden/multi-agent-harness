/**
 * Base class for channel implementations
 * Provides common functionality for all channels
 */

import type { Channel, MessageDto } from './types.js';
import type { App } from '../../app.js';

export abstract class BaseChannel implements Channel {
  id: string;
  protected app: App;

  constructor(id: string, app: App) {
    this.id = id;
    this.app = app;
  }

  /**
   * Send message to recipient via channel
   * Message includes session, user, and message content
   * Channel implementations MUST preserve these and return them when calling receive callback
   */
  abstract send(recipientId: string, message: MessageDto): Promise<void>;

  /**
   * Register callback to receive messages from this channel
   * When user sends a message, call the callback with MessageDto that includes
   * the original session, user, and message content
   * Example: callback(userId, { message: userMessage, session, user })
   */
  abstract receive(callback: (recipientId: string, message: MessageDto) => void): void;

  /**
   * Cleanup channel resources
   */
  abstract close(): Promise<void>;
}
