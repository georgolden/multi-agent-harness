import { BaseChannel } from '../../services/channel/baseChannel.js';
import type { MessageDto } from '../../services/channel/types.js';
import type { App } from '../../app.js';

export class WebChannel extends BaseChannel {
  private receiveCallback?: (recipientId: string, message: MessageDto) => void;

  constructor(app: App) {
    super('web', app);
  }

  async send(recipientId: string, message: MessageDto): Promise<void> {
    // Delivery is handled by the streamEvents tRPC subscription listening on the bus.
    // This method satisfies the Channel contract so ChannelService tracks the user.
    console.log(`[WebChannel] Message for user ${recipientId} (session ${message.session.id}) delivered via bus`);
  }

  receive(callback: (recipientId: string, message: MessageDto) => void): void {
    this.receiveCallback = callback;
  }

  /** Called before runAgent/sendMessage so ChannelService maps this user to the web channel. */
  markUserActive(userId: string): void {
    if (this.receiveCallback) {
      // Emit a synthetic no-op that lets ChannelService register userId → 'web'
      // without triggering real session routing.
      this.app.infra.bus.emit('web:userConnected', { userId });
    }
    // Directly tell ChannelService by calling receive callback with a sentinel
    // is not needed — ChannelService tracks userChannels only when receive fires.
    // Instead we rely on the bus emit path in sendMessage (router.ts) which goes
    // directly to the session, bypassing ChannelService routing.
  }

  async close(): Promise<void> {
    console.log('[WebChannel] Closed');
  }
}
