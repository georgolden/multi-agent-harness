// src/index.ts
import "dotenv/config";

// src/data/messageHistory.ts
var MessageHistory = class {
  maxMessages;
  conversations;
  app;
  constructor(app2, { maxMessages }) {
    this.app = app2;
    this.maxMessages = maxMessages;
    this.conversations = /* @__PURE__ */ new Map();
  }
  /**
   * Initialize the message history service
   */
  async start() {
    console.log("[MessageHistory] Service started");
  }
  /**
   * Stop the service and clear all conversation history
   */
  async stop() {
    this.conversations.clear();
    console.log("[MessageHistory] Service stopped, conversations cleared");
  }
  /**
   * Trim conversation to keep only recent messages
   */
  trimConversation(conv) {
    if (conv.length <= this.maxMessages) {
      return conv;
    }
    return conv.slice(-this.maxMessages);
  }
  /**
   * Add a message to a user's conversation history
   */
  addMessage(userId, message2) {
    const history = this.conversations.get(userId) || [];
    history.push(message2);
    this.conversations.set(userId, this.trimConversation(history));
  }
  addMessages(userId, messages) {
    const history = this.conversations.get(userId) || [];
    history.push(...messages);
    this.conversations.set(userId, this.trimConversation(history));
  }
  /**
   * Get conversation history for a user
   */
  getConversation(userId) {
    return this.conversations.get(userId) || [];
  }
  /**
   * Clear conversation history for a specific user
   */
  clearConversation(userId) {
    this.conversations.delete(userId);
  }
};

// src/data/storage.ts
import { Pool } from "pg";
import { randomBytes } from "crypto";
var Storage = class {
  pool;
  app;
  constructor(app2, { connectionString }) {
    this.app = app2;
    this.pool = new Pool({ connectionString });
  }
  /**
   * Initialize database tables and indexes
   */
  async start() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS reminders (
        id VARCHAR(16) PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        chat_id VARCHAR(255) NOT NULL,
        text TEXT NOT NULL,
        schedule_type VARCHAR(10) NOT NULL CHECK (schedule_type IN ('once', 'cron')),
        schedule_value TEXT NOT NULL,
        start_date TIMESTAMP,
        end_date TIMESTAMP,
        timezone VARCHAR(50) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        active BOOLEAN NOT NULL DEFAULT TRUE
      )
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(255) PRIMARY KEY,
        timezone VARCHAR(50) NOT NULL DEFAULT 'UTC'
      )
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_reminders_user_active
      ON reminders(user_id, active)
    `);
    console.log("[Storage] Initialized with Postgres");
  }
  /**
   * Close the database connection pool
   */
  async stop() {
    await this.pool.end();
    console.log("[Storage] Connection closed");
  }
  /**
   * Generate a unique reminder ID
   */
  generateReminderId() {
    return randomBytes(4).toString("hex");
  }
  /**
   * Map database row (snake_case) to Reminder type (camelCase)
   */
  mapDbRowToReminder(row) {
    return {
      id: row.id,
      userId: row.user_id,
      chatId: row.chat_id,
      text: row.text,
      scheduleType: row.schedule_type,
      scheduleValue: row.schedule_value,
      startDate: row.start_date,
      endDate: row.end_date,
      timezone: row.timezone,
      createdAt: row.created_at,
      active: row.active
    };
  }
  /**
   * Save a new reminder to the database
   */
  async saveReminder(params) {
    const id = params.reminderId || this.generateReminderId();
    const result = await this.pool.query(
      `INSERT INTO reminders (id, user_id, chat_id, text, schedule_type, schedule_value, start_date, end_date, timezone)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        id,
        params.userId,
        params.chatId,
        params.text,
        params.scheduleType,
        params.scheduleValue,
        params.startDate,
        params.endDate,
        params.timezone
      ]
    );
    const reminder = this.mapDbRowToReminder(result.rows[0]);
    console.log(`[Storage] Saved reminder '${id}': ${params.text.slice(0, 50)}...`);
    return reminder;
  }
  /**
   * Get all active reminders for a specific user
   */
  async getReminders(userId) {
    const result = await this.pool.query(
      `SELECT * FROM reminders
       WHERE user_id = $1 AND active = TRUE
       ORDER BY created_at DESC`,
      [userId]
    );
    return result.rows.map((row) => this.mapDbRowToReminder(row));
  }
  /**
   * Get a specific reminder by ID
   */
  async getReminder(reminderId) {
    const result = await this.pool.query("SELECT * FROM reminders WHERE id = $1", [reminderId]);
    return result.rows[0] ? this.mapDbRowToReminder(result.rows[0]) : null;
  }
  /**
   * Get a reminder by ID, scoped to a specific user
   */
  async getReminderForUser(reminderId, userId) {
    const result = await this.pool.query(
      `SELECT * FROM reminders
       WHERE id = $1 AND user_id = $2 AND active = TRUE`,
      [reminderId, userId]
    );
    return result.rows[0] ? this.mapDbRowToReminder(result.rows[0]) : null;
  }
  /**
   * Get all active reminders (for scheduler restore on startup)
   */
  async getAllReminders() {
    const result = await this.pool.query("SELECT * FROM reminders WHERE active = TRUE");
    return result.rows.map((row) => this.mapDbRowToReminder(row));
  }
  /**
   * Soft delete a reminder (mark as inactive)
   */
  async deleteReminder(reminderId) {
    const result = await this.pool.query("UPDATE reminders SET active = FALSE WHERE id = $1 RETURNING id", [
      reminderId
    ]);
    if (result.rowCount === 0) {
      console.log(`[Storage] Reminder '${reminderId}' not found`);
      return false;
    }
    console.log(`[Storage] Deleted reminder '${reminderId}'`);
    return true;
  }
  /**
   * Get user's preferred timezone (creates user if not exists)
   */
  async getUserTimezone(userId) {
    const result = await this.pool.query("SELECT timezone FROM users WHERE id = $1", [userId]);
    if (result.rows.length === 0) {
      await this.pool.query("INSERT INTO users (id, timezone) VALUES ($1, $2)", [userId, "UTC"]);
      return "UTC";
    }
    return result.rows[0].timezone;
  }
  /**
   * Set user's preferred timezone
   */
  async setUserTimezone(userId, timezone2) {
    await this.pool.query(
      `INSERT INTO users (id, timezone) VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET timezone = $2`,
      [userId, timezone2]
    );
    console.log(`[Storage] Set timezone for user ${userId}: ${timezone2}`);
  }
};

// src/config/data.ts
if (!process.env.DATABASE_URL) {
  throw new Error("Env DATABASE_URL is not defined");
}
var data_default = {
  MessageHistory: { maxMessages: 20 },
  Storage: { connectionString: process.env.DATABASE_URL }
};

// src/data/index.ts
var Data = class {
  messageHistory;
  storage;
  constructor(app2) {
    this.messageHistory = new MessageHistory(app2, data_default.MessageHistory);
    this.storage = new Storage(app2, data_default.Storage);
  }
  async start() {
    await Promise.all([this.messageHistory.start(), this.storage.start()]);
  }
  async stop() {
    await Promise.all([this.messageHistory.stop(), this.storage.stop()]);
  }
};

// src/flows/reminder/flow.ts
import { Flow } from "pocketflow";

// src/flows/reminder/nodes.ts
import { Node, ParallelBatchNode } from "pocketflow";

// src/utils/callLlm.ts
import { OpenAI } from "openai";
async function callLlmWithTools(messages, tools) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY environment variable not set");
  }
  const client = new OpenAI({
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
    timeout: 6e4
  });
  const response = await client.chat.completions.create({
    model: "moonshotai/kimi-k2.5",
    messages,
    tools,
    tool_choice: "auto",
    temperature: 0.3
  });
  return response.choices;
}

// src/flows/reminder/prompts.ts
var SCHEDULE_SKILL = `
## Reminder Interpreter Skill

### Overview
This skill defines how to interpret and schedule three types of reminders: one-time, recurring, and recurring interval reminders.

---

### 1. One-Time Reminder

#### Detection Pattern
- Reminder text contains **only** a time or date reference
- No recurrence indicators present

#### Scheduling Process
1. **Extract parameters**: reminder text, target datetime
2. **Convert** reminder time/date to ISO datetime using user's timezone
3. **Execute** \`schedule_once\` tool

---

### 2. Recurring Reminder

#### Detection Patterns
Recurrence indicators include:
- **Frequency keywords**: \`daily\`, \`weekly\`, \`monthly\`
- **Interval expressions**: \`every minute\`, \`every hour\`, \`every day\`
- **Specific days**: \`every Monday\`, \`every Thursday\`

#### Optional Constraints
Schedule may include start/end boundaries:

| Pattern Example | Parameters Involved |
|----------------|---------------------|
| "every minute start at HH" | \`schedule_start_date\` |
| "daily from Monday at HH" | \`schedule_start_date\` |
| "every 5 minutes end at HH" | \`schedule_end_date\` |
| "weekly up to next Monday at HH" | \`schedule_end_date\` |

**Note**: Keywords like \`from\`, \`to\`, \`start at\`, \`end at\`, \`on\`, \`until\` indicate temporal boundaries. If incomplete, ask user for clarification.

#### Possible Parameter Combinations
- \`recurrence\`
- \`recurrence\` + \`schedule_start_date\`
- \`recurrence\` + \`schedule_end_date\`
- \`recurrence\` + \`schedule_start_date\` + \`schedule_end_date\`

#### Scheduling Process
1. **Extract parameters**: recurrence pattern, optional start/end dates
2. **Convert**:
   - Recurrence \u2192 cron expression (with user's timezone)
   - \`schedule_start_date\` / \`schedule_end_date\` \u2192 ISO datetime (if present)
3. **Execute** \`schedule_recurring\` tool

---

### 3. Recurring Interval Reminder

#### Detection Patterns
Contains a **time window** (interval) with optional recurrence:

**Basic interval patterns:**
- \`from Monday\`
- \`from HH\`, \`from HH:MM\`, \`from Date\`
- \`from HH:MM to HH:MM every N minutes\`
- \`from HH:MM to HH:MM every N hours\`
- \`from HH to HH daily\`
- \`from Monday to Friday\`

**Extended patterns with schedule boundaries:**
- \`each 5 minutes from HH to HH start at next Friday\`
- \`daily from Monday to Friday end at 23 February\`
- \`each 2 hours from HH to HH start at Thursday end at Saturday\`
- \`each 30 minutes from HH to HH from DD-MM to DD-MM\`

If recurrence is missing end interval with interval_end_date by setting schedule_end_date to interval_end_date

#### Key Rules
- **Interval window** (from X to Y) defines when reminders trigger within each occurrence
- **Schedule window** (start/end dates) defines when the recurring pattern begins/ends
- Interval window <= Schedule window (when both present)
- No recurrence - set schedule_end_date similar as interval_end_date
- User can user single time for both interval_end_date and schedule_end_date in the same query

#### Possible Parameter Combinations
- \`interval_start_date\` + \`interval_end_date\` + \`recurrence\`
- \`interval_start_date\` + \`interval_end_date\` + \`recurrence\` + \`schedule_start_date\`
- \`interval_start_date\` + \`interval_end_date\` + \`recurrence\` + \`schedule_end_date\`
- \`interval_start_date\` + \`interval_end_date\` + \`recurrence\` + \`schedule_start_date\` + \`schedule_end_date\`

#### Scheduling Process
1. **Extract parameters**: interval boundaries, recurrence, optional schedule boundaries
2. **Convert**:
   - Recurrence, interval_start_date, interval_end_date \u2192 cron expression (with user's timezone)
   - \`schedule_start_date\` / \`schedule_end_date\` \u2192 ISO datetime (if present)
3. **Execute** \`schedule_interval\` tool
  `;
function createSystemPrompt(currentISODatetime, userTimezone, reminders) {
  return `
You are a reminder assistant. Your job is to help users schedule reminders.

## Language & Communication
- Speak with the user in the language they use with you
- User communicates with short one liner messages

## Think step by step: what user request is about?
  - Status of reminders or specific reminder?
  - Schedule a reminder?
  - Cancel a reminder?
USER OFTEN TALKS ABOUT REMINDERS IN RECENT CONVERSATION HISTORY CONTEXT

## Context Information

**Current ISO datetime:** ${currentISODatetime}  
**User's timezone:** ${userTimezone}

### Active Reminders
${reminders}

## Core Responsibilities

You must determine if the user wants to:
- **Schedule** a new reminder
- **Cancel** existing reminders
- **Edit** a reminder
- **List** active reminders

## Timezone Handling

**IMPORTANT:** If the user provides a timezone in their message:
1. This timezone takes **priority** over the stored timezone
2. Use the provided timezone to schedule any reminders
3. Call \`set_timezone\` with other tools to update the database

## Interaction Guidelines

### When to Ask Questions
- Only ask questions if **absolutely necessary**
- Never ask about optional tool parameters unless critical
- Calculate times from current ISO datetime and user's timezone by default

### Critical Rules

- **IMPORTANT - Check the conversation history FIRST:**
  - Look at the last message in the conversation
  - If the last message has role "tool", YOU ALREADY CALLED THAT TOOL - use the result to respond to the user
  - DO NOT call the same tool again if you just received results from it
  - Only call a tool if you haven't called it yet for the current user request

- **Listing reminders:**
  - If the last message is a tool result from list_reminders, use that to answer - DO NOT call list_reminders again
  - Only call list_reminders if you haven't called it yet
  - Never use the "Active Reminders" context data to answer

- **To edit reminders:**
  - Create a new reminder
  - Cancel the old one

- **Never repeat the same tool call** for the same reminder
  - If you set reminder once - no need to call the same tool twice
  - No need to cancel twice as well - tools are working from first try

- Tool reponse is a single source of truth!
  - If list reminders returns an empty array - it is always NO remiders NO matter what conversation history shows
  - After the tool result THINK TWICE - if you can respond - do it

- Conversation history must never be used to get factual data
 - Conversation history is only useful to understand abstract user queryies like:
    "cancel it", "change time to 15:00", "I do not need it anymore" etc.
 - NEVER TRUST CONVERSATION HISTORY for reminders status

- While editing reminders - if you see that in tool calls response there are reminder creation called and reminder cancelled - EDIT IS COMPLETE. YOU SATISFIED USER'S REQUEST.

## Available Skills

<available_skills>
  <scheduler_interpreter_skill>
    ${SCHEDULE_SKILL}
  </scheduler_interpreter_skill>
</available_skills>

## Output Format

Use limited markdown subset that is supported by telegram

Markwon that is NOT SUPPORTED:
| Formatting Type | Standard Syntax |
| :--- | :--- | :--- | :--- |
| **Line Break Tag** | \`<br>\` HTML tag 
| **Horizontal Rule** | \`---\`, \`***\`, \`___\` |
| **Headers** | \`# H1\`, \`## H2\`, etc. |
| **Images** | \`![alt](url)\` |
| **Blockquotes** | \`> quote\` |
| **Tables** | Markdown pipe \` | \` syntax |

Provide **ONE** of the following:

### Option 1: Question to User
Ask for clarification when needed

### Option 2: Action Result
Confirm the action with details:

**Action Taken:**
- Set reminder / Edited reminder / Cancelled reminder(s)

**Reminder Details:**
- **Text:** [reminder text]
- **Schedule:** [all dates in format \`DD-MM-YY HH:MM\` in user's timezone and recurrence] `;
}

// src/flows/reminder/tools.ts
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
dayjs.extend(utc);
dayjs.extend(timezone);
var TOOLS = [
  {
    type: "function",
    function: {
      name: "schedule_once",
      description: "Schedule a one-time reminder at a specific date and time",
      parameters: {
        type: "object",
        properties: {
          reminder_text: {
            type: "string",
            description: "What to remind the user about"
          },
          datetime: {
            type: "string",
            description: "ISO 8601 datetime string (e.g., '2026-02-02T15:00:00')"
          }
        },
        required: ["reminder_text", "datetime"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "schedule_recurring",
      description: "Schedule a recurring reminder using cron syntax",
      parameters: {
        type: "object",
        properties: {
          reminder_text: {
            type: "string",
            description: "What to remind the user about"
          },
          cron_expression: {
            type: "string",
            description: "5-field cron expression (minute hour day month weekday). Example: '0 9 * * *' for daily at 9am"
          },
          schedule_start_date: {
            type: "string",
            description: "ISO 8601 end datetime (e.g., '2026-01-30T01:40:00')"
          },
          schedule_end_date: {
            type: "string",
            description: "ISO 8601 end datetime (e.g., '2026-01-30T01:40:00')"
          }
        },
        required: ["reminder_text", "cron_expression"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "schedule_interval",
      description: "Schedule a recurring interval reminder using cron syntax",
      parameters: {
        type: "object",
        properties: {
          reminder_text: {
            type: "string",
            description: "What to remind the user about"
          },
          cron_expression: {
            type: "string",
            description: "5-field cron expression (minute hour day month weekday). Example: '0 9 * * *' for daily at 9am"
          },
          schedule_start_date: {
            type: "string",
            description: "ISO 8601 end datetime (e.g., '2026-01-30T01:40:00')"
          },
          schedule_end_date: {
            type: "string",
            description: "ISO 8601 end datetime (e.g., '2026-01-30T01:40:00')"
          }
        },
        required: ["reminder_text", "cron_expression"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "list_reminders",
      description: "List all active reminders for the user",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "cancel_reminder",
      description: "Cancel/delete a specific reminder by its ID",
      parameters: {
        type: "object",
        properties: {
          reminder_id: {
            type: "string",
            description: "The ID of the reminder to cancel"
          }
        },
        required: ["reminder_id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "cancel_all_reminders",
      description: "Cancel/delete ALL reminders for the user",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "set_timezone",
      description: "Set the user's preferred timezone for all reminders",
      parameters: {
        type: "object",
        properties: {
          timezone: {
            type: "string",
            description: "IANA timezone (e.g., 'Europe/London', 'America/New_York', 'UTC')"
          }
        },
        required: ["timezone"]
      }
    }
  }
];
var toolHandlers = {
  /**
   * Schedule a one-time reminder
   */
  schedule_once: async (app2, context, args) => {
    try {
      const { userId, chatId } = context;
      const userTimezone = await app2.data.storage.getUserTimezone(userId);
      const reminder = await app2.data.storage.saveReminder({
        userId,
        chatId,
        text: args.reminder_text,
        scheduleType: "once",
        scheduleValue: args.datetime,
        timezone: userTimezone
      });
      await app2.services.scheduler.scheduleReminder(reminder);
      return { status: "success", reminder };
    } catch (error) {
      console.error("[schedule_once] Error:", error);
      return { status: "error", error: error?.message };
    }
  },
  /**
   * Schedule a recurring reminder using cron syntax
   */
  schedule_recurring: async (app2, context, args) => {
    try {
      const { userId, chatId } = context;
      const userTimezone = await app2.data.storage.getUserTimezone(userId);
      let startDate;
      let endDate;
      if (args.schedule_start_date) {
        startDate = new Date(args.schedule_start_date);
      }
      if (args.schedule_end_date) {
        endDate = new Date(args.schedule_end_date);
      }
      const reminder = await app2.data.storage.saveReminder({
        userId,
        chatId,
        text: args.reminder_text,
        scheduleType: "cron",
        scheduleValue: args.cron_expression,
        startDate,
        endDate,
        timezone: userTimezone
      });
      await app2.services.scheduler.scheduleReminder(reminder);
      return { status: "success", reminder };
    } catch (error) {
      console.error("[schedule_recurring] Error:", error);
      return { status: "error", error: error?.message };
    }
  },
  /**
   * Schedule an interval reminder (similar to recurring)
   */
  schedule_interval: async (app2, context, args) => {
    return toolHandlers.schedule_recurring(app2, context, args);
  },
  /**
   * List all active reminders for the user
   */
  list_reminders: async (app2, context, _args) => {
    try {
      const { userId } = context;
      const reminders = await app2.data.storage.getReminders(userId);
      return { status: "success", reminders };
    } catch (error) {
      console.error("[list_reminders] Error:", error);
      return { status: "error", error: error?.message };
    }
  },
  /**
   * Cancel a specific reminder by ID
   */
  cancel_reminder: async (app2, context, args) => {
    try {
      const { userId } = context;
      const reminder = await app2.data.storage.getReminderForUser(args.reminder_id, userId);
      if (!reminder) {
        return { status: "success" };
      }
      await app2.services.scheduler.removeJob(reminder.id);
      await app2.data.storage.deleteReminder(reminder.id);
      return { status: "success" };
    } catch (error) {
      console.error("[cancel_reminder] Error:", error);
      return { status: "error", error: error?.message };
    }
  },
  /**
   * Cancel all reminders for the user
   */
  cancel_all_reminders: async (app2, context, _args) => {
    try {
      const { userId } = context;
      const reminders = await app2.data.storage.getReminders(userId);
      if (reminders.length === 0) {
        return { status: "success" };
      }
      for (const reminder of reminders) {
        await app2.services.scheduler.removeJob(reminder.id);
        await app2.data.storage.deleteReminder(reminder.id);
      }
      return { status: "success" };
    } catch (error) {
      console.error("[cancel_all_reminders] Error:", error);
      return { status: "error", error: error?.message };
    }
  },
  /**
   * Set the user's preferred timezone
   */
  set_timezone: async (app2, context, args) => {
    try {
      const { userId } = context;
      const testDate = dayjs.tz(/* @__PURE__ */ new Date(), args.timezone);
      if (!testDate.isValid()) {
        return { status: "error", error: "Invalid timezone" };
      }
      await app2.data.storage.setUserTimezone(userId, args.timezone);
      return { status: "success" };
    } catch (error) {
      console.error("[set_timezone] Error:", error);
      return { status: "error", error: error?.message };
    }
  }
};
function createToolHandler(name) {
  const handler = toolHandlers[name];
  if (!handler) {
    throw new Error(`Unknown tool: ${name}`);
  }
  return async (app2, context, args) => {
    const res = await handler(app2, context, args);
    return JSON.stringify(res);
  };
}

// src/flows/reminder/nodes.ts
var PrepareInput = class extends Node {
  async prep(shared) {
    const { userId, message: message2 } = shared.context;
    console.log(`[PrepareInput.prep] Adding user message to history: "${message2}"`);
    const newMessage = {
      role: "user",
      content: message2
    };
    shared.app.data.messageHistory.addMessage(userId, newMessage);
    return { userId, message: message2 };
  }
  async exec(_prepRes) {
    return "done";
  }
  async post(_shared, _prepRes, execRes) {
    return void 0;
  }
};
var DecideAction = class extends Node {
  constructor() {
    super(3, 1);
  }
  async prep(shared) {
    const { userId } = shared.context;
    const { data } = shared.app;
    const userReminders = await data.storage.getReminders(userId);
    const timezone2 = await data.storage.getUserTimezone(userId);
    console.log(`[DecideAction.prep] Found ${userReminders.length} reminders, timezone: ${timezone2}`);
    const conversation = data.messageHistory.getConversation(userId);
    return {
      timezone: timezone2,
      currentDate: (/* @__PURE__ */ new Date()).toISOString(),
      conversation,
      userReminders: JSON.stringify(userReminders)
    };
  }
  async exec(prepRes) {
    const { timezone: timezone2, currentDate, conversation, userReminders } = prepRes;
    const systemPrompt = createSystemPrompt(currentDate, timezone2, userReminders);
    const messages = [{ role: "system", content: systemPrompt }, ...conversation];
    console.log(
      `[DecideAction.exec] Calling LLM with ${messages.length} messages (user_tz: ${timezone2}, ${userReminders.length} reminders)`
    );
    console.log(conversation);
    const response = await callLlmWithTools(messages, TOOLS);
    console.log(`[DecideAction.exec] LLM response:`, JSON.stringify(response[0].message, null, 2));
    return response[0].message;
  }
  async post(shared, _prepRes, execRes) {
    shared.app.data.messageHistory.addMessage(shared.context.userId, execRes);
    const toolCalls = execRes.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      const { content, refusal } = execRes;
      let output = "";
      if (content) output = `${output}${content}`;
      if (refusal) output = `${output}
${refusal}`;
      if (!output) output = `AI is broken try again later`;
      console.log(`[DecideAction.post] Setting response to: "${output}"`);
      shared.context.response = output;
      return "ask_user";
    } else {
      console.log(`[DecideAction.post] Processing ${toolCalls.length} tool calls`);
      shared.context.toolCalls = toolCalls;
      return "tool_calls";
    }
  }
  async execFallback(_prepRes, error) {
    console.error("[DecideAction.error] ", error);
    return { role: "assistant", content: "AI is broken try again later", refusal: null };
  }
};
var AskUser = class extends Node {
  async prep(shared) {
    const { app: app2 } = shared;
    const { response, chatId } = shared.context;
    console.log(`[AskUser.prep] chatId: ${chatId}, response: "${response}"`);
    return { app: app2, output: response, chatId };
  }
  async exec({ app: app2, output, chatId }) {
    console.log(`[AskUser.exec] Sending message to chatId: ${chatId}, output: "${output}"`);
    app2.infra.bus.emit("telegram.sendMessage", { chatId, message: output });
    return "sent";
  }
  async post(shared, _prepRes, execRes) {
    console.log(`[AskUser.post] execRes: ${execRes}`);
    return void 0;
  }
};
var ToolCalls = class extends ParallelBatchNode {
  async prep(shared) {
    const { toolCalls, userId, chatId } = shared.context;
    console.log(`[ToolCalls.prep] Processing ${toolCalls.length} tool calls for userId: ${userId}, chatId: ${chatId}`);
    toolCalls.forEach((tc, idx) => {
      console.log(`[ToolCalls.prep] Tool ${idx}: ${tc.function.name}, args: ${tc.function.arguments}`);
    });
    return toolCalls.map((tc) => ({ tc, app: shared.app, userId, chatId }));
  }
  async exec({ tc, app: app2, userId, chatId }) {
    const args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
    const { name } = tc.function;
    const handler = createToolHandler(name);
    const content = await handler(app2, { userId, chatId }, args);
    console.log(`[ToolCalls.exec] Tool ${name} returned: "${content}"`);
    return { role: "tool", content, tool_call_id: tc.id };
  }
  async post(shared, _prepRes, execRes) {
    console.log(`[ToolCalls.post] Adding ${execRes.length} tool result messages to history`);
    shared.app.data.messageHistory.addMessages(shared.context.userId, execRes);
    return void 0;
  }
};

// src/flows/reminder/flow.ts
function createReminderFlow() {
  const prepareInput = new PrepareInput();
  const decideAction = new DecideAction();
  const askUser = new AskUser();
  const toolCalls = new ToolCalls();
  prepareInput.next(decideAction);
  decideAction.on("ask_user", askUser);
  decideAction.on("tool_calls", toolCalls);
  toolCalls.next(decideAction);
  return new Flow(prepareInput);
}

// src/flows/index.ts
var Flows = class {
  createReminderFlow;
  cache;
  constructor(app2) {
    this.createReminderFlow = createReminderFlow;
    this.cache = {};
  }
};

// src/infra/bus.ts
import { EventEmitter } from "events";
var Bus = class extends EventEmitter {
  constructor() {
    super();
  }
  start = async () => {
  };
  stop = async () => {
  };
};

// src/infra/index.ts
var Infra = class {
  bus;
  constructor(app2) {
    this.bus = new Bus();
  }
  async start() {
  }
  async stop() {
  }
};

// src/services/scheduler.ts
import { Agenda } from "agenda";
import { PostgresBackend } from "@agendajs/postgres-backend";
import dayjs2 from "dayjs";
import utc2 from "dayjs/plugin/utc.js";
dayjs2.extend(utc2);
var Scheduler = class {
  agenda;
  app;
  constructor(app2, { connectionString }) {
    const backend = new PostgresBackend({
      connectionString
    });
    this.app = app2;
    this.agenda = new Agenda({
      backend,
      processEvery: "30 seconds",
      maxConcurrency: 20
    });
    console.log("[Scheduler] Initialized with Postgres backend");
  }
  /**
   * Start the scheduler
   */
  async start() {
    console.log("[Scheduler.start] Starting Agenda scheduler...");
    await this.agenda.start();
    await this.restoreJobs();
    console.log("[Scheduler] Started successfully");
  }
  /**
   * Stop the scheduler gracefully
   */
  async stop() {
    await this.agenda.stop();
    console.log("[Scheduler] Stopped");
  }
  /**
   * Schedule a one-time reminder
   */
  async scheduleOnce(params) {
    const parsedDate = dayjs2.utc(params.runDate).toDate();
    this.agenda.define(params.jobId, params.callback);
    await this.agenda.schedule(parsedDate, params.jobId, params.callbackData);
    console.log(`[Scheduler] Scheduled one-time job '${params.jobId}' for ${parsedDate.toISOString()} UTC`);
  }
  /**
   * Schedule a recurring reminder using cron expression
   */
  async scheduleCron(params) {
    const cronParts = params.cronExpression.trim().split(/\s+/);
    if (cronParts.length !== 5) {
      throw new Error(`Invalid cron expression: expected 5 fields, got ${cronParts.length}`);
    }
    const agendaCron = `0 ${params.cronExpression}`;
    this.agenda.define(params.jobId, params.callback);
    const job = this.agenda.create(params.jobId, params.callbackData);
    const timezone2 = params.timezone || "UTC";
    job.repeatEvery(agendaCron, {
      timezone: timezone2,
      skipImmediate: true
    });
    if (params.startDate) {
      const parsedStartDate = dayjs2.utc(params.startDate).toDate();
      job.startDate(parsedStartDate);
    }
    if (params.endDate) {
      const parsedEndDate = dayjs2.utc(params.endDate).toDate();
      job.endDate(parsedEndDate);
    }
    await job.save();
    const endInfo = params.endDate ? ` (ends: ${params.endDate})` : "";
    console.log(
      `[Scheduler] Scheduled cron job '${params.jobId}' with expression '${params.cronExpression}' in timezone ${timezone2}${endInfo}`
    );
  }
  /**
   * Callback function that executes when a reminder fires
   */
  async onReminderFire(job) {
    const { chatId, text, reminderId, scheduleType } = job.attrs.data;
    console.log(`[ReminderFire] Sending reminder ${reminderId} to chat ${chatId}`);
    try {
      this.app.infra.bus.emit("telegram.sendMessage", { chatId, message: `\u23F0 Reminder: ${text}` });
      if (scheduleType === "once") {
        await this.app.data.storage.deleteReminder(reminderId);
      }
    } catch (error) {
      console.error(`[ReminderFire] Error sending reminder ${reminderId}:`, error);
    }
  }
  /**
   * Schedule a reminder from a Reminder object
   */
  async scheduleReminder(reminder) {
    const callbackData = {
      chatId: reminder.chatId,
      text: reminder.text,
      reminderId: reminder.id,
      scheduleType: reminder.scheduleType
    };
    const callback = (job) => this.onReminderFire(job);
    try {
      if (reminder.scheduleType === "once") {
        await this.scheduleOnce({
          jobId: reminder.id,
          runDate: reminder.scheduleValue,
          callback,
          callbackData
        });
      } else if (reminder.scheduleType === "cron") {
        await this.scheduleCron({
          jobId: reminder.id,
          cronExpression: reminder.scheduleValue,
          callback,
          startDate: reminder.startDate ? reminder.startDate.toISOString() : void 0,
          endDate: reminder.endDate ? reminder.endDate.toISOString() : void 0,
          timezone: reminder.timezone,
          callbackData
        });
      } else {
        console.error(`[Scheduler.scheduleReminder] Unknown schedule type: ${reminder.scheduleType}`);
        throw new Error(`Unknown schedule type: ${reminder.scheduleType}`);
      }
    } catch (error) {
      console.error(`[Scheduler.scheduleReminder] Error:`, error);
      throw error;
    }
  }
  /**
   * Restore all active reminders from storage
   */
  async restoreJobs() {
    console.log(`[Scheduler.restoreJobs] Starting job restoration process...`);
    const reminders = await this.app.data.storage.getAllReminders();
    if (reminders.length === 0) {
      console.log(`[Scheduler.restoreJobs] No reminders to restore`);
      return;
    }
    let successCount = 0;
    let failureCount = 0;
    for (const r of reminders) {
      try {
        await this.scheduleReminder(r);
        successCount++;
      } catch (error) {
        failureCount++;
        console.error(`[Scheduler.restoreJobs] \u2717 Failed to restore reminder ${r.id}:`, error);
      }
    }
    console.log(`[Scheduler.restoreJobs] Restoration complete: ${successCount} succeeded, ${failureCount} failed`);
  }
  /**
   * Remove a scheduled job by ID
   */
  async removeJob(jobId) {
    try {
      const removed = await this.agenda.cancel({ name: jobId });
      if (removed > 0) {
        console.log(`[Scheduler] Removed job '${jobId}'`);
        return true;
      } else {
        return false;
      }
    } catch (error) {
      console.error(`[Scheduler.removeJob] Error removing job '${jobId}':`, error);
      return false;
    }
  }
  /**
   * Get the Agenda instance for advanced operations
   */
  getAgenda() {
    return this.agenda;
  }
};

// src/services/telegram.ts
import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
var TelegramService = class {
  bot;
  app;
  constructor(app2, { token }) {
    this.app = app2;
    this.bot = new Telegraf(token);
    this.bot.command("start", this.startCommand.bind(this));
    this.bot.command("help", this.helpCommand.bind(this));
    this.bot.on(message("text"), this.handleMessage.bind(this));
  }
  /**
   * Start the Telegram bot service
   */
  async start() {
    console.log("[Telegram] Starting bot...");
    this.bot.launch(() => {
      console.log("[Telegram] Bot launched!");
    }).catch((error) => console.error("[Telegram] Error launching bot:", error));
    this.app.infra.bus.on("telegram.sendMessage", async (data) => {
      console.log(`[Telegram] Sending message to chat ${data.chatId}: ${data.message}`);
      await this.sendMessage(data.chatId, data.message).catch((error) => {
        console.error(`[Telegram] Failed to send message to chat ${data.chatId}:`, error);
      });
    });
  }
  /**
   * Stop the Telegram bot service
   */
  async stop() {
    console.log("[Telegram] Stopping bot...");
    this.bot.stop();
  }
  /**
   * Send a message to a user/chat
   */
  async sendMessage(chatId, message2) {
    try {
      await this.bot.telegram.sendMessage(parseInt(chatId), message2, {
        parse_mode: "Markdown"
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
  async handleMessage(ctx) {
    if (!ctx.message || !("text" in ctx.message)) return;
    const userId = ctx.from.id.toString();
    const chatId = ctx.chat.id.toString();
    const message2 = ctx.message.text;
    console.log(`
[Bot] Message from ${userId}: ${message2}`);
    const flow = this.app.flows.createReminderFlow();
    const context = { userId, message: message2, chatId };
    const sharedStore = { app: this.app, context };
    try {
      await flow.run(sharedStore);
    } catch (error) {
      console.error("[Bot] Error:", error);
      await ctx.reply(`\u274C Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  async startCommand(ctx) {
    const welcome = `\u{1F44B} Hi! I'm your reminder assistant.

I can help you:
\u2022 Schedule one-time reminders
\u2022 Set up recurring reminders
\u2022 List your active reminders
\u2022 Cancel reminders

Just tell me what you want to be reminded about!`;
    await ctx.reply(welcome);
  }
  async helpCommand(ctx) {
    const helpText = `\u{1F4D6} How to use:

One-time reminders:
- "Remind me to [task] at [time]"

Recurring reminders:
- "Remind me to [task] every day at [time]"

Manage reminders:
- "Show my reminders"
- "Cancel reminder [ID]"`;
    await ctx.reply(helpText);
  }
};

// src/config/services.ts
if (!process.env.DATABASE_URL) {
  throw new Error("Env DATABASE_URL is not defined");
}
if (!process.env.TELEGRAM_BOT_TOKEN) {
  throw new Error("Env TELEGRAM_BOT_TOKEN is not defined");
}
var services_default = {
  Scheduler: { connectionString: process.env.DATABASE_URL },
  Telegram: { token: process.env.TELEGRAM_BOT_TOKEN }
};

// src/services/index.ts
var Services = class {
  scheduler;
  telegram;
  constructor(app2) {
    this.scheduler = new Scheduler(app2, services_default.Scheduler);
    this.telegram = new TelegramService(app2, services_default.Telegram);
  }
  async start() {
    return Promise.all([this.scheduler.start(), this.telegram.start()]);
  }
  async stop() {
    return Promise.all([this.scheduler.stop(), this.telegram.stop()]);
  }
};

// src/app.ts
var App = class {
  services;
  infra;
  data;
  flows;
  constructor() {
    this.services = new Services(this);
    this.infra = new Infra(this);
    this.data = new Data(this);
    this.flows = new Flows(this);
  }
  async start() {
    return Promise.all([this.services.start(), this.infra.start(), this.data.start()]);
  }
  async stop() {
    return Promise.all([this.services.stop(), this.infra.stop(), this.data.stop()]);
  }
};

// src/index.ts
var app = new App();
async function main() {
  await app.start();
  const shutdown = async (signal) => {
    console.log(`[Bot] ${signal} received, shutting down...`);
    await app.stop();
    process.exit(0);
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}
main().catch((error) => {
  console.error("[Bot] Fatal error:", error);
  process.exit(1);
});
//# sourceMappingURL=index.js.map