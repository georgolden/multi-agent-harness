// Core domain types
export interface Reminder {
  id: string
  userId: string
  chatId: string
  text: string
  scheduleType: 'once' | 'cron'
  scheduleValue: string // ISO datetime or cron expression
  timezone: string
  createdAt: Date
  active: boolean
}

export interface User {
  id: string
  timezone: string
}

// Conversation message
export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

// Shared state for PocketFlow
export interface ReminderBotSharedState {
  // Input from Telegram
  userId: string
  chatId: string
  message: string
  conversation: ConversationMessage[]

  // Working state
  originalMessage?: string
  toolName?: string
  toolArgs?: Record<string, unknown>

  // Results
  reminder?: Reminder
  remindersList?: Reminder[]
  scheduleJob?: boolean
  scheduleJobs?: Reminder[]

  // Cancel results
  cancelResult?: {
    success: boolean
    error?: string
    reminder?: Reminder
  }

  cancelAllResult?: {
    count: number
    cancelled: Reminder[]
  }

  // Timezone result
  timezoneResult?: {
    success: boolean
    timezone?: string
    error?: string
  }

  // Question for user
  question?: string

  // Final response
  response?: string
  needsReply?: boolean
}

// Tool call types
export interface ToolCall {
  function: {
    name: string
    arguments: string
  }
}

export interface LLMMessage {
  role: 'user' | 'assistant' | 'system'
  content: string | null
  tool_calls?: ToolCall[]
}
