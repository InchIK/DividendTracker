import { env, reset } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import worker from '../../worker/index';
import { sha256Base64Url } from '../../worker/auth/encoding';
import {
  claimDailySyncDate,
  completeDailySyncDate,
} from '../../worker/sync/schedule-settings';
import {
  FINMIND_API_TOKEN_SETTING_KEY,
  resolveFinmindApiToken,
} from '../../worker/sync/finmind-token-settings';
import {
  applyMultiUserMigrations,
  seedAuthenticatedUser,
  testEnv,
  TEST_USER_ID,
} from '../helpers/multi-user';

const OWNER_SESSION = 'test-browser-session-token';
const MEMBER_ID = 'usr_test_member';
const MEMBER_SESSION = 'test-member-session-token';
const FAKE_FINMIND_TOKEN = 'fake-finmind-token-0123456789';
const FALLBACK_FINMIND_TOKEN = 'fallback-finmind-token-9876543210';

async function request(
  path: string,
  options: { method?: string; body?: unknown; session?: string } = {},
): Promise<Response> {
  const method = options.method ?? 'GET';
  const headers = new Headers({
    Accept: 'application/json',
    Cookie: `dt_session=${options.session ?? OWNER_SESSION}`,
  });
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  if (method !== 'GET') headers.set('Origin', 'https://example.test');
  return worker.fetch(new Request(`https://example.test${path}`, {
    method,
    headers,
    body: options.body === undefined ? null : JSON.stringify(options.body),
  }), testEnv(env.DB));
}

async function seedMember(): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO users (
       user_id, username, display_name, password_hash, password_salt,
       password_iterations, role, account_status, created_at, updated_at
     ) VALUES (?, ?, ?, 'unusable', 'unusable', 100000, 'user', 'active', ?, ?)`,
  ).bind(MEMBER_ID, 'test-member', 'Test Member', now, now).run();
  await env.DB.prepare(
    `INSERT INTO auth_sessions (
       session_hash, user_id, expires_at, created_at, last_seen_at, user_agent
     ) VALUES (?, ?, ?, ?, ?, 'vitest')`,
  ).bind(
    await sha256Base64Url(MEMBER_SESSION),
    MEMBER_ID,
    new Date(Date.now() + 86_400_000).toISOString(),
    now,
    now,
  ).run();
}

beforeEach(async () => {
  await reset();
  await applyMultiUserMigrations(env.DB);
  await seedAuthenticatedUser(env.DB);
  await seedMember();
});

describe('daily sync schedule settings', () => {
  it('returns the default schedule when no setting row exists', async () => {
    const response = await request('/api/v1/sync/settings');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      dailyTime: '13:35',
      timezone: 'Asia/Taipei',
      updatedAt: null,
    });
  });

  it('falls back without presenting an invalid row as a saved schedule', async () => {
    await env.DB.prepare(
      `INSERT INTO application_settings (setting_key, setting_value, updated_by_user_id, updated_at)
       VALUES ('daily_sync_time_taipei', 'invalid', ?, '2026-08-13T00:00:00.000Z')`,
    ).bind(TEST_USER_ID).run();

    const response = await request('/api/v1/sync/settings');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      dailyTime: '13:35',
      updatedAt: null,
    });
  });

  it('lets an owner update a valid time and records the D1 writer', async () => {
    const response = await request('/api/v1/sync/settings', {
      method: 'PUT',
      body: { dailyTime: '09:05' },
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      dailyTime: '09:05',
      timezone: 'Asia/Taipei',
    });
    await expect(env.DB.prepare(
      `SELECT setting_value, updated_by_user_id
       FROM application_settings WHERE setting_key = 'daily_sync_time_taipei'`,
    ).first()).resolves.toMatchObject({
      setting_value: '09:05',
      updated_by_user_id: TEST_USER_ID,
    });
  });

  it('rejects malformed or extra schedule fields', async () => {
    const malformed = await request('/api/v1/sync/settings', {
      method: 'PUT',
      body: { dailyTime: '9:05' },
    });
    expect(malformed.status).toBe(400);

    const extra = await request('/api/v1/sync/settings', {
      method: 'PUT',
      body: { dailyTime: '09:05', timezone: 'UTC' },
    });
    expect(extra.status).toBe(400);
  });

  it('allows members to read but not update the schedule', async () => {
    const read = await request('/api/v1/sync/settings', { session: MEMBER_SESSION });
    expect(read.status).toBe(200);
    const denied = await request('/api/v1/sync/settings', {
      method: 'PUT',
      session: MEMBER_SESSION,
      body: { dailyTime: '10:00' },
    });
    expect(denied.status).toBe(403);
  });

  it('acquires a lease once, blocks fresh retries, and reacquires after 30 minutes', async () => {
    await expect(claimDailySyncDate(env.DB, '2026-08-13', '2026-08-13T05:35:00.000Z')).resolves.toBe(true);
    await expect(claimDailySyncDate(env.DB, '2026-08-13', '2026-08-13T06:04:00.000Z')).resolves.toBe(false);
    await expect(claimDailySyncDate(env.DB, '2026-08-13', '2026-08-13T06:06:00.000Z')).resolves.toBe(true);
  });

  it('records completion before releasing the lease and blocks same-day reruns', async () => {
    await expect(claimDailySyncDate(env.DB, '2026-08-13', '2026-08-13T05:35:00.000Z')).resolves.toBe(true);
    await env.DB.prepare(
      `INSERT INTO sync_runs (trigger_kind, started_at, finished_at, status)
       VALUES ('cron', ?, ?, 'success')`,
    ).bind('2026-08-13T05:35:00.000Z', '2026-08-13T05:50:00.000Z').run();
    await completeDailySyncDate(env.DB, '2026-08-13', '2026-08-13T05:50:00.000Z');
    await expect(claimDailySyncDate(env.DB, '2026-08-13', '2026-08-13T06:30:00.000Z')).resolves.toBe(false);
    await expect(claimDailySyncDate(env.DB, '2026-08-14', '2026-08-14T05:35:00.000Z')).resolves.toBe(true);
  });

  it('self-heals a legacy completion marker when no successful run exists that Taipei day', async () => {
    await env.DB.prepare(
      `INSERT INTO application_settings (setting_key, setting_value, updated_by_user_id, updated_at)
       VALUES ('last_daily_sync_date_taipei', '2026-08-13', NULL, '2026-08-13T05:35:00.000Z')`,
    ).run();
    await expect(claimDailySyncDate(env.DB, '2026-08-13', '2026-08-13T06:00:00.000Z')).resolves.toBe(true);
  });
});

describe('FinMind token settings', () => {
  it('returns owner none status without a token field', async () => {
    const response = await request('/api/v1/sync/finmind-token');
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toEqual({
      configured: false,
      source: 'none',
      updatedAt: null,
      storedTokenInvalid: false,
    });
    expect(body).not.toHaveProperty('token');
  });

  it('stores an encrypted owner token and resolves it without returning plaintext', async () => {
    const response = await request('/api/v1/sync/finmind-token', {
      method: 'PUT',
      body: { token: FAKE_FINMIND_TOKEN },
    });
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({ configured: true, source: 'database', storedTokenInvalid: false });
    expect(body).not.toHaveProperty('token');
    expect(JSON.stringify(body)).not.toContain(FAKE_FINMIND_TOKEN);

    const row = await env.DB.prepare(
      `SELECT setting_value FROM application_settings WHERE setting_key = ?`,
    ).bind(FINMIND_API_TOKEN_SETTING_KEY).first<{ setting_value: string }>();
    expect(row?.setting_value).toBeTruthy();
    expect(row?.setting_value).not.toContain(FAKE_FINMIND_TOKEN);
    await expect(resolveFinmindApiToken(
      env.DB,
      testEnv(env.DB).TOKEN_ENCRYPTION_KEY,
      null,
    )).resolves.toMatchObject({
      token: FAKE_FINMIND_TOKEN,
      source: 'database',
      configured: true,
      storedTokenInvalid: false,
    });
  });

  it('rejects malformed token payloads without storing a row', async () => {
    for (const body of [
      { token: 'too-short' },
      { token: '   ' },
      { token: FAKE_FINMIND_TOKEN, extra: 'field' },
    ]) {
      const response = await request('/api/v1/sync/finmind-token', {
        method: 'PUT',
        body,
      });
      expect(response.status).toBe(400);
      expect(await response.text()).not.toContain(FAKE_FINMIND_TOKEN);
    }
    await expect(env.DB.prepare(
      `SELECT setting_value FROM application_settings WHERE setting_key = ?`,
    ).bind(FINMIND_API_TOKEN_SETTING_KEY).first()).resolves.toBeNull();
  });

  it('denies members all FinMind token operations', async () => {
    await expect(request('/api/v1/sync/finmind-token', { session: MEMBER_SESSION })).resolves.toHaveProperty('status', 403);
    await expect(request('/api/v1/sync/finmind-token', {
      method: 'PUT',
      session: MEMBER_SESSION,
      body: { token: FAKE_FINMIND_TOKEN },
    })).resolves.toHaveProperty('status', 403);
    await expect(request('/api/v1/sync/finmind-token', {
      method: 'DELETE',
      session: MEMBER_SESSION,
    })).resolves.toHaveProperty('status', 403);
  });

  it('deletes the D1 setting and falls back to an environment token', async () => {
    const saved = await request('/api/v1/sync/finmind-token', {
      method: 'PUT',
      body: { token: FAKE_FINMIND_TOKEN },
    });
    expect(saved.status).toBe(200);
    const deleted = await request('/api/v1/sync/finmind-token', { method: 'DELETE' });
    expect(deleted.status).toBe(200);
    await expect(deleted.json()).resolves.toMatchObject({
      configured: false,
      source: 'none',
      storedTokenInvalid: false,
    });
    await expect(env.DB.prepare(
      `SELECT setting_value FROM application_settings WHERE setting_key = ?`,
    ).bind(FINMIND_API_TOKEN_SETTING_KEY).first()).resolves.toBeNull();
    await expect(resolveFinmindApiToken(
      env.DB,
      testEnv(env.DB).TOKEN_ENCRYPTION_KEY,
      FALLBACK_FINMIND_TOKEN,
    )).resolves.toMatchObject({
      token: FALLBACK_FINMIND_TOKEN,
      source: 'environment',
      configured: true,
      storedTokenInvalid: false,
    });
  });

  it('falls back safely when the stored encrypted JSON is corrupted', async () => {
    await env.DB.prepare(
      `INSERT INTO application_settings (setting_key, setting_value, updated_by_user_id, updated_at)
       VALUES (?, ?, ?, ?)`,
    ).bind(
      FINMIND_API_TOKEN_SETTING_KEY,
      '{"version":1,"ciphertext":"corrupt"',
      TEST_USER_ID,
      '2026-08-13T00:00:00.000Z',
    ).run();
    await expect(resolveFinmindApiToken(
      env.DB,
      testEnv(env.DB).TOKEN_ENCRYPTION_KEY,
      FALLBACK_FINMIND_TOKEN,
    )).resolves.toMatchObject({
      token: FALLBACK_FINMIND_TOKEN,
      source: 'environment',
      configured: true,
      updatedAt: '2026-08-13T00:00:00.000Z',
      storedTokenInvalid: true,
    });
  });
});
