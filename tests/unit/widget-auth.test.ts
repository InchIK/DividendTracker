import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { requireAdmin, requireAnyAuth, type AuthEnv } from '../../worker/auth/bearer';

function authDb(): D1Database {
  return {
    prepare(sql: string) {
      const statement = {
        bind() { return statement; },
        async first() {
          if (sql.includes('FROM auth_sessions AS s') || sql.includes('FROM widget_credentials AS w')) {
            return {
              user_id: 'usr_test', username: 'tester', display_name: 'Tester',
              password_hash: 'unusable', password_salt: 'unusable', password_iterations: 100000,
              role: 'owner', account_status: 'active', created_at: '', updated_at: '',
            };
          }
          return null;
        },
      };
      return statement;
    },
  } as D1Database;
}

function app() {
  const value = new Hono<AuthEnv>();
  value.get('/widget', requireAnyAuth(), (c) => c.json({ method: c.get('authMethod') }));
  value.get('/admin', requireAdmin(), (c) => c.json({ method: c.get('authMethod') }));
  return value;
}

const env = { DB: authDb(), TOKEN_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' } as Env;

describe('Widget read-only authentication boundary', () => {
  it('allows both the web session and Scriptable token on widget data', async () => {
    const browser = await app().request('/widget', {
      headers: { Cookie: 'dt_session=browser-session' },
    }, env);
    const widget = await app().request('/widget', {
      headers: { Authorization: 'Bearer widget-read-only' },
    }, env);

    expect(await browser.json()).toEqual({ method: 'session' });
    expect(await widget.json()).toEqual({ method: 'widget' });
  });

  it('does not let the embedded Widget token access browser-only routes', async () => {
    const response = await app().request('/admin', {
      headers: { Authorization: 'Bearer widget-read-only' },
    }, env);
    expect(response.status).toBe(401);
  });
});
