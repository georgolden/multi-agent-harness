/**
 * PocketFlow flow for the reminder agent.
 * Connects all nodes in a clear, directed graph.
 */
import { Flow } from 'pocketflow'
import {
  ParseInput,
  DecideAction,
  AskUser,
  ScheduleOnce,
  ScheduleCron,
  ScheduleCronFinite,
  ListReminders,
  CancelReminder,
  CancelAllReminders,
  EditReminder,
  SetTimezone,
  Confirm,
} from './nodes.js'
import type { ReminderBotSharedState } from './types.js'

/**
 * Create and return the reminder agent flow
 */
export function createReminderFlow(): Flow<ReminderBotSharedState> {
  // Create nodes
  const parseInput = new ParseInput()
  const decideAction = new DecideAction()
  const askUser = new AskUser()
  const scheduleOnce = new ScheduleOnce()
  const scheduleCron = new ScheduleCron()
  const scheduleCronFinite = new ScheduleCronFinite()
  const listReminders = new ListReminders()
  const cancelReminder = new CancelReminder()
  const cancelAllReminders = new CancelAllReminders()
  const editReminder = new EditReminder()
  const setTimezone = new SetTimezone()
  const confirm = new Confirm()

  // Connect nodes
  // ParseInput -> DecideAction
  parseInput.next(decideAction)

  // DecideAction routes to different actions
  decideAction.on('need_info', askUser)
  decideAction.on('schedule_once', scheduleOnce)
  decideAction.on('schedule_cron', scheduleCron)
  decideAction.on('schedule_cron_finite', scheduleCronFinite)
  decideAction.on('list', listReminders)
  decideAction.on('cancel', cancelReminder)
  decideAction.on('cancel_all', cancelAllReminders)
  decideAction.on('edit', editReminder)
  decideAction.on('set_timezone', setTimezone)

  // AskUser ends the flow (response is the question)

  // All actions lead to Confirm
  scheduleOnce.on('confirm', confirm)
  scheduleCron.on('confirm', confirm)
  scheduleCronFinite.on('confirm', confirm)
  scheduleCronFinite.on('decide_action', decideAction) // Retry on error
  listReminders.on('confirm', confirm)
  cancelReminder.on('confirm', confirm)
  cancelAllReminders.on('confirm', confirm)
  editReminder.on('decide_action', decideAction) // Edit loops back to decide
  setTimezone.on('confirm', confirm)

  // Create flow starting with ParseInput
  return new Flow<ReminderBotSharedState>(parseInput)
}
