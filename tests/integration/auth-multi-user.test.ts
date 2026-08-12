import { env, reset } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import worker from '../../worker/index';
import {
  applyMultiUserMigrations,
  seedAuthenticatedUser,
  seedMarketFixtures,
  TEST_ENCRYPTION_KEY,
  testEnv,
} from '../helpers/multi-user';

const OWNER_PASSWORD = 'owner-password-2026';
const USER_PASSWORD = 'member-password-2026';

function runtimeEnv(allowRegistration = true): Env {
  return { ...testEnv(env.DB), ALLOW_REGISTRATION: String(allowRegistration) };
}

async function request(
  path: string,
  options: { method?: string; body?: unknown; cookie?: string; bearer?: string; allowRegistration?: boolean } = {},
): Promise<Response> {
  const headers = new Headers({ Accept: 'application/json' });
  if ((options.method ?? 'GET') !== 'GET') headers.set('Origin', 'https://example.test');
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  if (options.cookie) headers.set('Cookie', options.cookie);
  if (options.bearer) headers.set('Authorization', `Bearer ${options.bearer}`);
  return worker.fetch(new Request(`https://example.test${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? null : JSON.stringify(options.body),
  }), runtimeEnv(options.allowRegistration ?? true));
}

function sessionCookie(response: Response): string {
  const value = response.headers.get('Set-Cookie');
  if (!value) throw new Error('Response did not set a session cookie');
  return value.split(';')[0] ?? value;
}

async function register(username: string, password: string, allowRegistration = true) {
  const response = await request('/api/v1/auth/register', {
    method: 'POST',
    body: { username, displayName: username, password, remember: false },
    allowRegistration,
  });
  return { response, cookie: response.status === 201 ? sessionCookie(response) : null };
}

async function revealWidgetToken(cookie: string, password: string): Promise<string> {
  const response = await request('/api/v1/auth/widget-token/reveal', {
    method: 'POST', cookie, body: { password },
  });
  expect(response.status).toBe(200);
  return (await response.json<{ token: string }>()).token;
}

beforeEach(async () => {
  await reset();
  await applyMultiUserMigrations(env.DB);
});

describe('account and per-user authentication', () => {
  it('creates a clean first owner account and reveals only an encrypted per-user Widget token after password confirmation', async () => {
    const config = await request('/api/v1/auth/config', { allowRegistration: false });
    expect(await config.json()).toMatchObject({
      appName: 'DividendTracker Test', registrationEnabled: true, firstAccount: true,
    });

    const created = await register('Owner.Example', OWNER_PASSWORD, false);
    expect(created.response.status).toBe(201);
    expect(created.response.headers.get('Set-Cookie')).toMatch(/HttpOnly.*SameSite=Lax/i);
    expect(await created.response.clone().json()).toMatchObject({
      user: { username: 'owner.example', role: 'owner' },
    });
    const cookie = created.cookie!;

    expect(await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM watchlist WHERE user_id = (SELECT user_id FROM users WHERE username = 'owner.example')`,
    ).first()).toEqual({ count: 0 });
    expect(await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM users WHERE user_id = 'legacy-unclaimed'`,
    ).first()).toEqual({ count: 0 });

    const masked = await request('/api/v1/auth/widget-token', { cookie });
    const maskedBody = await masked.json<Record<string, unknown>>();
    expect(masked.status).toBe(200);
    expect(maskedBody.maskedToken).toMatch(/^dtw_••••••/);
    expect(maskedBody).not.toHaveProperty('token');

    const denied = await request('/api/v1/auth/widget-token/reveal', {
      method: 'POST', cookie, body: { password: 'wrong-password-value' },
    });
    expect(denied.status).toBe(403);

    const widgetToken = await revealWidgetToken(cookie, OWNER_PASSWORD);
    expect(widgetToken).toMatch(/^dtw_/);
    const stored = await env.DB.prepare(
      `SELECT token_hash, token_ciphertext FROM widget_credentials LIMIT 1`,
    ).first<{ token_hash: string; token_ciphertext: string }>();
    expect(stored?.token_hash).not.toBe(widgetToken);
    expect(stored?.token_ciphertext).not.toContain(widgetToken);
    expect(TEST_ENCRYPTION_KEY).not.toContain(widgetToken);

    const widget = await request('/api/v1/widget/current?year=2026&month=8', { bearer: widgetToken });
    expect(widget.status).toBe(200);
    const browserOnly = await request('/api/v1/watchlist', { bearer: widgetToken });
    expect(browserOnly.status).toBe(401);
  });

  it('keeps watchlists and Widget appearance isolated between two registered users', async () => {
    const owner = await register('owner', OWNER_PASSWORD);
    const ownerBody = await owner.response.clone().json<{ user: { userId: string } }>();
    await seedMarketFixtures(env.DB, ownerBody.user.userId);
    const member = await register('member', USER_PASSWORD);
    expect(owner.response.status).toBe(201);
    expect(member.response.status).toBe(201);
    const ownerCookie = owner.cookie!;
    const memberCookie = member.cookie!;
    expect(await member.response.clone().json()).toMatchObject({ user: { role: 'user' } });
    expect(await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM users WHERE role = 'owner' AND account_status = 'active'`,
    ).first()).toEqual({ count: 1 });

    const memberCreate = await request('/api/v1/watchlist', {
      method: 'POST', cookie: memberCookie,
      body: {
        market: 'twse', code: '2330', kind: 'stock', displayName: '台積電',
        shares: 100, enabled: false,
      },
    });
    expect(memberCreate.status).toBe(201);
    expect((await request('/api/v1/watchlist', {
      method: 'POST', cookie: memberCookie,
      body: {
        market: 'twse', code: '0050', kind: 'etf', displayName: '會員自己的 0050 名稱',
        shares: 50, enabled: false,
      },
    })).status).toBe(201);

    const ownerWatchlist = await request('/api/v1/watchlist', { cookie: ownerCookie });
    const memberWatchlist = await request('/api/v1/watchlist', { cookie: memberCookie });
    const ownerItems = (await ownerWatchlist.json<{ items: { code: string; displayName: string }[] }>()).items;
    const memberItems = (await memberWatchlist.json<{ items: { code: string; displayName: string }[] }>()).items;
    const ownerCodes = ownerItems.map((item) => item.code);
    const memberCodes = memberItems.map((item) => item.code);
    expect(ownerCodes).toEqual(['0050', '0056', '00878', '00919']);
    expect(memberCodes).toEqual(['0050', '2330']);
    expect(ownerItems.find((item) => item.code === '0050')?.displayName).toBe('元大台灣50');
    expect(memberItems.find((item) => item.code === '0050')?.displayName).toBe('會員自己的 0050 名稱');

    await env.DB.prepare(
      `INSERT INTO dividend_events (
         event_key, instrument_id, ex_date, base_date, pay_date, dividend_micros,
         eligible_shares_override, status, canonical_source_kind, canonical_source_priority,
         manual_locked, manual_note, owner_user_id, created_at, updated_at
       ) VALUES (
         'twse:0050:2026-08-01', 'twse:0050', '2026-08-01', NULL, '2026-08-20',
         1200000, NULL, 'announced', 'sitca_open_data', 80, 0, NULL, NULL,
         '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'
       )`,
    ).run();
    const privateOverride = await request('/api/v1/dividends/manual', {
      method: 'POST', cookie: ownerCookie,
      body: {
        eventKey: 'twse:0050:2026-08-01', payDate: '2026-08-21',
        dividendPerUnit: '9', note: 'owner private note', lock: true,
      },
    });
    expect(privateOverride.status).toBe(200);
    const ownerDividend = await request('/api/v1/dividends?year=2026&month=8', { cookie: ownerCookie });
    const memberDividend = await request('/api/v1/dividends?year=2026&month=8', { cookie: memberCookie });
    expect(await ownerDividend.json()).toMatchObject({
      items: [{ dividendPerUnit: '9', payDate: '2026-08-21', manualNote: 'owner private note' }],
    });
    expect(await memberDividend.json()).toMatchObject({
      items: [{ dividendPerUnit: '1.2', payDate: '2026-08-20', manualNote: null }],
    });

    const crossArchive = await request('/api/v1/watchlist/twse%3A0056', {
      method: 'DELETE', cookie: memberCookie,
    });
    expect(crossArchive.status).toBe(404);

    const memberAppearance = await request('/api/v1/widget/settings', {
      method: 'PUT', cookie: memberCookie,
      body: { mode: 'solid', startColor: '#123ABC', endColor: '#123ABC' },
    });
    expect(memberAppearance.status).toBe(200);
    expect(await memberAppearance.json()).toMatchObject({ mode: 'solid', startColor: '#123ABC' });
    expect(await (await request('/api/v1/widget/settings', { cookie: ownerCookie })).json()).toMatchObject({
      mode: 'gradient', startColor: '#071426', endColor: '#0F766E',
    });

    const ownerWidgetToken = await revealWidgetToken(ownerCookie, OWNER_PASSWORD);
    const memberWidgetToken = await revealWidgetToken(memberCookie, USER_PASSWORD);
    expect(ownerWidgetToken).not.toBe(memberWidgetToken);
  });

  it('changes the password, revokes other sessions, and no longer accepts the old password', async () => {
    const created = await register('owner', OWNER_PASSWORD);
    const primaryCookie = created.cookie!;
    const secondLogin = await request('/api/v1/auth/login', {
      method: 'POST',
      body: { username: 'owner', password: OWNER_PASSWORD, remember: true },
    });
    expect(secondLogin.status).toBe(200);
    const secondaryCookie = sessionCookie(secondLogin);

    const changed = await request('/api/v1/auth/change-password', {
      method: 'POST', cookie: primaryCookie,
      body: { currentPassword: OWNER_PASSWORD, newPassword: 'new-owner-password-2026' },
    });
    expect(changed.status).toBe(200);
    expect((await request('/api/v1/auth/me', { cookie: primaryCookie })).status).toBe(200);
    expect((await request('/api/v1/auth/me', { cookie: secondaryCookie })).status).toBe(401);

    expect((await request('/api/v1/auth/login', {
      method: 'POST', body: { username: 'owner', password: OWNER_PASSWORD, remember: false },
    })).status).toBe(401);
    expect((await request('/api/v1/auth/login', {
      method: 'POST', body: { username: 'owner', password: 'new-owner-password-2026', remember: false },
    })).status).toBe(200);
  });

  it('lets an authenticated Google-only account establish its first local password exactly once', async () => {
    const seeded = await seedAuthenticatedUser(env.DB);
    const cookie = `dt_session=${seeded.sessionToken}`;
    expect(await (await request('/api/v1/auth/me', { cookie })).json()).toMatchObject({
      user: { hasPassword: false },
    });

    const established = await request('/api/v1/auth/set-password', {
      method: 'POST', cookie, body: { newPassword: 'google-local-password-2026' },
    });
    expect(established.status).toBe(200);
    expect(await (await request('/api/v1/auth/me', { cookie })).json()).toMatchObject({
      user: { hasPassword: true },
    });
    expect((await request('/api/v1/auth/set-password', {
      method: 'POST', cookie, body: { newPassword: 'another-local-password-2026' },
    })).status).toBe(409);
    expect((await request('/api/v1/auth/login', {
      method: 'POST',
      body: { username: 'test-owner', password: 'google-local-password-2026', remember: false },
    })).status).toBe(200);
  });

  it('uses the owner-controlled registration policy for password registration and config', async () => {
    const owner = await register('owner', OWNER_PASSWORD, false);
    expect(owner.response.status).toBe(201);
    const ownerCookie = owner.cookie!;

    const initialPolicy = await request('/api/v1/auth/registration-policy', {
      cookie: ownerCookie,
      allowRegistration: false,
    });
    expect(initialPolicy.status).toBe(200);
    expect(await initialPolicy.json()).toEqual({ allowRegistration: false, source: 'environment' });

    const closed = await request('/api/v1/auth/registration-policy', {
      method: 'PUT',
      cookie: ownerCookie,
      body: { allowRegistration: false },
      allowRegistration: true,
    });
    expect(closed.status).toBe(200);
    expect(await closed.json()).toEqual({ allowRegistration: false, source: 'database' });
    const storedPolicy = await env.DB.prepare(
      `SELECT setting_value, updated_by_user_id FROM application_settings WHERE setting_key = 'allow_registration'`,
    ).first<{ setting_value: string; updated_by_user_id: string | null }>();
    expect(storedPolicy).toMatchObject({ setting_value: 'false' });
    expect(storedPolicy?.updated_by_user_id).toMatch(/^usr_/);

    const configClosed = await request('/api/v1/auth/config', { allowRegistration: true });
    expect(await configClosed.json()).toMatchObject({ registrationEnabled: false, firstAccount: false });

    const denied = await register('member', USER_PASSWORD, true);
    expect(denied.response.status).toBe(403);
    expect(await denied.response.json()).toEqual({ error: '目前未開放新帳號註冊' });

    const reopened = await request('/api/v1/auth/registration-policy', {
      method: 'PUT',
      cookie: ownerCookie,
      body: { allowRegistration: true },
      allowRegistration: false,
    });
    expect(reopened.status).toBe(200);
    expect(await reopened.json()).toEqual({ allowRegistration: true, source: 'database' });

    const configReopened = await request('/api/v1/auth/config', { allowRegistration: false });
    expect(await configReopened.json()).toMatchObject({ registrationEnabled: true, firstAccount: false });

    const member = await register('member', USER_PASSWORD, false);
    expect(member.response.status).toBe(201);
    expect(await member.response.clone().json()).toMatchObject({ user: { role: 'user' } });

    const memberCookie = member.cookie!;
    const memberGet = await request('/api/v1/auth/registration-policy', {
      cookie: memberCookie,
      allowRegistration: false,
    });
    expect(memberGet.status).toBe(403);
    expect(await memberGet.json()).toEqual({ error: '僅限擁有者操作' });

    const memberPut = await request('/api/v1/auth/registration-policy', {
      method: 'PUT',
      cookie: memberCookie,
      body: { allowRegistration: false },
      allowRegistration: false,
    });
    expect(memberPut.status).toBe(403);
    expect(await memberPut.json()).toEqual({ error: '僅限擁有者操作' });

    const persisted = await request('/api/v1/auth/registration-policy', {
      cookie: ownerCookie,
      allowRegistration: false,
    });
    expect(await persisted.json()).toEqual({ allowRegistration: true, source: 'database' });
  });

  it('closes registration after the first account when configured private', async () => {
    expect((await register('owner', OWNER_PASSWORD, false)).response.status).toBe(201);
    const second = await register('member', USER_PASSWORD, false);
    expect(second.response.status).toBe(403);
    expect(await second.response.json()).toEqual({ error: '目前未開放新帳號註冊' });
  });
});
