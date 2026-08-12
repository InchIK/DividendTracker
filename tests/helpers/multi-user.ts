import initialMigration from '../../migrations/0001_initial.sql?raw';
import dynamicMigration from '../../migrations/0002_dynamic_instruments_prices.sql?raw';
import appearanceMigration from '../../migrations/0003_widget_appearance.sql?raw';
import customAppearanceMigration from '../../migrations/0004_widget_custom_background.sql?raw';
import multiUserMigration from '../../migrations/0005_multi_user_auth.sql?raw';
import registrationPolicyMigration from '../../migrations/0006_registration_policy.sql?raw';
import cleanInstallMigration from '../../migrations/0007_clean_install_privacy_reset.sql?raw';
import { sha256Base64Url } from '../../worker/auth/encoding';

export const TEST_SESSION_TOKEN = 'test-browser-session-token';
export const TEST_WIDGET_TOKEN = 'dtw_test-widget-read-only-token';
export const TEST_ENCRYPTION_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
export const TEST_USER_ID = 'usr_test_owner';

export async function applyMigration(db: D1Database, sql: string): Promise<void> {
  for (const statement of sql.split(';').map((part) => part.trim()).filter(Boolean)) {
    if (statement.startsWith('PRAGMA ')) continue;
    try {
      await db.prepare(statement).run();
    } catch (cause) {
      throw new Error(`Migration statement failed: ${statement.slice(0, 160)}`, { cause });
    }
  }
}

export async function applyMultiUserMigrations(db: D1Database): Promise<void> {
  for (const migration of [
    initialMigration,
    dynamicMigration,
    appearanceMigration,
    customAppearanceMigration,
    multiUserMigration,
    registrationPolicyMigration,
    cleanInstallMigration,
  ]) {
    await applyMigration(db, migration);
  }
}

export async function seedAuthenticatedUser(
  db: D1Database,
  options: {
    userId?: string;
    username?: string;
    sessionToken?: string;
    widgetToken?: string;
  } = {},
): Promise<{ userId: string; sessionToken: string; widgetToken: string }> {
  const userId = options.userId ?? TEST_USER_ID;
  const username = options.username ?? 'test-owner';
  const sessionToken = options.sessionToken ?? TEST_SESSION_TOKEN;
  const widgetToken = options.widgetToken ?? TEST_WIDGET_TOKEN;
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 86_400_000).toISOString();

  await db.prepare(
    `INSERT INTO users (
       user_id, username, display_name, password_hash, password_salt,
       password_iterations, role, account_status, created_at, updated_at
     ) VALUES (?, ?, ?, 'unusable', 'unusable', 100000, ?, 'active', ?, ?)`,
  ).bind(userId, username, username, 'owner', now, now).run();

  await db.prepare(
    `INSERT INTO widget_appearance (
       user_id, theme, background_mode, start_color, end_color, updated_at
     ) VALUES (?, 'ocean', 'gradient', '#071426', '#0F766E', ?)`,
  ).bind(userId, now).run();

  await db.batch([
    db.prepare(
      `INSERT INTO auth_sessions (
         session_hash, user_id, expires_at, created_at, last_seen_at, user_agent
       ) VALUES (?, ?, ?, ?, ?, 'vitest')`,
    ).bind(await sha256Base64Url(sessionToken), userId, expiresAt, now, now),
    db.prepare(
      `INSERT INTO widget_credentials (
         user_id, token_hash, token_ciphertext, token_iv, token_suffix, created_at, rotated_at
       ) VALUES (?, ?, 'unused-in-test', 'unused-in-test', ?, ?, ?)`,
    ).bind(userId, await sha256Base64Url(widgetToken), widgetToken.slice(-6), now, now),
  ]);
  return { userId, sessionToken, widgetToken };
}

/** Explicit market fixture for tests that exercise watchlist/price behavior. */
export async function seedMarketFixtures(
  db: D1Database,
  userId = TEST_USER_ID,
): Promise<void> {
  const now = new Date().toISOString();
  const instruments = [
    ['twse:0050', '0050', 'etf', '元大台灣50'],
    ['twse:0056', '0056', 'etf', '元大高股息'],
    ['twse:00878', '00878', 'etf', '國泰永續高股息'],
    ['twse:00919', '00919', 'etf', '群益台灣精選高息'],
  ] as const;
  await db.batch([
    ...instruments.map(([instrumentId, code, kind, displayName]) => db.prepare(
      `INSERT INTO instruments (
         instrument_id, market, code, kind, display_name, active, created_at, updated_at
       ) VALUES (?, 'twse', ?, ?, ?, 1, ?, ?)`,
    ).bind(instrumentId, code, kind, displayName, now, now)),
    ...instruments.map(([instrumentId]) => db.prepare(
      `INSERT INTO watchlist (
         user_id, instrument_id, current_shares, enabled, created_at, updated_at
       ) VALUES (?, ?, 0, 1, ?, ?)`,
    ).bind(userId, instrumentId, now, now)),
  ]);
}

export function sessionHeaders(sessionToken = TEST_SESSION_TOKEN): Record<string, string> {
  return { Cookie: `dt_session=${sessionToken}` };
}

export function testEnv(db: D1Database): Env {
  return {
    DB: db,
    APP_NAME: 'DividendTracker Test',
    APP_TIMEZONE: 'Asia/Taipei',
    ALLOW_REGISTRATION: 'true',
    PASSWORD_PBKDF2_ITERATIONS: '100000',
    SESSION_TTL_HOURS: '12',
    REMEMBER_SESSION_TTL_DAYS: '30',
    GOOGLE_AUTH_ENABLED: 'false',
    TOKEN_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
    SITCA_DIVIDEND_CSV_URL: 'https://example.test/sitca.csv',
    TWSE_FUND_MAPPING_URL: 'https://example.test/funds.json',
    TWSE_EX_DIVIDEND_URL: 'https://example.test/dividends.json',
  };
}
