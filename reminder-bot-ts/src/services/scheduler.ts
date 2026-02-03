/**
 * Scheduler service using Agenda with Postgres backend.
 * Handles one-time and recurring reminder jobs.
 */
import { Agenda } from 'agenda'
import type { Job } from 'agenda'
import { PostgresBackend } from '@agendajs/postgres-backend'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
import timezone from 'dayjs/plugin/timezone.js'

dayjs.extend(utc)
dayjs.extend(timezone)

let agenda: Agenda | null = null

/**
 * Initialize the Agenda scheduler with Postgres backend
 */
export async function initScheduler(connectionString: string): Promise<void> {
  const backend = new PostgresBackend({
    connectionString,
  })

  agenda = new Agenda({
    backend,
    processEvery: '30 seconds',
    maxConcurrency: 20,
  })

  console.log('[Scheduler] Initialized with Postgres backend')
  await agenda.start()
  console.log('[Scheduler] Started')
}

/**
 * Stop the scheduler gracefully
 */
export async function stopScheduler(): Promise<void> {
  if (agenda) {
    await agenda.stop()
    agenda = null
    console.log('[Scheduler] Stopped')
  }
}

/**
 * Get the scheduler instance
 */
function getScheduler(): Agenda {
  if (!agenda) {
    throw new Error('Scheduler not initialized. Call initScheduler() first.')
  }
  return agenda
}

/**
 * Schedule a one-time reminder
 */
export async function scheduleOnce(params: {
  jobId: string
  runDate: string | Date // ISO string or Date object
  callback: (job: Job) => Promise<void>
  timezone: string
  callbackData: Record<string, unknown>
}): Promise<void> {
  const scheduler = getScheduler()

  // Parse the run date (in user's timezone if no timezone info in string)
  const parsedDate = typeof params.runDate === 'string'
    ? dayjs.tz(params.runDate, params.timezone).toDate()
    : params.runDate

  // Convert to the user's timezone for display/logging
  const zonedDate = dayjs(parsedDate).tz(params.timezone).format()

  // Define the job type with the callback
  scheduler.define(params.jobId, params.callback)

  // Schedule the job
  await scheduler.schedule(parsedDate, params.jobId, params.callbackData)

  console.log(`[Scheduler] Scheduled one-time job '${params.jobId}' for ${zonedDate} ${params.timezone}`)
}

/**
 * Schedule a recurring reminder using cron expression
 */
export async function scheduleCron(params: {
  jobId: string
  cronExpression: string // 5-field cron: "minute hour day month weekday"
  callback: (job: Job) => Promise<void>
  timezone: string
  endDate?: string | Date
  callbackData: Record<string, unknown>
}): Promise<void> {
  const scheduler = getScheduler()

  // Convert 5-field cron to 6-field cron (Agenda uses 6 fields)
  // 5-field: minute hour day month weekday
  // 6-field: second minute hour day month weekday
  const cronParts = params.cronExpression.trim().split(/\s+/)
  if (cronParts.length !== 5) {
    throw new Error(`Invalid cron expression: expected 5 fields, got ${cronParts.length}`)
  }
  const agendaCron = `0 ${params.cronExpression}` // Add "0" for seconds

  // Define the job type
  scheduler.define(params.jobId, params.callback)

  // Schedule the job
  const job = scheduler.create(params.jobId, params.callbackData)
  job.repeatEvery(agendaCron, {
    timezone: params.timezone,
    skipImmediate: true,
  })

  // Set end date if provided (in user's timezone if no timezone info in string)
  if (params.endDate) {
    const parsedEndDate = typeof params.endDate === 'string' ? dayjs.tz(params.endDate, params.timezone).toDate() : params.endDate
    console.log(`[Scheduler] Setting end date for job '${params.jobId}': ${parsedEndDate}`)
    job.endDate(parsedEndDate)
  }

  await job.save()

  const endInfo = params.endDate ? ` (ends: ${params.endDate})` : ''
  console.log(`[Scheduler] Scheduled cron job '${params.jobId}' with expression '${params.cronExpression}' (tz: ${params.timezone})${endInfo}`)
  console.log(`[Scheduler] Job attrs:`, job.attrs)
}

/**
 * Remove a scheduled job by ID
 */
export async function removeJob(jobId: string): Promise<boolean> {
  const scheduler = getScheduler()

  console.log(`[Scheduler.removeJob] Attempting to remove job: '${jobId}'`)

  try {
    // Use cancel to remove jobs matching the name
    const removed = await scheduler.cancel({ name: jobId })
    console.log(`[Scheduler.removeJob] Canceled ${removed} job(s) with name '${jobId}'`)

    if (removed > 0) {
      console.log(`[Scheduler] Removed job '${jobId}'`)
      return true
    } else {
      console.log(`[Scheduler] Job '${jobId}' not found`)
      return false
    }
  } catch (error) {
    console.error(`[Scheduler.removeJob] Error removing job '${jobId}':`, error)
    return false
  }
}

/**
 * Get the Agenda instance for advanced operations
 */
export function getAgenda(): Agenda {
  return getScheduler()
}
