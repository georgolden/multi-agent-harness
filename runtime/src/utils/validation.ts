/**
 * Validation utilities for timezones, dates, and cron expressions
 */
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat.js'

dayjs.extend(customParseFormat)

/**
 * Validate an IANA timezone string
 */
export function validateTimezone(timezone: string): string | null {
  try {
    // Try to create a formatter with the timezone
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
    return null // Valid
  } catch {
    return `Invalid timezone: ${timezone}`
  }
}

/**
 * Parse and validate an ISO datetime string
 */
export function parseIsoDatetime(dateStr: string): { date: Date | null; error: string | null } {
  try {
    const parsed = dayjs(dateStr)
    if (!parsed.isValid()) {
      return { date: null, error: `Invalid datetime: ${dateStr}` }
    }
    return { date: parsed.toDate(), error: null }
  } catch {
    return { date: null, error: `Invalid datetime: ${dateStr}` }
  }
}

/**
 * Basic cron validation (5 fields, allowed characters)
 */
export function validateCronExpression(expr: string): string | null {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) {
    return `Invalid cron expression: expected 5 fields, got ${parts.length}`
  }

  for (const part of parts) {
    if (!/^[\d*/,\-]+$/.test(part)) {
      return `Invalid cron expression part: ${part}`
    }
  }

  return null
}
