/**
 * Telegram bot entry point for the reminder agent.
 */
import 'dotenv/config'
import { Telegraf, Context } from 'telegraf'
import { Update } from 'telegraf/types'
import type { Job } from 'agenda'
import { createReminderFlow } from './flow'
import { initStorage, closeStorage, getAllReminders } from './services/storage'
import { initScheduler, stopScheduler, scheduleOnce, scheduleCron, getAgenda } from './services/scheduler'
import type { ConversationMessage, Reminder, ReminderBotSharedState } from './types'

// Global flow instance
const reminderFlow = createReminderFlow()

// Global bot instance (for reminder callbacks)
let globalBot: Telegraf | null = null

// Store for conversation state (user_id -> conversation history)
// We keep a fixed-size rolling window of recent messages per user.
const MAX_CONVERSATION_MESSAGES = 20
const conversations = new Map<string, ConversationMessage[]>()

/**
 * Trim conversation to keep only recent messages
 */
function trimConversation(conv: ConversationMessage[]): ConversationMessage[] {
  if (conv.length <= MAX_CONVERSATION_MESSAGES) {
    return conv
  }
  return conv.slice(-MAX_CONVERSATION_MESSAGES)
}

/**
 * Send reminder callback (executed by scheduler)
 */
async function sendReminder(job: Job): Promise<void> {
  if (!globalBot) {
    console.error('[Reminder] Global bot not initialized')
    return
  }

  const { chatId, text, reminderId, scheduleType } = job.attrs.data as {
    chatId: string
    text: string
    reminderId: string
    scheduleType: string
  }

  const message = `🔔 ${text}`

  try {
    await globalBot.telegram.sendMessage(parseInt(chatId), message)
    console.log(`[Reminder] Sent reminder ${reminderId} to chat ${chatId}`)
  } catch (error) {
    console.error(`[Reminder] Failed to send reminder ${reminderId} to chat ${chatId}:`, error)
    return
  }

  // Auto-delete one-time reminders after firing
  if (scheduleType === 'once') {
    const { deleteReminder } = await import('./services/storage')
    await deleteReminder(reminderId)
    console.log(`[Reminder] Auto-deleted one-time reminder ${reminderId}`)
  }
}

/**
 * Schedule a single reminder job
 */
async function scheduleReminderJob(r: Reminder): Promise<void> {
  const callbackData = {
    chatId: r.chatId,
    text: r.text,
    reminderId: r.id,
    scheduleType: r.scheduleType,
  }

  if (r.scheduleType === 'once') {
    await scheduleOnce({
      jobId: r.id,
      runDate: r.scheduleValue,
      callback: sendReminder,
      timezone: r.timezone,
      callbackData,
    })
  } else if (r.scheduleType === 'cron') {
    let cronExpr = r.scheduleValue
    let endDate: string | undefined

    if (cronExpr.includes('|ends:')) {
      const parts = cronExpr.split('|ends:')
      cronExpr = parts[0]
      endDate = parts[1]
    }

    await scheduleCron({
      jobId: r.id,
      cronExpression: cronExpr,
      callback: sendReminder,
      timezone: r.timezone,
      endDate,
      callbackData,
    })
  }
}

/**
 * Restore scheduled jobs from storage on startup
 */
async function restoreScheduledJobs(): Promise<void> {
  const reminders = await getAllReminders()
  console.log(`[Startup] Restoring ${reminders.length} reminders...`)

  for (const r of reminders) {
    try {
      await scheduleReminderJob(r)
      console.log(`[Startup] Restored reminder: ${r.id}`)
    } catch (error) {
      console.error(`[Startup] Failed to restore reminder ${r.id}:`, error)
    }
  }
}

/**
 * Handle incoming messages
 */
async function handleMessage(ctx: Context<Update.MessageUpdate>): Promise<void> {
  if (!ctx.message || !('text' in ctx.message)) return

  const userId = ctx.from!.id.toString()
  const chatId = ctx.chat!.id.toString()
  const message = ctx.message.text

  console.log(`\n[Bot] Message from ${userId}: ${message}`)

  let conversation = conversations.get(userId) || []
  conversation = trimConversation(conversation)

  const shared: ReminderBotSharedState = {
    userId,
    chatId,
    message,
    conversation: [...conversation],
  }

  try {
    await reminderFlow.run(shared)

    // Schedule jobs requested by the flow
    if (shared.scheduleJob && shared.reminder) {
      await scheduleReminderJob(shared.reminder)
    }

    if (shared.scheduleJobs) {
      for (const r of shared.scheduleJobs) {
        await scheduleReminderJob(r)
      }
    }

    const response = shared.response || 'Something went wrong.'
    await ctx.reply(response)

    // Always update conversation history (fixed-size rolling window)
    conversation.push({ role: 'user', content: message })
    conversation.push({ role: 'assistant', content: response })
    conversations.set(userId, trimConversation(conversation))
  } catch (error) {
    console.error('[Bot] Error:', error)
    await ctx.reply(`❌ Error: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * /start command handler
 */
async function startCommand(ctx: Context): Promise<void> {
  const welcome = `👋 Hi! I'm your reminder assistant.

I can help you:
• Schedule one-time reminders
• Set up recurring reminders
• List your active reminders
• Cancel reminders

Just tell me what you want to be reminded about!`

  await ctx.reply(welcome)
}

/**
 * /help command handler
 */
async function helpCommand(ctx: Context): Promise<void> {
  const helpText = `📖 How to use:

One-time reminders:
- "Remind me to [task] at [time]"

Recurring reminders:
- "Remind me to [task] every day at [time]"

Manage reminders:
- "Show my reminders"
- "Cancel reminder [ID]"`

  await ctx.reply(helpText)
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN environment variable not set')
  }

  const dbUrl = process.env.DATABASE_URL || 'postgresql://localhost:5432/reminderbot'

  console.log('[Bot] Starting...', { dbUrl })

  // Initialize storage and scheduler
  await initStorage(dbUrl)
  await initScheduler(dbUrl)

  // Create Telegram bot
  const bot = new Telegraf(token)
  globalBot = bot

  // Restore scheduled jobs
  await restoreScheduledJobs()

  console.log('[Bot] Ready!')

  // Register handlers
  bot.command('start', startCommand)
  bot.command('help', helpCommand)
  bot.on('text', handleMessage)

  // Start polling
  console.log('[Bot] Starting polling...')
  await bot.launch()

  // Graceful shutdown
  process.once('SIGINT', async () => {
    console.log('[Bot] SIGINT received, shutting down...')
    bot.stop('SIGINT')
    await stopScheduler()
    await closeStorage()
  })
  process.once('SIGTERM', async () => {
    console.log('[Bot] SIGTERM received, shutting down...')
    bot.stop('SIGTERM')
    await stopScheduler()
    await closeStorage()
  })
}

// Run the bot
main().catch((error) => {
  console.error('[Bot] Fatal error:', error)
  process.exit(1)
})
