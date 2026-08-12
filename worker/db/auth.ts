import type { PasswordDigest } from '../auth/password';
import type { EncryptedWidgetCredential } from '../auth/widget-credential';

export interface UserRow {
  user_id: string;
  username: string;
  display_name: string;
  password_hash: string;
  password_salt: string;
  password_iterations: number;
  role: 'owner' | 'user';
  account_status: 'active' | 'disabled' | 'pending_claim';
  created_at: string;
  updated_at: string;
}

export interface WidgetCredentialRow {
  user_id: string;
  token_hash: string;
  token_ciphertext: string;
  token_iv: string;
  token_suffix: string;
  created_at: string;
  rotated_at: string;
}

export interface ApplicationSettingRow {
  setting_key: string;
  setting_value: string;
  updated_by_user_id: string | null;
  updated_at: string;
}

export async function getUserByUsername(db: D1Database, username: string): Promise<UserRow | null> {
  return db.prepare(
    `SELECT * FROM users WHERE username = ? COLLATE NOCASE LIMIT 1`,
  ).bind(username).first<UserRow>();
}

export async function getUserById(db: D1Database, userId: string): Promise<UserRow | null> {
  return db.prepare('SELECT * FROM users WHERE user_id = ? LIMIT 1')
    .bind(userId).first<UserRow>();
}

export async function getUserByGoogleSub(db: D1Database, googleSub: string): Promise<UserRow | null> {
  return db.prepare(
    `SELECT u.*
     FROM google_accounts AS g
     JOIN users AS u ON u.user_id = g.user_id
     WHERE g.google_sub = ? AND u.account_status = 'active'
     LIMIT 1`,
  ).bind(googleSub).first<UserRow>();
}

export async function countActiveUsers(db: D1Database): Promise<number> {
  const row = await db.prepare(
    `SELECT COUNT(*) AS count FROM users WHERE account_status = 'active'`,
  ).first<{ count: number }>();
  return row?.count ?? 0;
}

export async function getAllowRegistrationOverride(db: D1Database): Promise<boolean | null> {
  const row = await db.prepare(
    `SELECT setting_value
     FROM application_settings
     WHERE setting_key = ?
     LIMIT 1`,
  ).bind('allow_registration').first<Pick<ApplicationSettingRow, 'setting_value'>>();
  if (row?.setting_value === 'true') return true;
  if (row?.setting_value === 'false') return false;
  return null;
}

export async function upsertAllowRegistrationOverride(
  db: D1Database,
  allowRegistration: boolean,
  updatedByUserId: string,
  now: string,
): Promise<void> {
  await db.prepare(
    `INSERT INTO application_settings (
       setting_key, setting_value, updated_by_user_id, updated_at
     ) VALUES (?, ?, ?, ?)
     ON CONFLICT(setting_key) DO UPDATE SET
       setting_value = excluded.setting_value,
       updated_by_user_id = excluded.updated_by_user_id,
       updated_at = excluded.updated_at`,
  ).bind(
    'allow_registration',
    allowRegistration ? 'true' : 'false',
    updatedByUserId,
    now,
  ).run();
}

export async function createUser(
  db: D1Database,
  input: {
    userId: string;
    username: string;
    displayName: string;
    password: PasswordDigest;
    role: 'owner' | 'user';
    widget: EncryptedWidgetCredential;
    google?: { sub: string; email: string };
    now: string;
  },
): Promise<void> {
  const statements: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO users (
         user_id, username, display_name, password_hash, password_salt,
         password_iterations, role, account_status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    ).bind(
      input.userId,
      input.username,
      input.displayName,
      input.password.hash,
      input.password.salt,
      input.password.iterations,
      input.role,
      input.now,
      input.now,
    ),
    db.prepare(
      `INSERT INTO widget_credentials (
         user_id, token_hash, token_ciphertext, token_iv, token_suffix, created_at, rotated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      input.userId,
      input.widget.tokenHash,
      input.widget.ciphertext,
      input.widget.iv,
      input.widget.suffix,
      input.now,
      input.now,
    ),
    db.prepare(
      `INSERT INTO widget_appearance (
         user_id, theme, background_mode, start_color, end_color, updated_at
       ) VALUES (?, 'ocean', 'gradient', '#071426', '#0F766E', ?)`,
    ).bind(input.userId, input.now),
  ];

  if (input.google) {
    statements.push(db.prepare(
      `INSERT INTO google_accounts (google_sub, user_id, email, created_at)
       VALUES (?, ?, ?, ?)`,
    ).bind(input.google.sub, input.userId, input.google.email, input.now));
  }

  await db.batch(statements);
}

export async function createSession(
  db: D1Database,
  input: { sessionHash: string; userId: string; expiresAt: string; now: string; userAgent: string | null },
): Promise<void> {
  await db.prepare(
    `INSERT INTO auth_sessions (
       session_hash, user_id, expires_at, created_at, last_seen_at, user_agent
     ) VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(input.sessionHash, input.userId, input.expiresAt, input.now, input.now, input.userAgent).run();
}

export async function getSessionUser(db: D1Database, sessionHash: string, now: string): Promise<UserRow | null> {
  return db.prepare(
    `SELECT u.*
     FROM auth_sessions AS s
     JOIN users AS u ON u.user_id = s.user_id
     WHERE s.session_hash = ? AND s.expires_at > ? AND u.account_status = 'active'
     LIMIT 1`,
  ).bind(sessionHash, now).first<UserRow>();
}

export async function deleteSession(db: D1Database, sessionHash: string): Promise<void> {
  await db.prepare('DELETE FROM auth_sessions WHERE session_hash = ?').bind(sessionHash).run();
}

export async function deleteUserSessions(db: D1Database, userId: string): Promise<void> {
  await db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').bind(userId).run();
}

export async function deleteOtherUserSessions(
  db: D1Database,
  userId: string,
  keepSessionHash: string,
): Promise<void> {
  await db.prepare('DELETE FROM auth_sessions WHERE user_id = ? AND session_hash <> ?')
    .bind(userId, keepSessionHash).run();
}

export async function updatePassword(
  db: D1Database,
  userId: string,
  password: PasswordDigest,
  now: string,
): Promise<void> {
  await db.prepare(
    `UPDATE users SET password_hash = ?, password_salt = ?, password_iterations = ?, updated_at = ?
     WHERE user_id = ?`,
  ).bind(password.hash, password.salt, password.iterations, now, userId).run();
}

export async function getWidgetCredentialByUser(
  db: D1Database,
  userId: string,
): Promise<WidgetCredentialRow | null> {
  return db.prepare('SELECT * FROM widget_credentials WHERE user_id = ? LIMIT 1')
    .bind(userId).first<WidgetCredentialRow>();
}

export async function getWidgetUserByTokenHash(
  db: D1Database,
  tokenHash: string,
): Promise<UserRow | null> {
  return db.prepare(
    `SELECT u.*
     FROM widget_credentials AS w
     JOIN users AS u ON u.user_id = w.user_id
     WHERE w.token_hash = ? AND u.account_status = 'active'
     LIMIT 1`,
  ).bind(tokenHash).first<UserRow>();
}

export async function saveWidgetCredential(
  db: D1Database,
  userId: string,
  widget: EncryptedWidgetCredential,
  now: string,
): Promise<void> {
  await db.prepare(
    `INSERT INTO widget_credentials (
       user_id, token_hash, token_ciphertext, token_iv, token_suffix, created_at, rotated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       token_hash = excluded.token_hash,
       token_ciphertext = excluded.token_ciphertext,
       token_iv = excluded.token_iv,
       token_suffix = excluded.token_suffix,
       rotated_at = excluded.rotated_at`,
  ).bind(
    userId,
    widget.tokenHash,
    widget.ciphertext,
    widget.iv,
    widget.suffix,
    now,
    now,
  ).run();
}
