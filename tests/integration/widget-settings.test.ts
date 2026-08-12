import { env, reset } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import worker from '../../worker/index';
import { applyMultiUserMigrations, seedAuthenticatedUser, sessionHeaders, testEnv, TEST_WIDGET_TOKEN } from '../helpers/multi-user';

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

beforeEach(async () => {
  await reset();
  await applyMultiUserMigrations(env.DB);
  await seedAuthenticatedUser(env.DB);
});

afterEach(() => reset());

describe('Widget background settings', () => {
  it('lets only the admin change the D1-backed custom background', async () => {
    const initial = await request('/api/v1/widget/settings', 'session');
    expect(initial.status).toBe(200);
    expect(await initial.json()).toMatchObject({
      theme: 'ocean', mode: 'gradient', startColor: '#071426', endColor: '#0F766E',
    });

    const denied = await request('/api/v1/widget/settings', 'widget');
    expect(denied.status).toBe(401);

    const updated = await request('/api/v1/widget/settings', 'session', {
      method: 'PUT',
      body: JSON.stringify({ mode: 'gradient', startColor: '#2E1065', endColor: '#BE123C' }),
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({
      theme: 'sunset', mode: 'gradient', startColor: '#2E1065', endColor: '#BE123C',
    });

    const custom = await request('/api/v1/widget/settings', 'session', {
      method: 'PUT',
      body: JSON.stringify({ mode: 'gradient', startColor: '#123abc', endColor: '#fedcba' }),
    });
    expect(custom.status).toBe(200);
    expect(await custom.json()).toMatchObject({
      theme: 'ocean', mode: 'gradient', startColor: '#123ABC', endColor: '#FEDCBA',
    });

    const solid = await request('/api/v1/widget/settings', 'session', {
      method: 'PUT',
      body: JSON.stringify({ mode: 'solid', startColor: '#abcdef', endColor: '#123456' }),
    });
    expect(solid.status).toBe(200);
    expect(await solid.json()).toMatchObject({
      mode: 'solid', startColor: '#ABCDEF', endColor: '#ABCDEF',
    });

    const recognizedPreset = await request('/api/v1/widget/settings', 'session', {
      method: 'PUT',
      body: JSON.stringify({ mode: 'gradient', startColor: '#052e16', endColor: '#166534' }),
    });
    expect(recognizedPreset.status).toBe(200);
    expect(await recognizedPreset.json()).toMatchObject({
      theme: 'forest', mode: 'gradient', startColor: '#052E16', endColor: '#166534',
    });

    const invalid = await request('/api/v1/widget/settings', 'session', {
      method: 'PUT',
      body: JSON.stringify({ theme: 'unknown' }),
    });
    expect(invalid.status).toBe(400);

    const invalidColor = await request('/api/v1/widget/settings', 'session', {
      method: 'PUT',
      body: JSON.stringify({ mode: 'gradient', startColor: 'red', endColor: '#123456' }),
    });
    expect(invalidColor.status).toBe(400);
  });

  it('returns the selected custom colors to Scriptable clients', async () => {
    await request('/api/v1/widget/settings', 'session', {
      method: 'PUT',
      body: JSON.stringify({ mode: 'gradient', startColor: '#102030', endColor: '#A0B0C0' }),
    });

    const current = await request('/api/v1/widget/current?year=2026&month=8', 'widget');
    expect(current.status).toBe(200);
    expect(await current.json()).toMatchObject({
      appearance: { mode: 'gradient', startColor: '#102030', endColor: '#A0B0C0' },
    });

    const upcoming = await request('/api/v1/widget/upcoming', 'widget');
    expect(upcoming.status).toBe(200);
    expect(await upcoming.json()).toMatchObject({
      appearance: { mode: 'gradient', startColor: '#102030', endColor: '#A0B0C0' },
    });
  });
});
