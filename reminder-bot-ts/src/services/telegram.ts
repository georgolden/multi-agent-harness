import { Telegraf, Context } from 'telegraf';
import { message } from 'telegraf/filters';
import { Update } from 'telegraf/types';
import type { App } from '../app.js';

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

    // Restore scheduled jobs with the callback bound to this service
    // We do this here to ensure the scheduler has a valid callback to fire
    await this.app.services.scheduler.restoreJobs();

    // Launch bot
    await this.bot.launch(() => {
      console.log('[Telegram] Bot launched!');
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
      await this.bot.telegram.sendMessage(parseInt(chatId), message, {
        parse_mode: 'Markdown',
      });
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
    const flow = this.app.flows.createReminderFlow();
    const context = { userId, message, chatId };
    const sharedStore = { app: this.app, context };
    try {
      await flow.run(sharedStore);
      this.app.data.messageHistory.clearConversation(userId);
    } catch (error) {
      console.error('[Bot] Error:', error);
      await ctx.reply(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async startCommand(ctx: Context): Promise<void> {
    const welcome = `👋 Hi! I'm your reminder assistant.\n\nI can help you:\n• Schedule one-time reminders\n• Set up recurring reminders\n• List your active reminders\n• Cancel reminders\n\nJust tell me what you want to be reminded about!`;
    await ctx.reply(welcome);
  }

  private async helpCommand(ctx: Context): Promise<void> {
    const helpText = `📖 How to use:\n\nOne-time reminders:\n- "Remind me to [task] at [time]"\n\nRecurring reminders:\n- "Remind me to [task] every day at [time]"\n\nManage reminders:\n- "Show my reminders"\n- "Cancel reminder [ID]"`;
    await ctx.reply(helpText);
  }
}
