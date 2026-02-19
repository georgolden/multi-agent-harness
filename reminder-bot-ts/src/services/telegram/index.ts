import { Telegraf, Context } from 'telegraf';
import { message } from 'telegraf/filters';
import { Update } from 'telegraf/types';
import type { App } from '../../app.js';
import { markdownToTelegramHtml } from '../../utils/markdownToTelegramHtml.js';

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

    // Launch bot
    this.bot
      .launch(() => {
        console.log('[Telegram] Bot launched!');
      })
      .catch((error) => console.error('[Telegram] Error launching bot:', error));

    this.app.infra.bus.on('telegram.sendMessage', async (data: { chatId: string; message: string }) => {
      console.log(`[Telegram] Sending message to chat ${data.chatId}: ${data.message}`);
      await this.sendMessage(data.chatId, data.message).catch((error) => {
        console.error(`[Telegram] Failed to send message to chat ${data.chatId}:`, error);
      });
    });
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
      await this.bot.telegram.sendMessage(parseInt(chatId), markdownToTelegramHtml(message), {
        parse_mode: 'HTML',
      });
      console.log(`[Telegram] Sent message to chat ${chatId}`);
    } catch (error) {
      console.error(`[Telegram] Failed to send message to chat ${chatId}:`, error);
      throw error;
    }
  }

  /**
   * Handle incoming messages — routes to timezone setup for new users,
   * reminder flow for registered users.
   */
  private async handleMessage(ctx: Context<Update.MessageUpdate>): Promise<void> {
    if (!ctx.message || !('text' in ctx.message)) return;

    const userId = ctx.from!.id.toString();
    const chatId = ctx.chat!.id.toString();
    const message = ctx.message.text;

    console.log(`\n[Bot] Message from ${userId}: ${message}`);

    const isRegistered = await this.app.data.reminderRepository.hasUser(userId);
    const flow = isRegistered
      ? this.app.flows.createReminderFlow()
      : this.app.flows.createTimezoneFlow();

    const context = { userId, message, chatId };
    const sharedStore = { app: this.app, context };
    try {
      await flow.run(sharedStore);
    } catch (error) {
      console.error('[Bot] Error:', error);
      await ctx.reply(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async startCommand(ctx: Context): Promise<void> {
    const userId = ctx.from!.id.toString();
    const chatId = ctx.chat!.id.toString();

    const isRegistered = await this.app.data.reminderRepository.hasUser(userId);

    if (isRegistered) {
      const welcome = `👋 Hi! I'm your reminder assistant.\n\nI can help you:\n• Schedule one-time reminders\n• Set up recurring reminders\n• List your active reminders\n• Cancel reminders\n\nJust tell me what you want to be reminded about!`;
      await ctx.reply(welcome);
      return;
    }

    // New user — start timezone setup flow
    console.log(`\n[Bot] New user ${userId}, starting timezone setup`);
    const flow = this.app.flows.createTimezoneFlow();
    const context = { userId, message: 'hello', chatId };
    const sharedStore = { app: this.app, context };
    try {
      await flow.run(sharedStore);
    } catch (error) {
      console.error('[Bot] Error during timezone setup:', error);
      await ctx.reply(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async helpCommand(ctx: Context): Promise<void> {
    const helpText = `📖 How to use:\n\nOne-time reminders:\n- "Remind me to [task] at [time]"\n\nRecurring reminders:\n- "Remind me to [task] every day at [time]"\n\nManage reminders:\n- "Show my reminders"\n- "Cancel reminder [ID]"`;
    await ctx.reply(helpText);
  }
}

if (!process.env.TELEGRAM_BOT_TOKEN) {
  throw new Error('Env TELEGRAM_BOT_TOKEN is not defined');
}

export const config = {
  token: process.env.TELEGRAM_BOT_TOKEN,
};
