import { Telegraf, Context } from 'telegraf';
import { message } from 'telegraf/filters';
import { Update } from 'telegraf/types';
import type { App } from '../../app.js';
import { TelegramChannel } from './channel.js';

export class TelegramService {
  private bot: Telegraf;
  private app: App;

  constructor(app: App, { token }: { token: string }) {
    this.app = app;
    this.bot = new Telegraf(token);

    // Register handlers
    this.bot.command('start', this.startCommand.bind(this));
    this.bot.command('help', this.helpCommand.bind(this));
    this.bot.on(message('text'), this.handleMessage.bind(this));
  }

  /**
   * Start the Telegram bot service
   */
  async start(): Promise<void> {
    console.log('[Telegram] Starting bot...');

    // Create and register Telegram channel
    const channel = new TelegramChannel(this.app, this.bot);
    this.app.services.channel.registerChannel(channel);

    // Launch bot
    this.bot
      .launch(() => {
        console.log('[Telegram] Bot launched!');
      })
      .catch((error) => console.error('[Telegram] Error launching bot:', error));
  }

  /**
   * Stop the Telegram bot service
   */
  async stop(): Promise<void> {
    console.log('[Telegram] Stopping bot...');
    this.bot.stop();
  }

  /**
   * Send a message to a user/chat
   */
  async sendMessage(chatId: string, message: string): Promise<void> {
    try {
      await this.bot.telegram.sendMessage(parseInt(chatId), message);
      console.log(`[Telegram] Sent message to chat ${chatId}`);
    } catch (error) {
      console.error(`[Telegram] Failed to send message to chat ${chatId}:`, error);
      throw error;
    }
  }

  /**
   * Handle incoming messages
   */
  private async handleMessage(ctx: Context<Update.MessageUpdate>): Promise<void> {
    if (!ctx.message || !('text' in ctx.message)) return;

    const userId = ctx.from!.id.toString();
    const chatId = ctx.chat!.id.toString();
    const message = ctx.message.text;

    console.log(`\n[Bot] Message from ${userId}: ${message}`);
  }

  private async startCommand(ctx: Context): Promise<void> {
    const welcome = `Hi! I'm your assistant.`;
    await ctx.reply(welcome);
  }

  private async helpCommand(ctx: Context): Promise<void> {
    const helpText = 'Help';
    await ctx.reply(helpText);
  }
}

if (!process.env.TELEGRAM_BOT_TOKEN) {
  throw new Error('Env TELEGRAM_BOT_TOKEN is not defined');
}

export const config = {
  token: process.env.TELEGRAM_BOT_TOKEN,
};
