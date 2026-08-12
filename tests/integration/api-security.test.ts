import { env, reset } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import worker from '../../worker/index';
import { applyMultiUserMigrations, testEnv } from '../helpers/multi-user';

beforeEach(async () => {
  await reset();
  await applyMultiUserMigrations(env.DB);
});

function request(path: string, init: RequestInit = {}): Promise<Response> {
  return worker.fetch(
    new Request(`https://example.test${path}`, init),
    testEnv(env.DB),
  );
}

describe('API same-origin and cache policy', () => {
  it('allows same-origin mutations, rejects missing/cross-origin origins, and leaves GET open', async () => {
    const sameOrigin = await request('/api/v1/auth/register', {
      method: 'POST',
      headers: {
        Origin: 'https://example.test',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: 'security-owner',
        displayName: 'Security owner',
        password: 'security-owner-password-2026',
        remember: false,
      }),
    });
    expect(sameOrigin.status).toBe(201);

    const missingOrigin = await request('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'missing-origin',
        displayName: 'Missing origin',
        password: 'missing-origin-password-2026',
        remember: false,
      }),
    });
    expect(missingOrigin.status).toBe(403);

    const crossOrigin = await request('/api/v1/auth/register', {
      method: 'POST',
      headers: {
        Origin: 'https://attacker.example',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: 'cross-origin',
        displayName: 'Cross origin',
        password: 'cross-origin-password-2026',
        remember: false,
      }),
    });
    expect(crossOrigin.status).toBe(403);

    const config = await request('/api/v1/auth/config');
    expect(config.status).toBe(200);
  });

  it('marks sensitive API responses as non-cacheable and varies by credentials', async () => {
    const response = await request('/api/v1/auth/config');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    const vary = response.headers.get('Vary') ?? '';
    expect(vary).toContain('Cookie');
    expect(vary).toContain('Authorization');
  });
});
