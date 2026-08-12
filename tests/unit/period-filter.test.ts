import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { getCurrentPeriodInTaipei, yearMonthPrefix } from '../../worker/domain/date';
import { PeriodFilterError, parsePeriodFilter } from '../../worker/domain/period-filter';
import { dashboardRoutes } from '../../worker/routes/dashboard';
import { dividendRoutes } from '../../worker/routes/dividends';

function emptyDb(): D1Database {
  return {
    prepare(sql: string) {
      const statement = {
        bind() {
          return statement;
        },
        async all() {
          return { results: [], success: true, meta: {} };
        },
        async first() {
          if (sql.includes('FROM auth_sessions AS s')) {
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
  };
}

function routeApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/', dashboardRoutes);
  app.route('/', dividendRoutes);
  return app;
}

const env = {
  DB: emptyDb(),
  TOKEN_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
} as Env;
const auth = { Cookie: 'dt_session=test-session' };

describe('parsePeriodFilter', () => {
  it('formats a year and month as YYYY-MM', () => {
    expect(parsePeriodFilter('2026', '8', false)).toEqual({
      prefix: '2026-08',
      period: { year: 2026, month: 8 },
    });
  });

  it('formats a year-only filter as YYYY-', () => {
    expect(parsePeriodFilter('2026', undefined, true)).toEqual({
      prefix: '2026-',
      period: { year: 2026, month: null },
    });
  });

  it('formats a valid year, month and day as an exact pay-date filter', () => {
    expect(parsePeriodFilter('2026', '8', false, '11')).toEqual({
      prefix: '2026-08-11',
      period: { year: 2026, month: 8, day: 11 },
    });
  });

  it.each([
    ['2026', undefined, '11'],
    ['2026', '2', '29'],
    ['2026', '8', '32'],
  ])('rejects an invalid day filter (%s, %s, %s)', (year, month, day) => {
    expect(() => parsePeriodFilter(year, month, false, day)).toThrow(PeriodFilterError);
  });

  it('defaults no parameters to the current Taipei month when requested', () => {
    const current = getCurrentPeriodInTaipei();
    expect(parsePeriodFilter(undefined, undefined, true)).toEqual({
      prefix: yearMonthPrefix(current.year, current.month),
      period: current,
    });
  });

  it('defaults no parameters to all time when current-month defaulting is disabled', () => {
    expect(parsePeriodFilter(undefined, undefined, false)).toEqual({
      prefix: null,
      period: null,
    });
  });

  it.each([
    [undefined, '8'],
    ['20x6', undefined],
    ['2026', '0'],
    ['2026', '13'],
    ['1911', undefined],
  ])('rejects invalid year/month input (%s, %s)', (year, month) => {
    expect(() => parsePeriodFilter(year, month, false)).toThrow(PeriodFilterError);
  });
});

describe('period-aware routes', () => {
  it.each([
    '/api/v1/dividends?month=8',
    '/api/v1/dividends?year=2026&month=13',
    '/api/v1/dashboard?month=8',
    '/api/v1/dashboard?year=nope',
    '/api/v1/dashboard?year=2026&month=2&day=29',
  ])('returns 400 for an invalid period: %s', async (path) => {
    const response = await routeApp().request(path, { headers: auth }, env);
    expect(response.status).toBe(400);
  });

  it('returns an annual period for a dashboard year-only query', async () => {
    const response = await routeApp().request('/api/v1/dashboard?year=2026', { headers: auth }, env);
    expect(response.status).toBe(200);
    expect((await response.json()).period).toEqual({ year: 2026, month: null });
  });

  it('returns a daily period for an exact dashboard pay-date query', async () => {
    const response = await routeApp().request(
      '/api/v1/dashboard?year=2026&month=8&day=11',
      { headers: auth },
      env,
    );
    expect(response.status).toBe(200);
    expect((await response.json()).period).toEqual({ year: 2026, month: 8, day: 11 });
  });

  it.each(['/api/v1/dashboard?scope=all', '/api/v1/dashboard?all=1'])(
    'returns an all-time period for %s',
    async (path) => {
      const response = await routeApp().request(path, { headers: auth }, env);
      expect(response.status).toBe(200);
      expect((await response.json()).period).toBeNull();
    },
  );
});
