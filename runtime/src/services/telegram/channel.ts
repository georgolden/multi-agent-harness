/**
 * Telegram Channel - Implements Channel interface for Telegram bot
 *
 * Features:
 * - Hardcoded test authentication (password: "test", user: "test")
 * - Session routing via message replies - replies to session messages map back to that session
 * - Messages without reply are ignored (waits for session context)
 */

import { Telegraf, Context } from 'telegraf';
import { message } from 'telegraf/filters';
import { Update } from 'telegraf/types';
import type { App } from '../../app.js';
import { BaseChannel } from '../channel/baseChannel.js';
import type { MessageDto, Channel } from '../channel/types.js';
import type { SessionData } from '../sessionService/types.js';
interface AuthState {
  authenticated: boolean;
  userId?: string;
}

export class TelegramChannel extends BaseChannel implements Channel {
  private bot: Telegraf;
  private authStates: Map<number, AuthState> = new Map();
  private messageToSessionMap: Map<string, string> = new Map();
  private receiveCallback?: (recipientId: string, message: MessageDto) => void;

  private readonly TEST_PASSWORD = 'test';
  private readonly TEST_USER_ID = 'test-user-1';

  constructor(app: App, bot: Telegraf) {
    super('telegram', app);
    this.bot = bot;
    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.bot.command('start', this.handleStartCommand.bind(this));
    this.bot.command('auth', this.handleAuthCommand.bind(this));
    this.bot.on(message('text'), this.handleTextMessage.bind(this));
  }

  private async handleStartCommand(ctx: Context): Promise<void> {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    await ctx.reply('Welcome! Please authenticate with /auth <password>');
  }

  private async handleAuthCommand(ctx: Context): Promise<void> {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const message = ctx.message as unknown as Record<string, unknown>;
    const text = (message.text as string) || '';
    const parts = text.split(' ');
    const password = parts[1];

    if (!password) {
      await ctx.reply('Usage: /auth <password>');
      return;
    }

    if (password === this.TEST_PASSWORD) {
      this.authStates.set(chatId, {
        authenticated: true,
        userId: chatId.toString(),
      });
      await ctx.reply(`Authenticated as user: ${this.TEST_USER_ID}`);
    } else {
      await ctx.reply('Invalid password');
    }
  }

  private async handleTextMessage(ctx: Context<Update.MessageUpdate>): Promise<void> {
    const msg = ctx.message;
    if (!msg || !('text' in msg)) return;

    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const messageText = (msg as any).text;

    const authState = this.authStates.get(chatId);
    if (!authState?.authenticated) {
      await ctx.reply('Please authenticate first with /auth <password>');
      return;
    }

    const userId = chatId.toString();

    // Check if this message is a reply to another message
    const replyToMessage = (msg as any).reply_to_message;
    const replyToMessageId = replyToMessage?.message_id;

    if (replyToMessageId) {
      const messageKey = `${chatId}-${replyToMessageId}`;
      const sessionId = this.messageToSessionMap.get(messageKey);

      if (sessionId) {
        const user = await this.app.services.userService.loadUser(this.TEST_USER_ID);
        const messageDto: MessageDto = {
          message: messageText,
          session: { id: sessionId } as SessionData,
          user,
        };

        if (this.receiveCallback) {
          this.receiveCallback(userId, messageDto);
        }
      } else {
        await ctx.reply('Session context lost. Please reply to a message from the bot.');
      }
    } else {
      await ctx.reply('Please reply to a message from the bot to provide your answer.');
    }
  }

  async send(recipientId: string, message: MessageDto): Promise<void> {
    try {
      const chatId = parseInt(recipientId, 10);

      const sent = await this.bot.telegram.sendMessage(chatId, message.message);

      const messageKey = `${chatId}-${sent.message_id}`;
      this.messageToSessionMap.set(messageKey, message.session.id);

      console.log(`[TelegramChannel] Sent message to chat ${recipientId} for session ${message.session.id}`);
    } catch (error) {
      console.error(`[TelegramChannel] Failed to send message to chat ${recipientId}:`, error);
      throw error;
    }
  }

  receive(callback: (recipientId: string, message: MessageDto) => void): void {
    this.receiveCallback = callback;
    console.log('[TelegramChannel] Receive callback registered');
  }

  async close(): Promise<void> {
    console.log('[TelegramChannel] Closing...');
    this.authStates.clear();
    this.messageToSessionMap.clear();
  }
}
