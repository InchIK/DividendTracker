/**
 * D1-backed settings for the daily Taipei synchronisation schedule.
 *
 * The scheduler itself runs every minute in UTC.  The daily time is kept as
 * a small, validated HH:mm value so it can be changed without a deployment.
 */

export const DAILY_SYNC_TIME_KEY = 'daily_sync_time_taipei';
export const LAST_DAILY_SYNC_DATE_KEY = 'last_daily_sync_date_taipei';
export const DEFAULT_DAILY_TIME = '13:35';
export const SCHEDULE_TIMEZONE = 'Asia/Taipei' as const;

export type DailySyncTime = `${string}:${string}`;

export interface SyncSchedule {
  dailyTime: string;
  timezone: typeof SCHEDULE_TIMEZONE;
  updatedAt: string | null;
}

interface ApplicationSettingRow {
  setting_key: string;
  setting_value: string;
  updated_by_user_id: string | null;
  updated_at: string;
}

/** Strictly validate a 24-hour HH:mm value. */
export function isValidDailyTime(value: unknown): value is DailySyncTime {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) return false;
  const hour = Number(value.slice(0, 2));
  const minute = Number(value.slice(3, 5));
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

/** Return a valid configured value, or the documented default. */
export function normalizeDailyTime(value: unknown): string {
  return isValidDailyTime(value) ? value : DEFAULT_DAILY_TIME;
}

/** Read the configured daily schedule, falling back safely for bad rows. */
export async function getSyncSchedule(db: D1Database): Promise<SyncSchedule> {
  const row = await db.prepare(
    `SELECT setting_key, setting_value, updated_by_user_id, updated_at
     FROM application_settings
     WHERE setting_key = ?
     LIMIT 1`,
  ).bind(DAILY_SYNC_TIME_KEY).first<ApplicationSettingRow>();

  const hasValidStoredTime = isValidDailyTime(row?.setting_value);
  return {
    dailyTime: hasValidStoredTime ? row.setting_value : DEFAULT_DAILY_TIME,
    timezone: SCHEDULE_TIMEZONE,
    updatedAt: hasValidStoredTime ? row.updated_at : null,
  };
}

/** Persist a validated daily time without touching the daily claim row. */
export async function saveSyncSchedule(
  db: D1Database,
  dailyTime: string,
  updatedByUserId: string,
  now = new Date().toISOString(),
): Promise<SyncSchedule> {
  if (!isValidDailyTime(dailyTime)) {
    throw new Error('dailyTime must be HH:mm between 00:00 and 23:59');
  }

  await db.prepare(
    `INSERT INTO application_settings (
       setting_key, setting_value, updated_by_user_id, updated_at
     ) VALUES (?, ?, ?, ?)
     ON CONFLICT(setting_key) DO UPDATE SET
       setting_value = excluded.setting_value,
       updated_by_user_id = excluded.updated_by_user_id,
       updated_at = excluded.updated_at`,
  ).bind(DAILY_SYNC_TIME_KEY, dailyTime, updatedByUserId, now).run();

  return {
    dailyTime,
    timezone: SCHEDULE_TIMEZONE,
    updatedAt: now,
  };
}

/**
 * Atomically claim a Taipei calendar date for the daily run.
 *
 * D1's changes count is the claim result: insertion/update returns one, while
 * a same-date conflict is filtered by the WHERE clause and returns zero.
 */
export async function claimDailySyncDate(
  db: D1Database,
  taipeiDate: string,
  now = new Date().toISOString(),
): Promise<boolean> {
  const result = await db.prepare(
    `INSERT INTO application_settings (
       setting_key, setting_value, updated_by_user_id, updated_at
     ) VALUES (?, ?, NULL, ?)
     ON CONFLICT(setting_key) DO UPDATE SET
       setting_value = excluded.setting_value,
       updated_by_user_id = NULL,
       updated_at = excluded.updated_at
     WHERE application_settings.setting_value <> excluded.setting_value`,
  ).bind(LAST_DAILY_SYNC_DATE_KEY, taipeiDate, now).run();

  return result.meta.changes === 1;
}
