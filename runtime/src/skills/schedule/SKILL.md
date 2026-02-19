---
name: schedule
description: This skill defines how to interpret and schedule one-time, recurring, and recurring interval tasks.
---

## Schedule Interpreter Skill

### Overview
This skill defines how to interpret and schedule one-time, recurring, and recurring interval tasks.

---

### 1. One-Time Schedule

#### Detection Pattern
- Input text contains **only** a time or date reference
- No recurrence indicators present

#### Scheduling Process
1. **Extract parameters**: input text, target datetime
2. **Convert** time/date to ISO datetime using user's timezone
3. **Execute** \`schedule_once\` tool

---

### 2. Recurring Schedule

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
| "every hour from 9:00 to 18:00 next Monday" | \`schedule_start_date\` + \`schedule_end_date\` |
| "daily start at next Tuesday end at next Friday" | \`schedule_start_date\` + \`schedule_end_date\` |
| "every 15 minutes from March 1 to March 7" | \`schedule_start_date\` + \`schedule_end_date\` |

**Note**: Keywords like \`from\`, \`to\`, \`start at\`, \`end at\`, \`on\`, \`until\` indicate temporal boundaries. If incomplete, ask user for clarification.

#### Named Period as Boundary Shorthand

A named time period without explicit start/end times implies the **entire span of that period** as both boundaries. The table below shows how each period type resolves:

| Period Type | Example References | `schedule_start_date` | `schedule_end_date` |
|-------------|-------------------|----------------------|---------------------|
| **Single day** | `tomorrow`, `Friday`, `March 5th` | start of that day 00:00 | end of that day 23:59 |
| **Weekend** | `this weekend`, `next weekend`, `the weekend` | closest Saturday 00:00 | that Sunday 23:59 |
| **Week** | `this week`, `next week`, `the whole week` | Monday of that week 00:00 | Sunday of that week 23:59 |
| **Month** | `this month`, `next month`, `in March` | 1st of that month 00:00 | last day of that month 23:59 |

**Examples:**

| User Input | Resolved Boundaries |
|-----------|---------------------|
| "remind me tomorrow each 30 minutes" | `schedule_start_date` = tomorrow 00:00, `schedule_end_date` = tomorrow 23:59 |
| "remind me on Friday every hour" | `schedule_start_date` = closest Friday 00:00, `schedule_end_date` = closest Friday 23:59 |
| "notify me this weekend every 2 hours" | `schedule_start_date` = Saturday 00:00, `schedule_end_date` = Sunday 23:59 |
| "ping me every day at 9 AM this week" | `schedule_start_date` = this Monday 00:00, `schedule_end_date` = this Sunday 23:59 |
| "remind me daily at 8 AM this month" | `schedule_start_date` = 1st of this month 00:00, `schedule_end_date` = last day of this month 23:59 |
| "every hour in March" | `schedule_start_date` = March 1 00:00, `schedule_end_date` = March 31 23:59 |

> **Missing time — ask the user.** When the recurrence uses a frequency keyword (`daily`, `weekly`, `monthly`, `every day`, `every week`) and no specific time is given (e.g. "ping me every day this week", "remind me daily this month"), do **not** assume a default time. Ask the user what time they want the reminder to fire. Never guess.

When a **start time** is also specified alongside the period, it shifts only `schedule_start_date` while `schedule_end_date` remains the end of that period:

| User Input | Resolved Boundaries |
|-----------|---------------------|
| "remind me on Friday start from 12:00 each hour" | `schedule_start_date` = closest Friday 12:00, `schedule_end_date` = closest Friday 23:59 |
| "tomorrow from 9 AM every 30 minutes" | `schedule_start_date` = tomorrow 09:00, `schedule_end_date` = tomorrow 23:59 |
| "this weekend starting Saturday noon every hour" | `schedule_start_date` = Saturday 12:00, `schedule_end_date` = Sunday 23:59 |
| "this week from Wednesday every day at 10 AM" | `schedule_start_date` = this Wednesday 00:00, `schedule_end_date` = this Sunday 23:59 |
| "this month from the 15th every day at 8 AM" | `schedule_start_date` = 15th of this month 00:00, `schedule_end_date` = last day of this month 23:59 |

> **Missing time — ask the user.** When the period start shifts the schedule boundary but the recurrence time is still absent (e.g. "this week from Wednesday every day", "this month from the 15th every day"), ask the user for the specific time before scheduling.

#### Possible Parameter Combinations
- \`recurrence\`
- \`recurrence\` + \`schedule_start_date\`
- \`recurrence\` + \`schedule_end_date\`
- \`recurrence\` + \`schedule_start_date\` + \`schedule_end_date\`

#### Scheduling Process
1. **Extract parameters**: recurrence pattern, optional start/end dates
2. **Convert**:
   - Recurrence → cron expression (with user's timezone)
   - \`schedule_start_date\` / \`schedule_end_date\` → ISO datetime (if present)
3. **Execute** \`schedule_recurring\` tool

---

### 3. Recurring Interval Schedule

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

#### Named Period as Boundary Shorthand

A named time period without explicit schedule-level start/end times implies the **entire span of that period** as schedule boundaries. The interval window (`interval_start_date` / `interval_end_date`) still defines when within each occurrence the reminders fire.

| Period Type | Example References | `schedule_start_date` | `schedule_end_date` |
|-------------|-------------------|----------------------|---------------------|
| **Single day** | `tomorrow`, `Friday`, `March 5th` | start of that day 00:00 | end of that day 23:59 |
| **Weekend** | `this weekend`, `next weekend`, `the weekend` | closest Saturday 00:00 | that Sunday 23:59 |
| **Week** | `this week`, `next week`, `the whole week` | Monday of that week 00:00 | Sunday of that week 23:59 |
| **Month** | `this month`, `next month`, `in March` | 1st of that month 00:00 | last day of that month 23:59 |

**Examples:**

| User Input | Resolved Boundaries |
|-----------|---------------------|
| "remind me tomorrow each 30 minutes from 9 to 11" | `interval`: 09:00–11:00, `schedule_start_date` = tomorrow 00:00, `schedule_end_date` = tomorrow 23:59 |
| "on Friday every 15 minutes from 10 to 12" | `interval`: 10:00–12:00, `schedule_start_date` = closest Friday 00:00, `schedule_end_date` = closest Friday 23:59 |
| "this weekend every hour from 10 to 14" | `interval`: 10:00–14:00, `schedule_start_date` = Saturday 00:00, `schedule_end_date` = Sunday 23:59 |
| "each day this week from 9 to 17 every 30 minutes" | `interval`: 09:00–17:00, `schedule_start_date` = this Monday 00:00, `schedule_end_date` = this Sunday 23:59 |
| "every hour from 9 to 10 daily this month" | `interval`: 09:00–10:00, `schedule_start_date` = 1st of month 00:00, `schedule_end_date` = last day of month 23:59 |

When a **start time** is also specified alongside the period, it shifts only `schedule_start_date` while `schedule_end_date` remains the end of that period:

| User Input | Resolved Boundaries |
|-----------|---------------------|
| "remind me on Friday start from 12:00 each hour from 12 to 14" | `interval`: 12:00–14:00, `schedule_start_date` = closest Friday 12:00, `schedule_end_date` = closest Friday 23:59 |
| "tomorrow from 9 AM every 30 minutes from 9 to 11" | `interval`: 09:00–11:00, `schedule_start_date` = tomorrow 09:00, `schedule_end_date` = tomorrow 23:59 |
| "this weekend from Saturday noon every hour from 12 to 16" | `interval`: 12:00–16:00, `schedule_start_date` = Saturday 12:00, `schedule_end_date` = Sunday 23:59 |
| "this week from Wednesday every day from 9 to 17 every hour" | `interval`: 09:00–17:00, `schedule_start_date` = this Wednesday 00:00, `schedule_end_date` = this Sunday 23:59 |
| "this month from 15th every day from 8 to 9 every 30 min" | `interval`: 08:00–09:00, `schedule_start_date` = 15th of month 00:00, `schedule_end_date` = last day of month 23:59 |

#### Possible Parameter Combinations
- \`interval_start_date\` + \`interval_end_date\` + \`recurrence\`
- \`interval_start_date\` + \`interval_end_date\` + \`recurrence\` + \`schedule_start_date\`
- \`interval_start_date\` + \`interval_end_date\` + \`recurrence\` + \`schedule_end_date\`
- \`interval_start_date\` + \`interval_end_date\` + \`recurrence\` + \`schedule_start_date\` + \`schedule_end_date\`

#### Scheduling Process
1. **Extract parameters**: interval boundaries, recurrence, optional schedule boundaries
2. **Convert**:
   - Recurrence, interval_start_date, interval_end_date → cron expression (with user's timezone)
   - \`schedule_start_date\` / \`schedule_end_date\` → ISO datetime (if present)
3. **Execute** \`schedule_interval\` tool
