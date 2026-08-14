import { DEFAULT_DAILY_TIME, normalizeDailyTime } from './schedule-settings';

/** Cloudflare invokes the Worker once per minute; decisions happen in code. */
export const SCHEDULER_CRON = '* * * * *';
export const TAIPEI_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;

export interface ScheduledJobDecision {
  dailyDue: boolean;
  hourlyPriceDue: boolean;
  taipeiDate: string;
  taipeiTime: string;
}

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

/**
 * Decide which jobs are due at a UTC scheduled timestamp.
 *
 * Taiwan has no daylight-saving transition, so adding the fixed UTC+8 offset
 * and reading UTC fields gives deterministic Taipei date/time values.
 */
export function decideScheduledJobs(
  scheduledTime: number,
  dailyTime: string = DEFAULT_DAILY_TIME,
): ScheduledJobDecision {
  if (!Number.isFinite(scheduledTime)) {
    throw new Error('Scheduled time must be a finite millisecond timestamp');
  }
  const taipei = new Date(scheduledTime + TAIPEI_UTC_OFFSET_MS);
  const year = taipei.getUTCFullYear();
  const month = taipei.getUTCMonth() + 1;
  const day = taipei.getUTCDate();
  const hour = taipei.getUTCHours();
  const minute = taipei.getUTCMinutes();
  const taipeiDate = `${year.toString().padStart(4, '0')}-${pad(month)}-${pad(day)}`;
  const taipeiTime = `${pad(hour)}:${pad(minute)}`;
  const configuredDailyTime = normalizeDailyTime(dailyTime);

  return {
    // Once the configured minute has arrived, keep the daily job eligible for
    // the remainder of the Taipei calendar day.  The D1 claim/lease protects
    // against duplicate work while allowing a failed run to retry later.
    dailyDue: taipeiTime >= configuredDailyTime,
    hourlyPriceDue: minute === 0,
    taipeiDate,
    taipeiTime,
  };
}
