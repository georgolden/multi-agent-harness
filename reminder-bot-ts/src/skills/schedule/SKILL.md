---
name: schedule-reminder
description: This skill defines how to interpret and schedule three types of reminders: one-time, recurring, and recurring interval reminders.
---

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
   - Recurrence → cron expression (with user's timezone)
   - \`schedule_start_date\` / \`schedule_end_date\` → ISO datetime (if present)
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
   - Recurrence, interval_start_date, interval_end_date → cron expression (with user's timezone)
   - \`schedule_start_date\` / \`schedule_end_date\` → ISO datetime (if present)
3. **Execute** \`schedule_interval\` tool
