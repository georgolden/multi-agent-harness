var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/services/storage.ts
var storage_exports = {};
__export(storage_exports, {
  closeStorage: () => closeStorage,
  deleteReminder: () => deleteReminder,
  generateReminderId: () => generateReminderId,
  getAllReminders: () => getAllReminders,
  getReminder: () => getReminder,
  getReminderForUser: () => getReminderForUser,
  getReminders: () => getReminders,
  getUserTimezone: () => getUserTimezone,
  initStorage: () => initStorage,
  saveReminder: () => saveReminder,
  setUserTimezone: () => setUserTimezone
});
import { Pool } from "pg";
import { randomBytes } from "crypto";
async function initStorage(connectionString) {
  pool = new Pool({ connectionString });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reminders (
      id VARCHAR(16) PRIMARY KEY,
      user_id VARCHAR(255) NOT NULL,
      chat_id VARCHAR(255) NOT NULL,
      text TEXT NOT NULL,
      schedule_type VARCHAR(10) NOT NULL CHECK (schedule_type IN ('once', 'cron')),
      schedule_value TEXT NOT NULL,
      timezone VARCHAR(50) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      active BOOLEAN NOT NULL DEFAULT TRUE
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(255) PRIMARY KEY,
      timezone VARCHAR(50) NOT NULL DEFAULT 'UTC'
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_reminders_user_active
    ON reminders(user_id, active)
  `);
  console.log("[Storage] Initialized with Postgres");
}
async function closeStorage() {
  if (pool) {
    await pool.end();
    pool = null;
    console.log("[Storage] Connection closed");
  }
}
function getPool() {
  if (!pool) {
    throw new Error("Storage not initialized. Call initStorage() first.");
  }
  return pool;
}
function generateReminderId() {
  return randomBytes(4).toString("hex");
}
async function saveReminder(params) {
  const db = getPool();
  const id = params.reminderId || generateReminderId();
  const result = await db.query(
    `INSERT INTO reminders (id, user_id, chat_id, text, schedule_type, schedule_value, timezone)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      id,
      params.userId,
      params.chatId,
      params.text,
      params.scheduleType,
      params.scheduleValue,
      params.timezone
    ]
  );
  const reminder = result.rows[0];
  console.log(`[Storage] Saved reminder '${id}': ${params.text.slice(0, 50)}...`);
  return reminder;
}
async function getReminders(userId) {
  const db = getPool();
  const result = await db.query(
    `SELECT * FROM reminders
     WHERE user_id = $1 AND active = TRUE
     ORDER BY created_at DESC`,
    [userId]
  );
  return result.rows;
}
async function getReminder(reminderId) {
  const db = getPool();
  const result = await db.query("SELECT * FROM reminders WHERE id = $1", [reminderId]);
  return result.rows[0] || null;
}
async function getReminderForUser(reminderId, userId) {
  const db = getPool();
  const result = await db.query(
    `SELECT * FROM reminders
     WHERE id = $1 AND user_id = $2 AND active = TRUE`,
    [reminderId, userId]
  );
  return result.rows[0] || null;
}
async function getAllReminders() {
  const db = getPool();
  const result = await db.query("SELECT * FROM reminders WHERE active = TRUE");
  return result.rows;
}
async function deleteReminder(reminderId) {
  const db = getPool();
  const result = await db.query(
    "UPDATE reminders SET active = FALSE WHERE id = $1 RETURNING id",
    [reminderId]
  );
  if (result.rowCount === 0) {
    console.log(`[Storage] Reminder '${reminderId}' not found`);
    return false;
  }
  console.log(`[Storage] Deleted reminder '${reminderId}'`);
  return true;
}
async function getUserTimezone(userId) {
  const db = getPool();
  const result = await db.query("SELECT timezone FROM users WHERE id = $1", [userId]);
  if (result.rows.length === 0) {
    await db.query("INSERT INTO users (id, timezone) VALUES ($1, $2)", [userId, "UTC"]);
    return "UTC";
  }
  return result.rows[0].timezone;
}
async function setUserTimezone(userId, timezone) {
  const db = getPool();
  await db.query(
    `INSERT INTO users (id, timezone) VALUES ($1, $2)
     ON CONFLICT (id) DO UPDATE SET timezone = $2`,
    [userId, timezone]
  );
  console.log(`[Storage] Set timezone for user ${userId}: ${timezone}`);
}
var pool;
var init_storage = __esm({
  "src/services/storage.ts"() {
    "use strict";
    pool = null;
  }
});

// src/index.ts
import "dotenv/config";
import { Telegraf } from "telegraf";

// src/flow.ts
import { Flow } from "pocketflow";

// src/nodes.ts
init_storage();
import { Node } from "pocketflow";
import { format } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

// src/services/scheduler.ts
import { Agenda } from "agenda";
import { PostgresBackend } from "@agendajs/postgres-backend";
import { parseISO } from "date-fns";
import { toZonedTime } from "date-fns-tz";
var agenda = null;
async function initScheduler(connectionString) {
  const backend = new PostgresBackend({
    connectionString
  });
  agenda = new Agenda({
    backend,
    processEvery: "30 seconds",
    maxConcurrency: 20
  });
  console.log("[Scheduler] Initialized with Postgres backend");
  await agenda.start();
  console.log("[Scheduler] Started");
}
async function stopScheduler() {
  if (agenda) {
    await agenda.stop();
    agenda = null;
    console.log("[Scheduler] Stopped");
  }
}
function getScheduler() {
  if (!agenda) {
    throw new Error("Scheduler not initialized. Call initScheduler() first.");
  }
  return agenda;
}
async function scheduleOnce(params) {
  const scheduler = getScheduler();
  const parsedDate = typeof params.runDate === "string" ? parseISO(params.runDate) : params.runDate;
  const zonedDate = toZonedTime(parsedDate, params.timezone);
  scheduler.define(params.jobId, params.callback);
  await scheduler.schedule(parsedDate, params.jobId, params.callbackData);
  console.log(`[Scheduler] Scheduled one-time job '${params.jobId}' for ${zonedDate} ${params.timezone}`);
}
async function scheduleCron(params) {
  const scheduler = getScheduler();
  const cronParts = params.cronExpression.trim().split(/\s+/);
  if (cronParts.length !== 5) {
    throw new Error(`Invalid cron expression: expected 5 fields, got ${cronParts.length}`);
  }
  const agendaCron = `0 ${params.cronExpression}`;
  scheduler.define(params.jobId, params.callback);
  const job = scheduler.create(params.jobId, params.callbackData);
  job.repeatEvery(agendaCron, {
    timezone: params.timezone,
    skipImmediate: true
  });
  if (params.endDate) {
    const parsedEndDate = typeof params.endDate === "string" ? parseISO(params.endDate) : params.endDate;
    job.endDate(parsedEndDate);
  }
  await job.save();
  const endInfo = params.endDate ? ` (ends: ${params.endDate})` : "";
  console.log(`[Scheduler] Scheduled cron job '${params.jobId}' with expression '${params.cronExpression}' (tz: ${params.timezone})${endInfo}`);
}
async function removeJob(jobId) {
  const scheduler = getScheduler();
  const removed = await scheduler.cancel({ name: jobId });
  if (removed > 0) {
    console.log(`[Scheduler] Removed job '${jobId}'`);
    return true;
  } else {
    console.log(`[Scheduler] Job '${jobId}' not found`);
    return false;
  }
}
function getAgenda() {
  return getScheduler();
}

// src/utils/callLlm.ts
import { OpenAI } from "openai";
async function callLlmWithTools(messages, tools) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY environment variable not set");
  }
  const client = new OpenAI({
    apiKey,
    baseURL: "https://api.deepseek.com",
    timeout: 6e4
  });
  const response = await client.chat.completions.create({
    model: "deepseek-chat",
    messages,
    tools,
    tool_choice: "auto",
    temperature: 0.3
  });
  const message = response.choices[0].message;
  return {
    role: message.role,
    content: message.content,
    tool_calls: message.tool_calls
  };
}

// src/utils/validation.ts
import { parseISO as parseISO2, isValid } from "date-fns";
function validateTimezone(timezone) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return null;
  } catch {
    return `Invalid timezone: ${timezone}`;
  }
}
function parseIsoDatetime(dateStr) {
  try {
    const date = parseISO2(dateStr.replace("Z", "+00:00"));
    if (!isValid(date)) {
      return { date: null, error: `Invalid datetime: ${dateStr}` };
    }
    return { date, error: null };
  } catch {
    return { date: null, error: `Invalid datetime: ${dateStr}` };
  }
}
function validateCronExpression(expr) {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    return `Invalid cron expression: expected 5 fields, got ${parts.length}`;
  }
  for (const part of parts) {
    if (!/^[\d*/,\-]+$/.test(part)) {
      return `Invalid cron expression part: ${part}`;
    }
  }
  return null;
}

// src/prompts.ts
function createSystemPrompt(currentDatetime, userTimezone, remindersContext) {
  return `You are a reminder assistant. Your job is to help users schedule reminders.

Current date and time: ${currentDatetime}
User's timezone: ${userTimezone}

CRITICAL INSTRUCTIONS:
1. Analyze the user's request to understand what they want to be reminded about and when.
2. **SCHEDULE IMMEDIATELY if you have enough info** - don't ask unnecessary questions!
3. For one-time reminders, use schedule_once with an ISO datetime and timezone.
4. Use schedule_cron only when a recurrence is explicitly specified (e.g., "every day", "daily", "weekly").
5. If recurrence is NOT specified but a time window with interval is given (e.g., "every 5 minutes from 1pm to 2pm today"), use schedule_cron_finite with end_datetime_iso + timezone.
6. If user wants to see their reminders, use list_reminders.
7. If user wants to cancel a reminder, use cancel_reminder with the reminder ID.
8. If user wants to cancel all reminders, use cancel_all_reminders.
9. If user wants to change/update an existing reminder, use edit_reminder with reminder_id + reminder_name + new_reminder_name + new_query. If no new name is provided, use the old name as new_reminder_name. new_query must include the reminder name and schedule.
10. If user wants to set timezone explicitly, use set_timezone (otherwise always use stored timezone: ${userTimezone}).

SMART DEFAULTS (DON'T ASK - JUST USE):
- "immediately" / "now" / "right now" \u2192 use current time + 1 minute
- "every minute" \u2192 cron: "* * * * *"
- "every hour" \u2192 cron: "0 * * * *"
- "every day at X" \u2192 cron with that hour
- "tomorrow" \u2192 next day at the specified time (or 9:00 AM if no time given)
- No timezone specified \u2192 use user's timezone (${userTimezone})
- For finite recurring schedules (with an end time/date), use schedule_cron_finite with end_datetime_iso.
- If user specifies a time WINDOW with interval (e.g., "from 01:00 to 01:30 every 5 minutes") and does NOT specify daily/weekly recurrence, always use schedule_cron_finite. end_datetime_iso = window end today unless a different end date is specified.

PARAMETERS TO EXTRACT (WHEN PRESENT):
- reminder_text: What to remind about
- interval_minutes: e.g., every 5 minutes
- window_start_time: e.g., 00:40
- window_end_time: e.g., 01:40
- recurrence: daily / weekly / weekdays / specific days
- start_date: if specified
- end_date: if specified OR duration_days (e.g., "for 2 days")
- timezone: always from stored user data (${userTimezone}), not user input

CONVERTING TO CRON:
- interval_minutes \u2192 minute field ("*/N")
- window time range \u2192 hour field ("H1-H2")
- recurrence:
  - daily \u2192 day/month/dow = "*"
  - weekdays \u2192 dow = "1-5"
  - specific days \u2192 dow list (e.g., "1,3,5")
- Use schedule_cron_finite when a finite end is required (end_datetime_iso).
- If a window end is specified and no other end date is given, use the window end as the end_datetime_iso for that day.

TIME WINDOWS / INTERVALS (IMPORTANT):
If user specifies a recurring *window* like "from 00:40 to 01:40 every 5 minutes":
- Use cron to target BOTH minute interval and hour range.
- Example: "every 5 minutes from 00:40 to 01:40 daily" \u2192 cron "*/5 0-1 * * *"
- Example: "from 02:05 to 02:20 every 1 minute for 2 days" \u2192 cron "*/1 2 * * *" with end_datetime_iso at day+2 02:20.
- Example: "from 01:00 to 01:30 every 1 minute today" \u2192 schedule_cron_finite with end_datetime_iso at 01:30 today.
- If a START time is given, use that start time even if it is in the past (do not shift to next day unless user asks).
- If user says "start immediately", schedule should run from now until end of window today, then resume in next window(s) if a multi-day duration is given.
- The window end time is the end of EACH daily window.
- If recurrence is NOT specified, the window end time is also the overall end for today.

END DATE / DURATION FOR WINDOWS:
- "for 2 days" \u2192 compute end_datetime_iso = start_date + 2 days at the WINDOW END time.
- Use schedule_cron_finite with end_datetime_iso (total schedule length across days).
- The window end time is the end of each daily window; for non-recurring windows it is also the overall end.
- Do NOT set end_datetime_iso to the current time or the next minute.
- If window end (e.g., 01:40) is not aligned with the interval, include the reminder at the end time.

CRON EXPRESSION FORMAT (5 fields):
- minute (0-59)
- hour (0-23)
- day of month (1-31)
- month (1-12)
- day of week (0-6, 0=Sunday)

Examples:
- "* * * * *" = every minute
- "0 9 * * *" = every day at 9:00 AM
- "30 14 * * 1-5" = weekdays at 2:30 PM
- "*/5 * * * *" = every 5 minutes

EDITING REMINDERS:
Use edit_reminder for ANY modification to an existing reminder:
- "move to X" / "reschedule to X" / "reset to X" / "change to X"
- "make it X instead" / "shift to X" / "update to X"
- If user mentions the reminder NAME/TEXT and does NOT say cancel/delete, treat it as an edit request.
- Provide reminder_id + reminder_name + new_reminder_name + new_query (new_query must include all details needed to schedule the new reminder).
- edit_reminder cancels old reminder and re-runs scheduling.

RESOLVING "WHICH REMINDER":
Look at USER'S ACTIVE REMINDERS below to find the ID:
- If user mentions reminder TEXT/NAME, match by text (case-insensitive).
- "the reminder" / "it" / "this" / "that" \u2192 the one from context or conversation
- "current" / "my reminder" \u2192 if ONE exists, that's it
- "last" / "just set" \u2192 most recent by created_at
- Single reminder + vague reference \u2192 assume that one, don't ask

CANCEL SHORTCUTS:
- "cancel/delete/stop it" + one reminder \u2192 cancel that one
- "cancel all" \u2192 cancel_all_reminders
- Never ask "which one" if only one exists

ONLY ASK QUESTIONS WHEN:
- You genuinely cannot determine WHAT to remind about
- The time is completely ambiguous (e.g., "remind me later" with no context)

DO NOT ASK ABOUT:
- Timezone (use default: ${userTimezone})
- "When should it start?" if user said "immediately" or "now"
- Confirmation of details you can reasonably infer
- Which reminder to cancel if user just says "cancel" without ID - use cancel_all

You MUST call a tool - never respond without using a tool.

${remindersContext}`;
}

// src/tools.ts
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
          datetime_iso: {
            type: "string",
            description: "ISO 8601 datetime string (e.g., '2026-02-02T15:00:00')"
          },
          timezone: {
            type: "string",
            description: "IANA timezone (use user's stored timezone)"
          }
        },
        required: ["reminder_text", "datetime_iso", "timezone"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "schedule_cron",
      description: "Schedule a recurring reminder using cron syntax (no end date)",
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
          timezone: {
            type: "string",
            description: "IANA timezone (use user's stored timezone)"
          }
        },
        required: ["reminder_text", "cron_expression", "timezone"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "schedule_cron_finite",
      description: "Schedule a recurring reminder using cron syntax with a required end datetime",
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
          end_datetime_iso: {
            type: "string",
            description: "ISO 8601 end datetime (e.g., '2026-01-30T01:40:00')"
          },
          timezone: {
            type: "string",
            description: "IANA timezone (use user's stored timezone)"
          }
        },
        required: ["reminder_text", "cron_expression", "end_datetime_iso", "timezone"]
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
      name: "edit_reminder",
      description: "Edit an existing reminder by ID. Cancel old reminder, then schedule a new one from natural language.",
      parameters: {
        type: "object",
        properties: {
          reminder_id: {
            type: "string",
            description: "Existing reminder ID to edit"
          },
          reminder_name: {
            type: "string",
            description: "Existing reminder name/text (for verification)"
          },
          new_reminder_name: {
            type: "string",
            description: "New reminder name/text (use same as existing if unchanged)"
          },
          new_query: {
            type: "string",
            description: "Natural language description of the updated reminder (must include new reminder name and schedule)"
          },
          timezone: {
            type: "string",
            description: "IANA timezone (use user's stored timezone)"
          }
        },
        required: ["reminder_id", "reminder_name", "new_reminder_name", "new_query", "timezone"]
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
      name: "ask_user",
      description: "Ask the user for missing information - USE SPARINGLY, only when absolutely necessary",
      parameters: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description: "The question to ask the user"
          }
        },
        required: ["question"]
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

// src/nodes.ts
var MAX_CONTEXT_MESSAGES = 20;
var ParseInput = class extends Node {
  async prep(shared) {
    return {
      userId: shared.userId,
      chatId: shared.chatId,
      message: shared.message,
      conversation: shared.conversation || []
    };
  }
  async exec(inputs) {
    return inputs;
  }
  async post(shared, _prepRes, execRes) {
    shared.originalMessage = execRes.message;
    shared.conversation = execRes.conversation || [];
    console.log(
      `[ParseInput] User ${execRes.userId}: ${execRes.message} (conversation: ${shared.conversation.length} msgs)`
    );
    return "default";
  }
};
var DecideAction = class extends Node {
  constructor() {
    super(3, 1);
  }
  async prep(shared) {
    const userReminders = await getReminders(shared.userId);
    return {
      originalMessage: shared.originalMessage,
      conversation: shared.conversation,
      userId: shared.userId,
      userReminders
    };
  }
  formatReminderForContext(r) {
    if (r.scheduleType === "cron") {
      let cronExpr = r.scheduleValue;
      if (cronExpr.includes("|ends:")) {
        cronExpr = cronExpr.split("|ends:")[0];
      }
      return `- [${r.id}] "${r.text}" (recurring: ${cronExpr})`;
    } else {
      return `- [${r.id}] "${r.text}" (at ${r.scheduleValue})`;
    }
  }
  async exec(inputs) {
    const userTz = await getUserTimezone(inputs.userId);
    const currentDt = formatInTimeZone(/* @__PURE__ */ new Date(), userTz, "yyyy-MM-dd HH:mm:ss zzz");
    const userReminders = inputs.userReminders;
    let remindersContext = "";
    if (userReminders.length > 0) {
      remindersContext = "\n\nUSER'S ACTIVE REMINDERS:\n" + userReminders.map((r) => this.formatReminderForContext(r)).join("\n");
    } else {
      remindersContext = "\n\nUSER'S ACTIVE REMINDERS: None";
    }
    const systemPrompt = createSystemPrompt(currentDt, userTz, remindersContext);
    const messages = [{ role: "system", content: systemPrompt }];
    const conversation = inputs.conversation.slice(-MAX_CONTEXT_MESSAGES);
    for (const msg of conversation) {
      messages.push(msg);
    }
    messages.push({
      role: "user",
      content: inputs.originalMessage
    });
    console.log(
      `[DecideAction] Calling LLM with ${messages.length} messages (user_tz: ${userTz}, ${userReminders.length} reminders)`
    );
    const response = await callLlmWithTools(messages, TOOLS);
    if (!response.tool_calls || response.tool_calls.length === 0) {
      return { assistantReply: response.content || "" };
    }
    return response.tool_calls[0];
  }
  async post(shared, _prepRes, execRes) {
    if (execRes.assistantReply) {
      shared.response = execRes.assistantReply.trim() || "(no response)";
      shared.needsReply = false;
      console.log("[DecideAction] No tool_calls; returning assistant reply directly");
      return void 0;
    }
    const tc = execRes;
    const toolName = tc.function.name;
    const toolArgs = JSON.parse(tc.function.arguments);
    console.log(`[DecideAction] Tool: ${toolName}, Args: ${JSON.stringify(toolArgs)}`);
    shared.toolName = toolName;
    shared.toolArgs = toolArgs;
    if (toolName === "ask_user") {
      shared.question = toolArgs.question;
      return "need_info";
    } else if (toolName === "schedule_once") {
      return "schedule_once";
    } else if (toolName === "schedule_cron") {
      return "schedule_cron";
    } else if (toolName === "schedule_cron_finite") {
      return "schedule_cron_finite";
    } else if (toolName === "list_reminders") {
      return "list";
    } else if (toolName === "cancel_reminder") {
      return "cancel";
    } else if (toolName === "cancel_all_reminders") {
      return "cancel_all";
    } else if (toolName === "set_timezone") {
      return "set_timezone";
    } else if (toolName === "edit_reminder") {
      return "edit";
    } else {
      throw new Error(`Unknown tool: ${toolName}`);
    }
  }
};
var AskUser = class extends Node {
  async prep(shared) {
    return shared.question;
  }
  async exec(question) {
    console.log(`[AskUser] Question: ${question}`);
    return question;
  }
  async post(shared, _prepRes, execRes) {
    shared.response = `\u2753 ${execRes}`;
    shared.needsReply = true;
    console.log(`[AskUser] Response set: ${shared.response.slice(0, 100)}...`);
    return void 0;
  }
};
var ScheduleOnce = class extends Node {
  async prep(shared) {
    const args = shared.toolArgs;
    return {
      userId: shared.userId,
      chatId: shared.chatId,
      reminderText: args.reminder_text,
      datetimeIso: args.datetime_iso,
      timezone: args.timezone
    };
  }
  async exec(inputs) {
    const tzError = validateTimezone(inputs.timezone);
    if (tzError) {
      return { error: tzError };
    }
    const { error: dtError } = parseIsoDatetime(inputs.datetimeIso);
    if (dtError) {
      return { error: dtError };
    }
    const reminderId = generateReminderId();
    const reminder = await saveReminder({
      userId: inputs.userId,
      chatId: inputs.chatId,
      text: inputs.reminderText,
      scheduleType: "once",
      scheduleValue: inputs.datetimeIso,
      timezone: inputs.timezone,
      reminderId
    });
    return reminder;
  }
  async post(shared, _prepRes, execRes) {
    if (execRes.error) {
      shared.response = `\u26A0\uFE0F ${execRes.error}`;
      shared.needsReply = false;
      return void 0;
    }
    shared.reminder = execRes;
    shared.scheduleJob = true;
    console.log(`[ScheduleOnce] Created reminder: ${execRes.id}`);
    return "confirm";
  }
};
var ScheduleCronFinite = class extends Node {
  async prep(shared) {
    const args = shared.toolArgs;
    return {
      userId: shared.userId,
      chatId: shared.chatId,
      reminderText: args.reminder_text,
      cronExpression: args.cron_expression,
      endDatetimeIso: args.end_datetime_iso,
      timezone: args.timezone
    };
  }
  async exec(inputs) {
    const tzError = validateTimezone(inputs.timezone);
    if (tzError) {
      return { error: tzError };
    }
    const cronError = validateCronExpression(inputs.cronExpression);
    if (cronError) {
      return { error: cronError };
    }
    const { error: endError } = parseIsoDatetime(inputs.endDatetimeIso);
    if (endError) {
      return { error: endError };
    }
    const reminderId = generateReminderId();
    const scheduleValue = `${inputs.cronExpression}|ends:${inputs.endDatetimeIso}`;
    const reminder = await saveReminder({
      userId: inputs.userId,
      chatId: inputs.chatId,
      text: inputs.reminderText,
      scheduleType: "cron",
      scheduleValue,
      timezone: inputs.timezone,
      reminderId
    });
    return {
      ...reminder,
      _endDate: inputs.endDatetimeIso,
      _cronExpression: inputs.cronExpression
    };
  }
  async post(shared, _prepRes, execRes) {
    if (execRes.error) {
      shared.originalMessage = `Error: ${execRes.error}. Recompute end_datetime_iso correctly (end of window on end day). Original request: ${shared.originalMessage || ""}`;
      return "decide_action";
    }
    shared.reminder = execRes;
    shared.scheduleJob = true;
    console.log(`[ScheduleCronFinite] Created reminder: ${execRes.id}`);
    return "confirm";
  }
};
var ScheduleCron = class extends Node {
  async prep(shared) {
    const args = shared.toolArgs;
    return {
      userId: shared.userId,
      chatId: shared.chatId,
      reminderText: args.reminder_text,
      cronExpression: args.cron_expression,
      timezone: args.timezone
    };
  }
  async exec(inputs) {
    const tzError = validateTimezone(inputs.timezone);
    if (tzError) {
      return { error: tzError };
    }
    const cronError = validateCronExpression(inputs.cronExpression);
    if (cronError) {
      return { error: cronError };
    }
    const reminderId = generateReminderId();
    const reminder = await saveReminder({
      userId: inputs.userId,
      chatId: inputs.chatId,
      text: inputs.reminderText,
      scheduleType: "cron",
      scheduleValue: inputs.cronExpression,
      timezone: inputs.timezone,
      reminderId
    });
    return {
      ...reminder,
      _endDate: null,
      _cronExpression: inputs.cronExpression
    };
  }
  async post(shared, _prepRes, execRes) {
    if (execRes.error) {
      shared.response = `\u26A0\uFE0F ${execRes.error}`;
      shared.needsReply = false;
      return void 0;
    }
    shared.reminder = execRes;
    shared.scheduleJob = true;
    console.log(`[ScheduleCron] Created reminder: ${execRes.id}`);
    return "confirm";
  }
};
var ListReminders = class extends Node {
  async prep(shared) {
    return shared.userId;
  }
  async exec(userId) {
    const reminders = await getReminders(userId);
    console.log(`[ListReminders] Found ${reminders.length} reminders for user ${userId}`);
    return reminders;
  }
  async post(shared, _prepRes, execRes) {
    shared.remindersList = execRes;
    return "confirm";
  }
};
var CancelReminder = class extends Node {
  async prep(shared) {
    return {
      reminderId: shared.toolArgs.reminder_id,
      userId: shared.userId
    };
  }
  async exec(inputs) {
    const reminder = await getReminderForUser(inputs.reminderId, inputs.userId);
    if (!reminder) {
      return { success: false, error: "Reminder not found" };
    }
    await removeJob(inputs.reminderId);
    const success = await deleteReminder(inputs.reminderId);
    return {
      success,
      reminder: success ? reminder : null
    };
  }
  async post(shared, _prepRes, execRes) {
    shared.cancelResult = execRes;
    console.log(`[CancelReminder] Result: ${JSON.stringify(execRes)}`);
    return "confirm";
  }
};
var CancelAllReminders = class extends Node {
  async prep(shared) {
    return shared.userId;
  }
  async exec(userId) {
    const reminders = await getReminders(userId);
    const cancelled = [];
    for (const r of reminders) {
      await removeJob(r.id);
      await deleteReminder(r.id);
      cancelled.push(r);
    }
    return {
      count: cancelled.length,
      cancelled
    };
  }
  async post(shared, _prepRes, execRes) {
    shared.cancelAllResult = execRes;
    console.log(`[CancelAllReminders] Cancelled ${execRes.count} reminders`);
    return "confirm";
  }
};
var EditReminder = class extends Node {
  async prep(shared) {
    const args = shared.toolArgs;
    return {
      userId: shared.userId,
      chatId: shared.chatId,
      reminderId: args.reminder_id,
      reminderName: args.reminder_name,
      newReminderName: args.new_reminder_name,
      newQuery: args.new_query,
      timezone: args.timezone
    };
  }
  async exec(inputs) {
    const reminder = await getReminderForUser(inputs.reminderId, inputs.userId);
    if (!reminder) {
      return { error: `Reminder id '${inputs.reminderId}' not found` };
    }
    if (reminder.text.toLowerCase() !== inputs.reminderName.toLowerCase()) {
      console.log(`[EditReminder] Name mismatch: '${reminder.text}' vs '${inputs.reminderName}'`);
    }
    await removeJob(reminder.id);
    await deleteReminder(reminder.id);
    let newQuery = inputs.newQuery;
    if (!newQuery.toLowerCase().includes(inputs.newReminderName.toLowerCase())) {
      newQuery = `${inputs.newReminderName}: ${newQuery}`;
    }
    return { nextQuery: newQuery };
  }
  async post(shared, _prepRes, execRes) {
    if (execRes.error) {
      shared.response = `\u26A0\uFE0F ${execRes.error}`;
      shared.needsReply = false;
      return void 0;
    }
    shared.originalMessage = execRes.nextQuery;
    return "decide_action";
  }
};
var SetTimezone = class extends Node {
  async prep(shared) {
    return {
      userId: shared.userId,
      timezone: shared.toolArgs.timezone
    };
  }
  async exec(inputs) {
    const error = validateTimezone(inputs.timezone);
    if (error) {
      return { success: false, error };
    }
    await setUserTimezone(inputs.userId, inputs.timezone);
    return { success: true, timezone: inputs.timezone };
  }
  async post(shared, _prepRes, execRes) {
    shared.timezoneResult = execRes;
    console.log(`[SetTimezone] Result: ${JSON.stringify(execRes)}`);
    return "confirm";
  }
};
var Confirm = class extends Node {
  async prep(shared) {
    return {
      toolName: shared.toolName,
      reminder: shared.reminder,
      remindersList: shared.remindersList,
      cancelResult: shared.cancelResult,
      cancelAllResult: shared.cancelAllResult,
      timezoneResult: shared.timezoneResult,
      userId: shared.userId
    };
  }
  formatDatetime(dtStr, storedTz, userId) {
    try {
      const dt = new Date(dtStr.replace("Z", "+00:00"));
      const tz = storedTz;
      return formatInTimeZone(dt, tz, "MMM dd 'at' HH:mm");
    } catch {
      return dtStr;
    }
  }
  describeCron(cronExpr) {
    let endInfo = "";
    if (cronExpr.includes("|ends:")) {
      const [cron, endStr] = cronExpr.split("|ends:");
      cronExpr = cron;
      try {
        const endDt = new Date(endStr);
        endInfo = ` (until ${format(endDt, "HH:mm")})`;
      } catch {
      }
    }
    const parts = cronExpr.trim().split(/\s+/);
    if (parts.length !== 5) {
      return cronExpr + endInfo;
    }
    const [minute, hour, day, month, dow] = parts;
    let desc = cronExpr;
    if (cronExpr.trim() === "* * * * *") {
      desc = "every minute";
    } else if (minute === "0" && hour === "*") {
      desc = "every hour";
    } else if (minute !== "*" && hour !== "*" && day === "*" && month === "*" && dow === "*") {
      desc = `daily at ${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
    } else if (minute.startsWith("*/")) {
      desc = `every ${minute.slice(2)} minutes`;
    } else if (hour.startsWith("*/")) {
      desc = `every ${hour.slice(2)} hours`;
    }
    return desc + endInfo;
  }
  async exec(inputs) {
    const toolName = inputs.toolName;
    if (toolName === "schedule_once") {
      const r = inputs.reminder;
      const formattedTime = this.formatDatetime(r.scheduleValue, r.timezone, inputs.userId);
      return `\u2705 Reminder set!

\u{1F4DD} ${r.text}
\u23F0 ${formattedTime}`;
    } else if (toolName === "schedule_cron" || toolName === "schedule_cron_finite") {
      const r = inputs.reminder;
      const cronDesc = this.describeCron(r.scheduleValue);
      return `\u2705 Recurring reminder set!

\u{1F4DD} ${r.text}
\u{1F504} ${cronDesc}`;
    } else if (toolName === "list_reminders") {
      const reminders = inputs.remindersList || [];
      if (reminders.length === 0) {
        return "\u{1F4CB} You have no active reminders.";
      }
      const lines = ["\u{1F4CB} Your reminders:\n"];
      for (const r of reminders) {
        if (r.scheduleType === "cron") {
          const scheduleInfo = `\u{1F504} ${this.describeCron(r.scheduleValue)}`;
          lines.push(`\u2022 ${r.text}
  ${scheduleInfo}`);
        } else {
          const scheduleInfo = `\u{1F4C5} ${this.formatDatetime(r.scheduleValue, r.timezone, inputs.userId)}`;
          lines.push(`\u2022 ${r.text}
  ${scheduleInfo}`);
        }
      }
      return lines.join("\n");
    } else if (toolName === "cancel_reminder") {
      const result = inputs.cancelResult;
      if (result.success) {
        const r = result.reminder;
        return `\u274C Reminder cancelled: ${r.text}`;
      } else {
        return `\u26A0\uFE0F Could not cancel reminder: ${result.error || "Unknown error"}`;
      }
    } else if (toolName === "cancel_all_reminders") {
      const result = inputs.cancelAllResult;
      const count = result.count;
      if (count === 0) {
        return "\u{1F4CB} No reminders to cancel.";
      }
      return `\u{1F5D1}\uFE0F Cancelled ${count} reminder(s)!`;
    } else if (toolName === "set_timezone") {
      const result = inputs.timezoneResult;
      if (result.success) {
        return `\u{1F30D} Timezone set to ${result.timezone}!`;
      } else {
        return `\u26A0\uFE0F ${result.error}`;
      }
    }
    return "Done!";
  }
  async post(shared, _prepRes, execRes) {
    shared.response = execRes;
    shared.needsReply = false;
    console.log(`[Confirm] Response: ${execRes.slice(0, 100)}...`);
    return void 0;
  }
};

// src/flow.ts
function createReminderFlow() {
  const parseInput = new ParseInput();
  const decideAction = new DecideAction();
  const askUser = new AskUser();
  const scheduleOnce2 = new ScheduleOnce();
  const scheduleCron2 = new ScheduleCron();
  const scheduleCronFinite = new ScheduleCronFinite();
  const listReminders = new ListReminders();
  const cancelReminder = new CancelReminder();
  const cancelAllReminders = new CancelAllReminders();
  const editReminder = new EditReminder();
  const setTimezone = new SetTimezone();
  const confirm = new Confirm();
  parseInput.next(decideAction);
  decideAction.on("need_info", askUser);
  decideAction.on("schedule_once", scheduleOnce2);
  decideAction.on("schedule_cron", scheduleCron2);
  decideAction.on("schedule_cron_finite", scheduleCronFinite);
  decideAction.on("list", listReminders);
  decideAction.on("cancel", cancelReminder);
  decideAction.on("cancel_all", cancelAllReminders);
  decideAction.on("edit", editReminder);
  decideAction.on("set_timezone", setTimezone);
  scheduleOnce2.on("confirm", confirm);
  scheduleCron2.on("confirm", confirm);
  scheduleCronFinite.on("confirm", confirm);
  scheduleCronFinite.on("decide_action", decideAction);
  listReminders.on("confirm", confirm);
  cancelReminder.on("confirm", confirm);
  cancelAllReminders.on("confirm", confirm);
  editReminder.on("decide_action", decideAction);
  setTimezone.on("confirm", confirm);
  return new Flow(parseInput);
}

// src/index.ts
init_storage();
var reminderFlow = createReminderFlow();
var globalBot = null;
var MAX_CONVERSATION_MESSAGES = 20;
var conversations = /* @__PURE__ */ new Map();
function trimConversation(conv) {
  if (conv.length <= MAX_CONVERSATION_MESSAGES) {
    return conv;
  }
  return conv.slice(-MAX_CONVERSATION_MESSAGES);
}
async function sendReminder(job) {
  if (!globalBot) {
    console.error("[Reminder] Global bot not initialized");
    return;
  }
  const { chatId, text, reminderId, scheduleType } = job.attrs.data;
  const message = `\u{1F514} ${text}`;
  try {
    await globalBot.telegram.sendMessage(parseInt(chatId), message);
    console.log(`[Reminder] Sent reminder ${reminderId} to chat ${chatId}`);
  } catch (error) {
    console.error(`[Reminder] Failed to send reminder ${reminderId} to chat ${chatId}:`, error);
    return;
  }
  if (scheduleType === "once") {
    const { deleteReminder: deleteReminder2 } = await Promise.resolve().then(() => (init_storage(), storage_exports));
    await deleteReminder2(reminderId);
    console.log(`[Reminder] Auto-deleted one-time reminder ${reminderId}`);
  }
}
async function scheduleReminderJob(r) {
  const callbackData = {
    chatId: r.chatId,
    text: r.text,
    reminderId: r.id,
    scheduleType: r.scheduleType
  };
  const agenda2 = getAgenda();
  agenda2.define(r.id, sendReminder);
  if (r.scheduleType === "once") {
    await scheduleOnce({
      jobId: r.id,
      runDate: r.scheduleValue,
      callback: sendReminder,
      timezone: r.timezone,
      callbackData
    });
  } else if (r.scheduleType === "cron") {
    let cronExpr = r.scheduleValue;
    let endDate;
    if (cronExpr.includes("|ends:")) {
      const parts = cronExpr.split("|ends:");
      cronExpr = parts[0];
      endDate = parts[1];
    }
    await scheduleCron({
      jobId: r.id,
      cronExpression: cronExpr,
      callback: sendReminder,
      timezone: r.timezone,
      endDate,
      callbackData
    });
  }
}
async function restoreScheduledJobs() {
  const reminders = await getAllReminders();
  console.log(`[Startup] Restoring ${reminders.length} reminders...`);
  for (const r of reminders) {
    try {
      await scheduleReminderJob(r);
      console.log(`[Startup] Restored reminder: ${r.id}`);
    } catch (error) {
      console.error(`[Startup] Failed to restore reminder ${r.id}:`, error);
    }
  }
}
async function handleMessage(ctx) {
  if (!ctx.message || !("text" in ctx.message)) return;
  const userId = ctx.from.id.toString();
  const chatId = ctx.chat.id.toString();
  const message = ctx.message.text;
  console.log(`
[Bot] Message from ${userId}: ${message}`);
  let conversation = conversations.get(userId) || [];
  conversation = trimConversation(conversation);
  const shared = {
    userId,
    chatId,
    message,
    conversation: [...conversation]
  };
  try {
    await reminderFlow.run(shared);
    if (shared.scheduleJob && shared.reminder) {
      await scheduleReminderJob(shared.reminder);
    }
    if (shared.scheduleJobs) {
      for (const r of shared.scheduleJobs) {
        await scheduleReminderJob(r);
      }
    }
    const response = shared.response || "Something went wrong.";
    await ctx.reply(response);
    conversation.push({ role: "user", content: message });
    conversation.push({ role: "assistant", content: response });
    conversations.set(userId, trimConversation(conversation));
  } catch (error) {
    console.error("[Bot] Error:", error);
    await ctx.reply(`\u274C Error: ${error instanceof Error ? error.message : String(error)}`);
  }
}
async function startCommand(ctx) {
  const welcome = `\u{1F44B} Hi! I'm your reminder assistant.

I can help you:
\u2022 Schedule one-time reminders
\u2022 Set up recurring reminders
\u2022 List your active reminders
\u2022 Cancel reminders

Just tell me what you want to be reminded about!`;
  await ctx.reply(welcome);
}
async function helpCommand(ctx) {
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
async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN environment variable not set");
  }
  const dbUrl = process.env.DATABASE_URL || "postgresql://localhost:5432/reminderbot";
  console.log("[Bot] Starting...", { dbUrl });
  await initStorage(dbUrl);
  await initScheduler(dbUrl);
  const bot = new Telegraf(token);
  globalBot = bot;
  await restoreScheduledJobs();
  console.log("[Bot] Ready!");
  bot.command("start", startCommand);
  bot.command("help", helpCommand);
  bot.on("text", handleMessage);
  console.log("[Bot] Starting polling...");
  await bot.launch();
  process.once("SIGINT", async () => {
    console.log("[Bot] SIGINT received, shutting down...");
    bot.stop("SIGINT");
    await stopScheduler();
    await closeStorage();
  });
  process.once("SIGTERM", async () => {
    console.log("[Bot] SIGTERM received, shutting down...");
    bot.stop("SIGTERM");
    await stopScheduler();
    await closeStorage();
  });
}
main().catch((error) => {
  console.error("[Bot] Fatal error:", error);
  process.exit(1);
});
//# sourceMappingURL=index.mjs.map