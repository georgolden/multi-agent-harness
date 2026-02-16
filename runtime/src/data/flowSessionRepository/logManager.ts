/**
 * Log utility functions for tool and skill execution logging
 */
import type { ToolLog, SkillLog } from './types.js';

/**
 * Filter tool logs by tool name
 */
export function filterToolLogs(logs: ToolLog[], toolName: string): ToolLog[] {
  return logs.filter((log) => log.name === toolName);
}

/**
 * Filter skill logs by skill name
 */
export function filterSkillLogs(logs: SkillLog[], skillName: string): SkillLog[] {
  return logs.filter((log) => log.name === skillName);
}

/**
 * Get failed tool logs
 */
export function getFailedToolLogs(logs: ToolLog[]): ToolLog[] {
  return logs.filter((log) => log.status === 'error');
}

/**
 * Get failed skill logs
 */
export function getFailedSkillLogs(logs: SkillLog[]): SkillLog[] {
  return logs.filter((log) => log.status === 'error');
}

/**
 * Calculate statistics for tool logs
 */
export function getToolLogStats(logs: ToolLog[]): {
  total: number;
  success: number;
  error: number;
  averageDurationMs: number;
  totalDurationMs: number;
} {
  const total = logs.length;
  const success = logs.filter((log) => log.status === 'success').length;
  const error = logs.filter((log) => log.status === 'error').length;

  // Calculate duration from startedAt and endedAt
  const durations = logs.map((log) => log.endedAt.getTime() - log.startedAt.getTime());
  const totalDurationMs = durations.reduce((sum, duration) => sum + duration, 0);
  const averageDurationMs = durations.length > 0 ? totalDurationMs / durations.length : 0;

  return {
    total,
    success,
    error,
    averageDurationMs,
    totalDurationMs,
  };
}

/**
 * Calculate statistics for skill logs
 */
export function getSkillLogStats(logs: SkillLog[]): {
  total: number;
  success: number;
  error: number;
  averageDurationMs: number;
  totalDurationMs: number;
} {
  const total = logs.length;
  const success = logs.filter((log) => log.status === 'success').length;
  const error = logs.filter((log) => log.status === 'error').length;

  // Calculate duration from startedAt and endedAt
  const durations = logs.map((log) => log.endedAt.getTime() - log.startedAt.getTime());
  const totalDurationMs = durations.reduce((sum, duration) => sum + duration, 0);
  const averageDurationMs = durations.length > 0 ? totalDurationMs / durations.length : 0;

  return {
    total,
    success,
    error,
    averageDurationMs,
    totalDurationMs,
  };
}
