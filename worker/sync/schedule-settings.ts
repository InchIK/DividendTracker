/**
 * D1-backed settings for the daily Taipei synchronisation schedule.
 *
 * The scheduler itself runs every minute in UTC.  The daily time is kept as
 * a small, validated HH:mm value so it can be changed without a deployment.
 */

export const DAILY_SYNC_TIME_KEY = 'daily_sync_time_taipei';
export const LAST_DAILY_SYNC_DATE_KEY = 'last_daily_sync_date_taipei';
/** D1 row used as a short-lived lease while a daily run is in progress. */
export const DAILY_SYNC_LEASE_KEY = 'daily_sync_lease_taipei';
export const DAILY_SYNC_LEASE_MINUTES = 30;
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

const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** Validate a caller-supplied timestamp and normalize it to canonical UTC. */
function normalizeIsoTimestamp(value: string): string {
  if (typeof value !== 'string' || !ISO_TIMESTAMP_PATTERN.test(value)) {
    throw new Error('now must be a valid ISO timestamp');
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error('now must be a valid ISO timestamp');
  return new Date(parsed).toISOString();
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
 * Atomically acquire the short-lived lease for a Taipei calendar date.
 *
 * The completion row is checked separately from the lease row, so a crashed
 * run can reacquire after thirty minutes without losing the completed-date
 * guard. A completion marker is trusted only when the run log confirms a
 * same-day success/partial result, which self-heals markers written by the old
 * pre-claim implementation. D1's changes count is the claim result.
 */
export async function claimDailySyncDate(
  db: D1Database,
  taipeiDate: string,
  now = new Date().toISOString(),
): Promise<boolean> {
  const normalizedNow = normalizeIsoTimestamp(now);
  const result = await db.prepare(
    `INSERT INTO application_settings (
       setting_key, setting_value, updated_by_user_id, updated_at
     )
     SELECT ?, ?, NULL, ?
     WHERE NOT EXISTS (
       SELECT 1
       FROM application_settings AS completed
       WHERE completed.setting_key = ? AND completed.setting_value = ?
         AND EXISTS (
           SELECT 1
           FROM sync_runs AS successful
           WHERE successful.status IN ('success', 'partial')
             AND date(successful.started_at, '+8 hours') = ?
         )
     )
     ON CONFLICT(setting_key) DO UPDATE SET
       setting_value = excluded.setting_value,
       updated_by_user_id = NULL,
       updated_at = excluded.updated_at
     WHERE NOT EXISTS (
       SELECT 1
       FROM application_settings AS completed
       WHERE completed.setting_key = ? AND completed.setting_value = ?
         AND EXISTS (
           SELECT 1
           FROM sync_runs AS successful
           WHERE successful.status IN ('success', 'partial')
             AND date(successful.started_at, '+8 hours') = ?
         )
     )
       AND (
         application_settings.setting_value <> excluded.setting_value
         OR julianday(?) - julianday(application_settings.updated_at) >= ?
         OR julianday(application_settings.updated_at) IS NULL
       )`,
  ).bind(
    DAILY_SYNC_LEASE_KEY,
    taipeiDate,
    normalizedNow,
    LAST_DAILY_SYNC_DATE_KEY,
    taipeiDate,
    taipeiDate,
    LAST_DAILY_SYNC_DATE_KEY,
    taipeiDate,
    taipeiDate,
    normalizedNow,
    DAILY_SYNC_LEASE_MINUTES / (24 * 60),
  ).run();

  return result.meta.changes === 1;
}

/**
 * Mark a daily run complete and then remove only its matching lease.
 *
 * The completion row is deliberately written first.  If lease cleanup fails,
 * a later claimant still observes the completed date and cannot rerun it.
 */
export async function completeDailySyncDate(
  db: D1Database,
  taipeiDate: string,
  now = new Date().toISOString(),
): Promise<void> {
  const normalizedNow = normalizeIsoTimestamp(now);
  await db.prepare(
    `INSERT INTO application_settings (
       setting_key, setting_value, updated_by_user_id, updated_at
     ) VALUES (?, ?, NULL, ?)
     ON CONFLICT(setting_key) DO UPDATE SET
       setting_value = excluded.setting_value,
       updated_by_user_id = NULL,
       updated_at = excluded.updated_at`,
  ).bind(LAST_DAILY_SYNC_DATE_KEY, taipeiDate, normalizedNow).run();

  await db.prepare(
    `DELETE FROM application_settings
     WHERE setting_key = ? AND setting_value = ?`,
  ).bind(DAILY_SYNC_LEASE_KEY, taipeiDate).run();
}
