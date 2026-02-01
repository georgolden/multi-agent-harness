/**
 * PocketFlow nodes for the reminder bot.
 * Each node has a clear, single responsibility.
 */
import { Node } from 'pocketflow'
import { format } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import type { ReminderBotSharedState, Reminder, ConversationMessage } from './types'
import {
  getReminders,
  getReminderForUser,
  saveReminder,
  deleteReminder,
  generateReminderId,
  getUserTimezone,
  setUserTimezone,
} from './services/storage'
import { removeJob } from './services/scheduler'
import { callLlmWithTools } from './utils/callLlm'
import { validateTimezone, parseIsoDatetime, validateCronExpression } from './utils/validation'
import { createSystemPrompt } from './prompts'
import { TOOLS } from './tools'

const MAX_CONTEXT_MESSAGES = 20

/**
 * ParseInput: Initialize shared store from incoming message
 */
export class ParseInput extends Node<ReminderBotSharedState> {
  async prep(shared: ReminderBotSharedState) {
    return {
      userId: shared.userId,
      chatId: shared.chatId,
      message: shared.message,
      conversation: shared.conversation || [],
    }
  }

  async exec(inputs: { userId: string; chatId: string; message: string; conversation: ConversationMessage[] }) {
    return inputs
  }

  async post(shared: ReminderBotSharedState, _prepRes: unknown, execRes: any) {
    shared.originalMessage = execRes.message
    shared.conversation = execRes.conversation || []
    console.log(
      `[ParseInput] User ${execRes.userId}: ${execRes.message} (conversation: ${shared.conversation.length} msgs)`,
    )
    return 'default'
  }
}

/**
 * DecideAction: LLM decides what action to take
 */
export class DecideAction extends Node<ReminderBotSharedState> {
  constructor() {
    super(3, 1) // maxRetries: 3, wait: 1s
  }

  async prep(shared: ReminderBotSharedState) {
    const userReminders = await getReminders(shared.userId)
    return {
      originalMessage: shared.originalMessage!,
      conversation: shared.conversation,
      userId: shared.userId,
      userReminders,
    }
  }

  formatReminderForContext(r: Reminder): string {
    if (r.scheduleType === 'cron') {
      let cronExpr = r.scheduleValue
      if (cronExpr.includes('|ends:')) {
        cronExpr = cronExpr.split('|ends:')[0]
      }
      return `- [${r.id}] "${r.text}" (recurring: ${cronExpr})`
    } else {
      return `- [${r.id}] "${r.text}" (at ${r.scheduleValue})`
    }
  }

  async exec(inputs: any) {
    // Get user's timezone
    const userTz = await getUserTimezone(inputs.userId)

    // Format current datetime in user's timezone
    const currentDt = formatInTimeZone(new Date(), userTz, 'yyyy-MM-dd HH:mm:ss zzz')

    // Build user's reminders context
    const userReminders: Reminder[] = inputs.userReminders
    let remindersContext = ''
    if (userReminders.length > 0) {
      remindersContext =
        '\n\nUSER\'S ACTIVE REMINDERS:\n' + userReminders.map((r) => this.formatReminderForContext(r)).join('\n')
    } else {
      remindersContext = "\n\nUSER'S ACTIVE REMINDERS: None"
    }

    const systemPrompt = createSystemPrompt(currentDt, userTz, remindersContext)

    const messages: ConversationMessage[] = [{ role: 'system', content: systemPrompt }]

    // Add conversation history (rolling window)
    const conversation = inputs.conversation.slice(-MAX_CONTEXT_MESSAGES)
    for (const msg of conversation) {
      messages.push(msg)
    }

    // Add current message
    messages.push({
      role: 'user',
      content: inputs.originalMessage,
    })

    console.log(
      `[DecideAction] Calling LLM with ${messages.length} messages (user_tz: ${userTz}, ${userReminders.length} reminders)`,
    )

    // Call LLM with tools
    const response = await callLlmWithTools(messages, TOOLS)

    // Fallback: if the model returns a normal assistant message without tool calls
    if (!response.tool_calls || response.tool_calls.length === 0) {
      return { assistantReply: response.content || '' }
    }

    // Return first tool call (DeepSeek doesn't support parallel)
    return response.tool_calls[0]
  }

  async post(shared: ReminderBotSharedState, _prepRes: unknown, execRes: any) {
    // Tool-call fallback: accept a normal assistant reply
    if (execRes.assistantReply) {
      shared.response = execRes.assistantReply.trim() || '(no response)'
      shared.needsReply = false
      console.log('[DecideAction] No tool_calls; returning assistant reply directly')
      return undefined // End flow
    }

    // Handle single tool call
    const tc = execRes
    const toolName = tc.function.name
    const toolArgs = JSON.parse(tc.function.arguments)

    console.log(`[DecideAction] Tool: ${toolName}, Args: ${JSON.stringify(toolArgs)}`)

    shared.toolName = toolName
    shared.toolArgs = toolArgs

    // Route based on tool
    if (toolName === 'ask_user') {
      shared.question = toolArgs.question
      return 'need_info'
    } else if (toolName === 'schedule_once') {
      return 'schedule_once'
    } else if (toolName === 'schedule_cron') {
      return 'schedule_cron'
    } else if (toolName === 'schedule_cron_finite') {
      return 'schedule_cron_finite'
    } else if (toolName === 'list_reminders') {
      return 'list'
    } else if (toolName === 'cancel_reminder') {
      return 'cancel'
    } else if (toolName === 'cancel_all_reminders') {
      return 'cancel_all'
    } else if (toolName === 'set_timezone') {
      return 'set_timezone'
    } else if (toolName === 'edit_reminder') {
      return 'edit'
    } else {
      throw new Error(`Unknown tool: ${toolName}`)
    }
  }
}

/**
 * AskUser: Request missing information from user
 */
export class AskUser extends Node<ReminderBotSharedState> {
  async prep(shared: ReminderBotSharedState) {
    return shared.question!
  }

  async exec(question: string) {
    console.log(`[AskUser] Question: ${question}`)
    return question
  }

  async post(shared: ReminderBotSharedState, _prepRes: unknown, execRes: string) {
    shared.response = `❓ ${execRes}`
    shared.needsReply = true
    console.log(`[AskUser] Response set: ${shared.response.slice(0, 100)}...`)
    return undefined // End flow
  }
}

/**
 * ScheduleOnce: Create one-time reminder
 */
export class ScheduleOnce extends Node<ReminderBotSharedState> {
  async prep(shared: ReminderBotSharedState) {
    const args = shared.toolArgs!
    return {
      userId: shared.userId,
      chatId: shared.chatId,
      reminderText: args.reminder_text as string,
      datetimeIso: args.datetime_iso as string,
      timezone: args.timezone as string,
    }
  }

  async exec(inputs: any) {
    // Validate timezone
    const tzError = validateTimezone(inputs.timezone)
    if (tzError) {
      return { error: tzError }
    }

    // Validate datetime
    const { error: dtError } = parseIsoDatetime(inputs.datetimeIso)
    if (dtError) {
      return { error: dtError }
    }

    const reminderId = generateReminderId()

    // Save to storage
    const reminder = await saveReminder({
      userId: inputs.userId,
      chatId: inputs.chatId,
      text: inputs.reminderText,
      scheduleType: 'once',
      scheduleValue: inputs.datetimeIso,
      timezone: inputs.timezone,
      reminderId,
    })

    return reminder
  }

  async post(shared: ReminderBotSharedState, _prepRes: unknown, execRes: any) {
    if (execRes.error) {
      shared.response = `⚠️ ${execRes.error}`
      shared.needsReply = false
      return undefined
    }
    shared.reminder = execRes
    shared.scheduleJob = true // Flag for bot to schedule the actual job
    console.log(`[ScheduleOnce] Created reminder: ${execRes.id}`)
    return 'confirm'
  }
}

/**
 * ScheduleCronFinite: Create recurring reminder with end datetime
 */
export class ScheduleCronFinite extends Node<ReminderBotSharedState> {
  async prep(shared: ReminderBotSharedState) {
    const args = shared.toolArgs!
    return {
      userId: shared.userId,
      chatId: shared.chatId,
      reminderText: args.reminder_text as string,
      cronExpression: args.cron_expression as string,
      endDatetimeIso: args.end_datetime_iso as string,
      timezone: args.timezone as string,
    }
  }

  async exec(inputs: any) {
    // Validate timezone
    const tzError = validateTimezone(inputs.timezone)
    if (tzError) {
      return { error: tzError }
    }

    // Validate cron
    const cronError = validateCronExpression(inputs.cronExpression)
    if (cronError) {
      return { error: cronError }
    }

    // Validate end datetime
    const { error: endError } = parseIsoDatetime(inputs.endDatetimeIso)
    if (endError) {
      return { error: endError }
    }

    const reminderId = generateReminderId()
    const scheduleValue = `${inputs.cronExpression}|ends:${inputs.endDatetimeIso}`

    const reminder = await saveReminder({
      userId: inputs.userId,
      chatId: inputs.chatId,
      text: inputs.reminderText,
      scheduleType: 'cron',
      scheduleValue,
      timezone: inputs.timezone,
      reminderId,
    })

    return {
      ...reminder,
      _endDate: inputs.endDatetimeIso,
      _cronExpression: inputs.cronExpression,
    }
  }

  async post(shared: ReminderBotSharedState, _prepRes: unknown, execRes: any) {
    if (execRes.error) {
      // Loop back to DecideAction to retry
      shared.originalMessage = `Error: ${execRes.error}. Recompute end_datetime_iso correctly (end of window on end day). Original request: ${shared.originalMessage || ''}`
      return 'decide_action'
    }
    shared.reminder = execRes
    shared.scheduleJob = true
    console.log(`[ScheduleCronFinite] Created reminder: ${execRes.id}`)
    return 'confirm'
  }
}

/**
 * ScheduleCron: Create recurring reminder (no end date)
 */
export class ScheduleCron extends Node<ReminderBotSharedState> {
  async prep(shared: ReminderBotSharedState) {
    const args = shared.toolArgs!
    return {
      userId: shared.userId,
      chatId: shared.chatId,
      reminderText: args.reminder_text as string,
      cronExpression: args.cron_expression as string,
      timezone: args.timezone as string,
    }
  }

  async exec(inputs: any) {
    // Validate timezone
    const tzError = validateTimezone(inputs.timezone)
    if (tzError) {
      return { error: tzError }
    }

    // Validate cron
    const cronError = validateCronExpression(inputs.cronExpression)
    if (cronError) {
      return { error: cronError }
    }

    const reminderId = generateReminderId()

    const reminder = await saveReminder({
      userId: inputs.userId,
      chatId: inputs.chatId,
      text: inputs.reminderText,
      scheduleType: 'cron',
      scheduleValue: inputs.cronExpression,
      timezone: inputs.timezone,
      reminderId,
    })

    return {
      ...reminder,
      _endDate: null,
      _cronExpression: inputs.cronExpression,
    }
  }

  async post(shared: ReminderBotSharedState, _prepRes: unknown, execRes: any) {
    if (execRes.error) {
      shared.response = `⚠️ ${execRes.error}`
      shared.needsReply = false
      return undefined
    }
    shared.reminder = execRes
    shared.scheduleJob = true
    console.log(`[ScheduleCron] Created reminder: ${execRes.id}`)
    return 'confirm'
  }
}

/**
 * ListReminders: List user's active reminders
 */
export class ListReminders extends Node<ReminderBotSharedState> {
  async prep(shared: ReminderBotSharedState) {
    return shared.userId
  }

  async exec(userId: string) {
    const reminders = await getReminders(userId)
    console.log(`[ListReminders] Found ${reminders.length} reminders for user ${userId}`)
    return reminders
  }

  async post(shared: ReminderBotSharedState, _prepRes: unknown, execRes: Reminder[]) {
    shared.remindersList = execRes
    return 'confirm'
  }
}

/**
 * CancelReminder: Cancel a specific reminder
 */
export class CancelReminder extends Node<ReminderBotSharedState> {
  async prep(shared: ReminderBotSharedState) {
    return {
      reminderId: (shared.toolArgs!.reminder_id as string),
      userId: shared.userId,
    }
  }

  async exec(inputs: { reminderId: string; userId: string }) {
    const reminder = await getReminderForUser(inputs.reminderId, inputs.userId)

    if (!reminder) {
      return { success: false, error: 'Reminder not found' }
    }

    // Remove from scheduler
    await removeJob(inputs.reminderId)

    // Mark as deleted in storage
    const success = await deleteReminder(inputs.reminderId)

    return {
      success,
      reminder: success ? reminder : null,
    }
  }

  async post(shared: ReminderBotSharedState, _prepRes: unknown, execRes: any) {
    shared.cancelResult = execRes
    console.log(`[CancelReminder] Result: ${JSON.stringify(execRes)}`)
    return 'confirm'
  }
}

/**
 * CancelAllReminders: Cancel all reminders for a user
 */
export class CancelAllReminders extends Node<ReminderBotSharedState> {
  async prep(shared: ReminderBotSharedState) {
    return shared.userId
  }

  async exec(userId: string) {
    const reminders = await getReminders(userId)
    const cancelled: Reminder[] = []

    for (const r of reminders) {
      await removeJob(r.id)
      await deleteReminder(r.id)
      cancelled.push(r)
    }

    return {
      count: cancelled.length,
      cancelled,
    }
  }

  async post(shared: ReminderBotSharedState, _prepRes: unknown, execRes: any) {
    shared.cancelAllResult = execRes
    console.log(`[CancelAllReminders] Cancelled ${execRes.count} reminders`)
    return 'confirm'
  }
}

/**
 * EditReminder: Edit an existing reminder
 */
export class EditReminder extends Node<ReminderBotSharedState> {
  async prep(shared: ReminderBotSharedState) {
    const args = shared.toolArgs!
    return {
      userId: shared.userId,
      chatId: shared.chatId,
      reminderId: args.reminder_id as string,
      reminderName: args.reminder_name as string,
      newReminderName: args.new_reminder_name as string,
      newQuery: args.new_query as string,
      timezone: args.timezone as string,
    }
  }

  async exec(inputs: any) {
    // Get reminder by ID and verify user
    const reminder = await getReminderForUser(inputs.reminderId, inputs.userId)
    if (!reminder) {
      return { error: `Reminder id '${inputs.reminderId}' not found` }
    }

    // Optional name check (non-fatal): just log
    if (reminder.text.toLowerCase() !== inputs.reminderName.toLowerCase()) {
      console.log(`[EditReminder] Name mismatch: '${reminder.text}' vs '${inputs.reminderName}'`)
    }

    // Cancel old reminder
    await removeJob(reminder.id)
    await deleteReminder(reminder.id)

    // Ensure new_query contains new reminder name
    let newQuery = inputs.newQuery
    if (!newQuery.toLowerCase().includes(inputs.newReminderName.toLowerCase())) {
      newQuery = `${inputs.newReminderName}: ${newQuery}`
    }

    return { nextQuery: newQuery }
  }

  async post(shared: ReminderBotSharedState, _prepRes: unknown, execRes: any) {
    if (execRes.error) {
      shared.response = `⚠️ ${execRes.error}`
      shared.needsReply = false
      return undefined
    }

    // Replace original message with the new query and loop back to DecideAction
    shared.originalMessage = execRes.nextQuery
    return 'decide_action'
  }
}

/**
 * SetTimezone: Set user's preferred timezone
 */
export class SetTimezone extends Node<ReminderBotSharedState> {
  async prep(shared: ReminderBotSharedState) {
    return {
      userId: shared.userId,
      timezone: shared.toolArgs!.timezone as string,
    }
  }

  async exec(inputs: { userId: string; timezone: string }) {
    // Validate timezone
    const error = validateTimezone(inputs.timezone)
    if (error) {
      return { success: false, error }
    }

    await setUserTimezone(inputs.userId, inputs.timezone)
    return { success: true, timezone: inputs.timezone }
  }

  async post(shared: ReminderBotSharedState, _prepRes: unknown, execRes: any) {
    shared.timezoneResult = execRes
    console.log(`[SetTimezone] Result: ${JSON.stringify(execRes)}`)
    return 'confirm'
  }
}

/**
 * Confirm: Generate confirmation message
 */
export class Confirm extends Node<ReminderBotSharedState> {
  async prep(shared: ReminderBotSharedState) {
    return {
      toolName: shared.toolName,
      reminder: shared.reminder,
      remindersList: shared.remindersList,
      cancelResult: shared.cancelResult,
      cancelAllResult: shared.cancelAllResult,
      timezoneResult: shared.timezoneResult,
      userId: shared.userId,
    }
  }

  formatDatetime(dtStr: string, storedTz: string, userId?: string): string {
    try {
      const dt = new Date(dtStr.replace('Z', '+00:00'))
      // Format in user's timezone
      const tz = storedTz
      return formatInTimeZone(dt, tz, 'MMM dd \'at\' HH:mm')
    } catch {
      return dtStr
    }
  }

  describeCron(cronExpr: string): string {
    // Handle end_date suffix
    let endInfo = ''
    if (cronExpr.includes('|ends:')) {
      const [cron, endStr] = cronExpr.split('|ends:')
      cronExpr = cron
      try {
        const endDt = new Date(endStr)
        endInfo = ` (until ${format(endDt, 'HH:mm')})`
      } catch {
        // Ignore
      }
    }

    const parts = cronExpr.trim().split(/\s+/)
    if (parts.length !== 5) {
      return cronExpr + endInfo
    }

    const [minute, hour, day, month, dow] = parts

    let desc = cronExpr
    if (cronExpr.trim() === '* * * * *') {
      desc = 'every minute'
    } else if (minute === '0' && hour === '*') {
      desc = 'every hour'
    } else if (minute !== '*' && hour !== '*' && day === '*' && month === '*' && dow === '*') {
      desc = `daily at ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
    } else if (minute.startsWith('*/')) {
      desc = `every ${minute.slice(2)} minutes`
    } else if (hour.startsWith('*/')) {
      desc = `every ${hour.slice(2)} hours`
    }

    return desc + endInfo
  }

  async exec(inputs: any) {
    const toolName = inputs.toolName

    if (toolName === 'schedule_once') {
      const r = inputs.reminder
      const formattedTime = this.formatDatetime(r.scheduleValue, r.timezone, inputs.userId)
      return `✅ Reminder set!\n\n📝 ${r.text}\n⏰ ${formattedTime}`
    } else if (toolName === 'schedule_cron' || toolName === 'schedule_cron_finite') {
      const r = inputs.reminder
      const cronDesc = this.describeCron(r.scheduleValue)
      return `✅ Recurring reminder set!\n\n📝 ${r.text}\n🔄 ${cronDesc}`
    } else if (toolName === 'list_reminders') {
      const reminders: Reminder[] = inputs.remindersList || []
      if (reminders.length === 0) {
        return '📋 You have no active reminders.'
      }

      const lines = ['📋 Your reminders:\n']
      for (const r of reminders) {
        if (r.scheduleType === 'cron') {
          const scheduleInfo = `🔄 ${this.describeCron(r.scheduleValue)}`
          lines.push(`• ${r.text}\n  ${scheduleInfo}`)
        } else {
          const scheduleInfo = `📅 ${this.formatDatetime(r.scheduleValue, r.timezone, inputs.userId)}`
          lines.push(`• ${r.text}\n  ${scheduleInfo}`)
        }
      }

      return lines.join('\n')
    } else if (toolName === 'cancel_reminder') {
      const result = inputs.cancelResult
      if (result.success) {
        const r = result.reminder
        return `❌ Reminder cancelled: ${r.text}`
      } else {
        return `⚠️ Could not cancel reminder: ${result.error || 'Unknown error'}`
      }
    } else if (toolName === 'cancel_all_reminders') {
      const result = inputs.cancelAllResult
      const count = result.count
      if (count === 0) {
        return '📋 No reminders to cancel.'
      }
      return `🗑️ Cancelled ${count} reminder(s)!`
    } else if (toolName === 'set_timezone') {
      const result = inputs.timezoneResult
      if (result.success) {
        return `🌍 Timezone set to ${result.timezone}!`
      } else {
        return `⚠️ ${result.error}`
      }
    }

    return 'Done!'
  }

  async post(shared: ReminderBotSharedState, _prepRes: unknown, execRes: string) {
    shared.response = execRes
    shared.needsReply = false
    console.log(`[Confirm] Response: ${execRes.slice(0, 100)}...`)
    return undefined // End flow
  }
}
