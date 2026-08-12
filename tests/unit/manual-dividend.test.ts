import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { dividendRoutes } from '../../worker/routes/dividends';
import { buildWidgetResponse } from '../../worker/domain/widget-response';

interface StoredDividend {
  event_key: string;
  instrument_id: string;
  code: string;
  ex_date: string;
  base_date: string | null;
  pay_date: string | null;
  dividend_micros: number | null;
  eligible_shares_override: number | null;
  status: string;
  canonical_source_kind: string;
  canonical_source_priority: number;
  manual_locked: number;
  manual_note: string | null;
  owner_user_id: string | null;
  created_at: string;
  updated_at: string;
}

function manualDividendDb() {
  let stored: StoredDividend | null = null;

  const db = {
    prepare(sql: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...nextValues: unknown[]) {
          values = nextValues;
          return statement;
        },
        async first() {
          if (sql.includes('FROM auth_sessions AS s')) {
            return {
              user_id: 'usr_test', username: 'tester', display_name: 'Tester',
              password_hash: 'unusable', password_salt: 'unusable', password_iterations: 100000,
              role: 'owner', account_status: 'active', created_at: '', updated_at: '',
            };
          }
          if (sql.includes('FROM watchlist AS w') && sql.includes('i.instrument_id = ?')) {
            return {
              user_id: 'usr_test', instrument_id: 'twse:0056', market: 'twse', code: '0056',
              kind: 'etf', display_name: '元大高股息', active: 1, metadata_source: 'test',
              metadata_observed_at: null, current_shares: 1, enabled: 1, archived_at: null,
              created_at: '', updated_at: '',
            };
          }
          if (sql.includes('WHERE e.event_key = ?')) return stored;
          return null;
        },
        async run() {
          if (sql.includes('INSERT INTO dividend_events')) {
            const now = String(values[5]);
            stored = {
              event_key: String(values[0]), instrument_id: String(values[1]),
              code: String(values[1]).replace(/^twse:/, ''), ex_date: String(values[2]),
              base_date: null, pay_date: null, dividend_micros: null,
              eligible_shares_override: null, status: 'schedule_only',
              canonical_source_kind: 'manual_placeholder', canonical_source_priority: 0,
              manual_locked: 0, manual_note: null, owner_user_id: String(values[3]),
              created_at: now, updated_at: now,
            };
          }
          if (sql.includes('INSERT INTO user_dividend_overrides') && stored) {
            stored.base_date = values[2] as string | null;
            stored.pay_date = values[3] as string | null;
            stored.dividend_micros = values[4] as number | null;
            stored.eligible_shares_override = values[5] as number | null;
            stored.manual_locked = Number(values[6]);
            stored.manual_note = values[7] as string | null;
            stored.status = 'verified';
            stored.canonical_source_kind = 'manual_verified';
            stored.canonical_source_priority = 100;
          }
          return { success: true, meta: { changes: 1 } };
        },
      };
      return statement;
    },
  } as unknown as D1Database;

  return { db, getStored: () => stored };
}

function requestBody(dividendPerUnit: string) {
  return {
    instrumentId: 'twse:0056',
    exDate: '2026-08-11',
    payDate: '2026-09-11',
    dividendPerUnit,
  };
}

async function postManual(db: D1Database, dividendPerUnit: string) {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/', dividendRoutes);
  return app.request(
    '/api/v1/dividends/manual',
    {
      method: 'POST',
      headers: {
        Cookie: 'dt_session=test-session',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody(dividendPerUnit)),
    },
    {
      DB: db,
      TOKEN_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    } as Env,
  );
}

describe('manual dividend decimal parsing', () => {
  it('stores 0.000001 exactly as one micro', async () => {
    const fake = manualDividendDb();
    const response = await postManual(fake.db, '0.000001');

    expect(response.status).toBe(200);
    expect(fake.getStored()?.dividend_micros).toBe(1);
  });

  it('rejects values with more than six decimal places', async () => {
    const fake = manualDividendDb();
    const response = await postManual(fake.db, '1.0000001');

    expect(response.status).toBe(400);
    expect(fake.getStored()).toBeNull();
  });

  it('rejects malformed decimal input', async () => {
    const fake = manualDividendDb();
    const response = await postManual(fake.db, 'not-a-number');

    expect(response.status).toBe(400);
    expect(fake.getStored()).toBeNull();
  });
});

describe('widget decimal formatting', () => {
  it('keeps a one-micro dividend exact in item and display output', () => {
    const response = buildWidgetResponse(
      [{
        eventKey: '0056:2026-08-11',
        code: '0056',
        exDate: '2026-08-11',
        baseDate: null,
        payDate: '2026-08-20',
        dividendMicros: 1n,
        status: 'announced',
        canonicalSourceKind: 'sitca_open_data',
        canonicalSourcePriority: 80,
        manualLocked: false,
        manualNote: null,
      }],
      [{ code: '0056', displayName: '元大高股息', currentShares: 1, enabled: true }],
      2026,
      8,
    );

    expect(response.items[0]?.dividendPerUnit).toBe('0.000001');
    expect(response.items[0]?.estimatedGrossAmount).toBe('0.000001');
    expect(response.display.lines[0]).toContain('＝0.000001');
    expect(response.display.compact).toContain('0056 $0.000001');
  });

  it('returns the same seven core dashboard fields for a configured stock', () => {
    const response = buildWidgetResponse(
      [{
        eventKey: 'twse:2330:2026-06-11', instrumentId: 'twse:2330', code: '2330',
        exDate: '2026-06-11', baseDate: '2026-06-12', payDate: '2026-07-10',
        dividendMicros: 5_000_000n, status: 'announced',
        canonicalSourceKind: 'finmind_dividend', canonicalSourcePriority: 70,
        manualLocked: false, manualNote: null,
      }],
      [{
        instrumentId: 'twse:2330', market: 'twse', kind: 'stock', code: '2330',
        displayName: '台積電', currentShares: 100, enabled: true,
      }],
      2026,
      7,
      false,
      '2026-08-11T05:35:00.000Z',
      [{
        instrumentId: 'twse:2330', latestPriceMicros: '1010000000',
        previousCloseMicros: '1000000000', tradeDate: '2026-08-11',
        tradeTime: '13:30:00', status: 'complete', stale: false,
      }],
    );

    expect(response.items[0]).toMatchObject({
      instrumentId: 'twse:2330', kind: 'stock', code: '2330', payDate: '2026-07-10',
      shares: '100', dividendPerUnit: '5', estimatedGrossAmount: '500',
      previousClose: '1000', currentTrade: '1010',
    });
    expect(response.display.lines[0]).toContain('2330 2026-07-10｜100股 ×5＝500｜昨1000 今1010');
  });
});
