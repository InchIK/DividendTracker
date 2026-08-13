import { env, reset } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import worker from '../../worker/index';
import {
  applyMultiUserMigrations,
  seedAuthenticatedUser,
  seedMarketFixtures,
  sessionHeaders,
  testEnv,
  TEST_WIDGET_TOKEN,
} from '../helpers/multi-user';

interface SettingsBody {
  mode: 'solid' | 'gradient';
  startColor: string;
  endColor: string;
  sortMode: 'dividend_desc' | 'random' | 'price_desc' | 'featured';
  featuredInstrumentId: string | null;
  refreshMinutes: number;
}

const defaultSettings: SettingsBody = {
  mode: 'gradient',
  startColor: '#071426',
  endColor: '#0F766E',
  sortMode: 'dividend_desc',
  featuredInstrumentId: null,
  refreshMinutes: 180,
};

async function request(path: string, credential: 'session' | 'widget', init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (credential === 'session') {
    for (const [key, value] of Object.entries(sessionHeaders())) headers.set(key, value);
  } else {
    headers.set('Authorization', `Bearer ${TEST_WIDGET_TOKEN}`);
  }
  if (init?.body) headers.set('Content-Type', 'application/json');
  if ((init?.method ?? 'GET').toUpperCase() !== 'GET') headers.set('Origin', 'https://example.test');
  return worker.fetch(new Request(`https://example.test${path}`, { ...init, headers }), testEnv(env.DB));
}

async function putSettings(overrides: Partial<SettingsBody> = {}, credential: 'session' | 'widget' = 'session') {
  return request('/api/v1/widget/settings', credential, {
    method: 'PUT',
    body: JSON.stringify({ ...defaultSettings, ...overrides }),
  });
}

beforeEach(async () => {
  await reset();
  await applyMultiUserMigrations(env.DB);
  await seedAuthenticatedUser(env.DB);
  await seedMarketFixtures(env.DB);
});

afterEach(() => reset());

describe('Widget settings and preferences', () => {
  it('returns safe defaults and persists all four ordering modes and refresh settings', async () => {
    const initial = await request('/api/v1/widget/settings', 'session');
    expect(initial.status).toBe(200);
    expect(await initial.json()).toMatchObject({
      theme: 'ocean',
      ...defaultSettings,
    });

    for (const sortMode of ['dividend_desc', 'random', 'price_desc'] as const) {
      const response = await putSettings({ sortMode, refreshMinutes: 15 });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ sortMode, refreshMinutes: 15, featuredInstrumentId: null });
    }

    const featured = await putSettings({
      sortMode: 'featured',
      featuredInstrumentId: 'twse:0050',
      refreshMinutes: 1440,
    });
    expect(featured.status).toBe(200);
    expect(await featured.json()).toMatchObject({
      sortMode: 'featured', featuredInstrumentId: 'twse:0050', refreshMinutes: 1440,
    });

    const current = await request('/api/v1/widget/current?year=2026&month=8', 'widget');
    expect(current.status).toBe(200);
    expect(await current.json()).toMatchObject({
      appearance: {
        sortMode: 'featured', featuredInstrumentId: 'twse:0050', refreshMinutes: 1440,
      },
    });

    const upcoming = await request('/api/v1/widget/upcoming', 'widget');
    expect(upcoming.status).toBe(200);
    expect(await upcoming.json()).toMatchObject({
      appearance: {
        mode: 'gradient', startColor: '#071426', endColor: '#0F766E',
        sortMode: 'featured', featuredInstrumentId: 'twse:0050', refreshMinutes: 1440,
      },
    });
  });

  it('requires complete six-field bodies and rejects invalid preferences', async () => {
    const incomplete = await request('/api/v1/widget/settings', 'session', {
      method: 'PUT',
      body: JSON.stringify({ mode: 'gradient', startColor: '#123456', endColor: '#654321' }),
    });
    expect(incomplete.status).toBe(400);
    expect(await incomplete.json()).toMatchObject({ error: expect.stringContaining('完整') });

    for (const refreshMinutes of [14, 1441, 15.5]) {
      expect((await putSettings({ refreshMinutes })).status).toBe(400);
    }
    expect((await putSettings({ sortMode: 'invalid' as SettingsBody['sortMode'] })).status).toBe(400);
    expect((await putSettings({ sortMode: 'featured', featuredInstrumentId: null })).status).toBe(400);
    expect((await putSettings({ sortMode: 'featured', featuredInstrumentId: 'twse:does-not-exist' })).status).toBe(400);

    await env.DB.prepare('UPDATE watchlist SET enabled = 0 WHERE user_id = ? AND instrument_id = ?')
      .bind('usr_test_owner', 'twse:0056').run();
    expect((await putSettings({ sortMode: 'featured', featuredInstrumentId: 'twse:0056' })).status).toBe(400);

    await env.DB.prepare(
      `INSERT INTO users (
         user_id, username, display_name, password_hash, password_salt,
         password_iterations, role, account_status, created_at, updated_at
       ) VALUES ('usr_other', 'other-user', 'Other', 'unusable', 'unusable', 100000, 'user', 'active', ?, ?)`
    ).bind(new Date().toISOString(), new Date().toISOString()).run();
    await env.DB.prepare(
      `INSERT INTO instruments (
         instrument_id, market, code, kind, display_name, active, created_at, updated_at
       ) VALUES ('twse:00999', 'twse', '00999', 'stock', 'Other instrument', 1, ?, ?)`
    ).bind(new Date().toISOString(), new Date().toISOString()).run();
    await env.DB.prepare(
      `INSERT INTO watchlist (user_id, instrument_id, current_shares, enabled, created_at, updated_at)
       VALUES ('usr_other', 'twse:00999', 0, 1, ?, ?)`
    ).bind(new Date().toISOString(), new Date().toISOString()).run();
    expect((await putSettings({ sortMode: 'featured', featuredInstrumentId: 'twse:00999' })).status).toBe(400);
  });

  it('does not allow a Widget credential to mutate settings', async () => {
    const denied = await putSettings({ refreshMinutes: 60 }, 'widget');
    expect(denied.status).toBe(401);
  });
});
