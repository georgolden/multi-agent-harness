/**
 * Channel Service - Direct bridge between sessions and channels
 *
 * Responsibilities:
 * - Register and manage channel instances (Telegram, Web, Slack, etc.)
 * - Track which channel each user is currently on
 * - Listen to session:message events via bus (decoupling)
 * - Route messages from sessions to correct channel based on user tracking
 * - Receive messages from channels
 * - Route channel messages back to sessions via bus
 *
 * Session knows NOTHING about channels. ChannelService tracks user→channel mapping
 * and routes messages transparently. This keeps session clean and channels isolated.
 */

import type { App } from '../../app.js';
import type { Channel, MessageDto } from './types.js';

export class ChannelService {
  private channels: Map<string, Channel> = new Map();
  /** Track which channel each user is on: userId → channelId */
  private userChannels: Map<string, string> = new Map();
  private app: App;

  constructor(app: App) {
    this.app = app;
    this.setupSessionBusListeners();
  }

  /**
   * Register a new channel instance
   * Channel must implement Channel interface
   */
  registerChannel(channel: Channel): void {
    this.channels.set(channel.id, channel);
    console.log(`[ChannelService] Registered channel: ${channel.id}`);

    // Setup receive callback for this channel
    channel.receive((recipientId: string, message: MessageDto) => {
      // Track which channel this user is on
      this.userChannels.set(recipientId, channel.id);
      this.handleChannelMessage(recipientId, message);
    });
  }

  /**
   * Get channel by id
   */
  getChannel(id: string): Channel | undefined {
    return this.channels.get(id);
  }

  /**
   * Get all channels
   */
  getChannels(): Channel[] {
    return Array.from(this.channels.values());
  }

  /**
   * Unregister a channel
   */
  async unregisterChannel(id: string): Promise<void> {
    const channel = this.channels.get(id);

    if (!channel) {
      console.warn(`[ChannelService] Channel not found: ${id}`);
      return;
    }

    await channel.close();
    this.channels.delete(id);
    console.log(`[ChannelService] Unregistered channel: ${id}`);
  }

  /**
   * Handle message from external channel
   * Pass through everything as-is, channel provides complete context
   */
  private handleChannelMessage(userId: string, message: MessageDto): void {
    console.log(`[ChannelService] Received message from user ${userId}: ${message.message}`);

    // Emit to the specific session - pass through all three objects: session, message, user
    this.app.infra.bus.emit(`user:message:${userId}:${message.session.id}`, {
      session: message.session,
      message: message.message,
      user: message.user
    });
  }

  /**
   * Setup bus listeners for session messages
   * Sessions emit: session:message
   * We intercept and route to correct channel
   */
  private setupSessionBusListeners(): void {
    // Listen for all session:message events
    this.app.infra.bus.on('session:message', async (data: any) => {
      const { session, message, user } = data;

      if (!session || !message || !user) {
        console.warn('[ChannelService] Invalid session:message event', { session, message, user });
        return;
      }

      await this.routeSessionMessage(session, message, user);
    });
  }

  /**
   * Route session message to appropriate channel
   * Sends complete MessageDto with session, user, and message
   */
  private async routeSessionMessage(session: any, message: string, user: any): Promise<void> {
    const userId = session.userId;

    const channelId = this.userChannels.get(userId);

    if (!channelId) {
      console.warn(`[ChannelService] No channel registered for user ${userId}`);
      return;
    }

    const channel = this.getChannel(channelId);

    if (!channel) {
      console.warn(`[ChannelService] Channel not found: ${channelId}`);
      return;
    }

    try {
      // Send complete MessageDto with session, user, and message
      await channel.send(userId, {
        message,
        session,
        user,
      });
      console.log(`[ChannelService] Sent message to ${channelId} user ${userId}`);
    } catch (error) {
      console.error(`[ChannelService] Failed to send message:`, error);
    }
  }

  async start(): Promise<void> {
    console.log('[ChannelService] Starting...');
  }

  async stop(): Promise<void> {
    console.log('[ChannelService] Stopping...');
    for (const channel of this.channels.values()) {
      await channel.close();
    }
  }
}
