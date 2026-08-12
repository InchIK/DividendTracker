import { env, reset } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import initialMigration from '../../migrations/0001_initial.sql?raw';
import dynamicMigration from '../../migrations/0002_dynamic_instruments_prices.sql?raw';
import {
  persistPriceSnapshots,
  runPriceSync,
  type PriceSyncDependencies,
  type PriceSyncSnapshot,
} from '../../worker/sync/run-price-sync';
import type { NormalizedPriceRecord, PriceAdapterResult } from '../../worker/sources/twse-prices';

const observedAt = '2026-08-11T06:00:00.000Z';

async function applyMigration(db: D1Database, sql: string): Promise<void> {
  for (const statement of sql.split(';').map((part) => part.trim()).filter(Boolean)) {
    if (statement.startsWith('PRAGMA ')) continue;
    await db.prepare(statement).run();
  }
}

function testEnv(): Env {
  return {
    DB: env.DB,
    APP_TIMEZONE: 'Asia/Taipei',
    SITCA_DIVIDEND_CSV_URL: 'https://example.test/sitca.csv',
    TWSE_FUND_MAPPING_URL: 'https://example.test/funds.json',
    TWSE_EX_DIVIDEND_URL: 'https://example.test/dividends.json',
  };
}

function result(records: NormalizedPriceRecord[], outcome: PriceAdapterResult['outcome'] = 'ok'): PriceAdapterResult {
  return { outcome, records, httpStatus: outcome === 'ok' ? 200 : null, error: null };
}

function record(
  instrumentId: string,
  source: string,
  overrides: Partial<NormalizedPriceRecord> = {},
): NormalizedPriceRecord {
  return {
    instrumentId,
    priceMicros: null,
    previousCloseMicros: null,
    tradeDate: '2026-08-11',
    tradeTime: null,
    marketState: 'closed',
    status: 'partial',
    source,
    observedAt,
    stale: false,
    errorMessage: null,
    rawPayload: { instrumentId, source },
    ...overrides,
  };
}

function dependencies(overrides: Partial<PriceSyncDependencies> = {}): Partial<PriceSyncDependencies> {
  return {
    now: () => observedAt,
    previousTradingDate: () => '2026-08-10',
    fetchTwsePrices: async () => result([]),
    fetchTpexPrices: async () => result([]),
    fetchTwstockRealtimePrices: async () => result([]),
    ...overrides,
  };
}

async function setOnlySelected(instrumentId: string): Promise<void> {
  await env.DB.prepare('UPDATE watchlist SET enabled = 0').run();
  await env.DB.prepare('UPDATE watchlist SET enabled = 1 WHERE instrument_id = ?').bind(instrumentId).run();
}

async function latest(instrumentId: string): Promise<Record<string, string | number | null> | null> {
  return env.DB.prepare('SELECT * FROM latest_prices WHERE instrument_id = ?').bind(instrumentId).first();
}

describe('hourly selected-instrument price synchronization', () => {
  beforeEach(async () => {
    await reset();
    await applyMigration(env.DB, initialMigration);
    await applyMigration(env.DB, dynamicMigration);
  });

  it('returns explicit empty_selection without network or writes', async () => {
    await env.DB.prepare('UPDATE watchlist SET enabled = 0').run();
    const fetchTwsePrices = vi.fn();
    const fetchTpexPrices = vi.fn();
    const fetchTwstockRealtimePrices = vi.fn();
    const persist = vi.fn();

    const sync = await runPriceSync(testEnv(), dependencies({
      fetchTwsePrices,
      fetchTpexPrices,
      fetchTwstockRealtimePrices,
      persistPriceSnapshots: persist,
    }));

    expect(sync).toEqual({
      outcome: 'empty_selection',
      selected: 0,
      persisted: 0,
      complete: 0,
      partial: 0,
      stale: 0,
      errors: [],
      sources: {},
    });
    expect(fetchTwsePrices).not.toHaveBeenCalled();
    expect(fetchTpexPrices).not.toHaveBeenCalled();
    expect(fetchTwstockRealtimePrices).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

  it('excludes disabled, inactive, and archived instruments before market fetches and writes', async () => {
    await env.DB.prepare(`UPDATE watchlist SET enabled = 0 WHERE instrument_id = 'twse:0056'`).run();
    await env.DB.prepare(`UPDATE instruments SET active = 0 WHERE instrument_id = 'twse:00878'`).run();
    await env.DB.prepare(
      `UPDATE watchlist SET archived_at = '2026-08-01T00:00:00.000Z' WHERE instrument_id = 'twse:00919'`,
    ).run();
    const fetchTwsePrices = vi.fn(async () => result([
      record('twse:0050', 'twse_stock_day_all', { previousCloseMicros: 201_123_456n }),
      record('twse:0056', 'twse_stock_day_all', { previousCloseMicros: 99_000_000n }),
    ]));
    const fetchTpexPrices = vi.fn();

    const sync = await runPriceSync(testEnv(), dependencies({ fetchTwsePrices, fetchTpexPrices }));

    expect(fetchTwsePrices).toHaveBeenCalledWith(
      new Set(['twse:0050']),
      expect.any(Function),
      expect.objectContaining({ observedAt, tradeDate: '2026-08-10' }),
    );
    expect(fetchTpexPrices).not.toHaveBeenCalled();
    expect(sync.selected).toBe(1);
    expect(sync.persisted).toBe(1);
    expect(await env.DB.prepare('SELECT instrument_id FROM latest_prices').all()).toMatchObject({
      results: [{ instrument_id: 'twse:0050' }],
    });
    expect(await env.DB.prepare('SELECT DISTINCT instrument_id FROM price_observations').all()).toMatchObject({
      results: [{ instrument_id: 'twse:0050' }],
    });
  });

  it('fetches selected markets and keyless twstock realtime as a complete result', async () => {
    await setOnlySelected('twse:0050');
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO instruments
           (instrument_id, market, code, kind, display_name, active, created_at, updated_at)
         VALUES ('tpex:6488', 'tpex', '6488', 'stock', '環球晶', 1, ?, ?)`,
      ).bind(observedAt, observedAt),
      env.DB.prepare(
        `INSERT INTO watchlist
           (instrument_id, current_shares, enabled, archived_at, created_at, updated_at)
         VALUES ('tpex:6488', 1, 1, NULL, ?, ?)`,
      ).bind(observedAt, observedAt),
    ]);
    const fetchTwsePrices = vi.fn(async () => result([
      record('twse:0050', 'twse_stock_day_all', { previousCloseMicros: 200_500_001n }),
    ]));
    const fetchTpexPrices = vi.fn(async () => result([
      record('tpex:6488', 'tpex_mainboard_quotes', { previousCloseMicros: 450_000_001n }),
    ]));
    const fetchTwstockRealtimePrices = vi.fn(async (ids: ReadonlySet<string>) => {
      void ids;
      return result([
        record('twse:0050', 'twstock_twse_mis', {
          priceMicros: 201_000_001n,
          previousCloseMicros: 1n,
          tradeTime: '13:30:00',
          status: 'complete',
        }),
        record('tpex:6488', 'twstock_twse_mis', {
          priceMicros: 451_000_001n,
          previousCloseMicros: 1n,
          tradeTime: '13:30:00',
          status: 'complete',
        }),
      ]);
    });

    const sync = await runPriceSync(testEnv(), dependencies({
      fetchTwsePrices,
      fetchTpexPrices,
      fetchTwstockRealtimePrices,
    }));

    expect(fetchTwsePrices.mock.calls[0]?.[0]).toEqual(new Set(['twse:0050']));
    expect(fetchTpexPrices.mock.calls[0]?.[0]).toEqual(new Set(['tpex:6488']));
    expect(fetchTwstockRealtimePrices.mock.calls[0]?.[0]).toEqual(new Set(['twse:0050', 'tpex:6488']));
    expect(sync).toMatchObject({ outcome: 'success', selected: 2, persisted: 2, complete: 2, partial: 0 });
    expect(sync.sources).toMatchObject({ twstock_twse_mis: 'ok' });
    expect(await latest('twse:0050')).toMatchObject({
      price_micros: 201_000_001,
      previous_close_micros: 200_500_001,
      status: 'complete',
      source: 'twstock_twse_mis+twse_stock_day_all',
    });
  });

  it('merges live twstock price with the exact official previous trading close by instrument ID', async () => {
    await setOnlySelected('twse:0050');

    const sync = await runPriceSync(testEnv(), dependencies({
      fetchTwsePrices: async () => result([
        record('twse:0050', 'twse_stock_day_all', {
          previousCloseMicros: 200_500_001n,
          tradeDate: '2026-08-10',
        }),
      ]),
      fetchTwstockRealtimePrices: async () => result([
        record('twse:0050', 'twstock_twse_mis', {
          priceMicros: 201_123_456n,
          previousCloseMicros: 999_999_999n,
          tradeDate: '2026-08-11',
          tradeTime: '13:30:00',
          marketState: 'trading',
          status: 'complete',
        }),
      ]),
    }));

    expect(sync).toMatchObject({ outcome: 'success', complete: 1, partial: 0, persisted: 1 });
    expect(await latest('twse:0050')).toMatchObject({
      price_micros: 201_123_456,
      previous_close_micros: 200_500_001,
      trade_date: '2026-08-11',
      trade_time: '13:30:00',
      status: 'complete',
      source: 'twstock_twse_mis+twse_stock_day_all',
    });
  });

  it('retains last-good non-null values while marking a no-trade or halt stale', async () => {
    await setOnlySelected('twse:0050');
    await env.DB.prepare(
      `INSERT INTO latest_prices
         (instrument_id, price_micros, previous_close_micros, trade_date, trade_time,
          market_state, status, source, observed_at, stale, error_message, updated_at)
       VALUES ('twse:0050', 201000001, 200000001, '2026-08-10', '13:30:00',
               'closed', 'complete', 'last_good', '2026-08-10T05:30:00.000Z', 0, NULL,
               '2026-08-10T05:30:00.000Z')`,
    ).run();

    await runPriceSync(testEnv(), dependencies({
      fetchTwsePrices: async () => result([
        record('twse:0050', 'twse_stock_day_all', {
          previousCloseMicros: null,
          marketState: 'no_trade',
          status: 'not_covered',
          errorMessage: 'No official close was published',
        }),
      ]),
      fetchTwstockRealtimePrices: async () => result([
        record('twse:0050', 'twstock_twse_mis', {
          priceMicros: null,
          previousCloseMicros: null,
          marketState: 'halted',
          status: 'not_covered',
          errorMessage: 'Trading is halted',
        }),
      ]),
    }));

    expect(await latest('twse:0050')).toMatchObject({
      price_micros: 201000001,
      previous_close_micros: 200000001,
      trade_date: '2026-08-10',
      trade_time: '13:30:00',
      market_state: 'halted',
      status: 'stale',
      stale: 1,
      error_message: expect.stringContaining('Trading is halted'),
    });
  });

  it('counts selected instruments on source failure, writes explainable error state, and preserves last-good values', async () => {
    await setOnlySelected('twse:0050');
    await env.DB.prepare(
      `INSERT INTO latest_prices
         (instrument_id, price_micros, previous_close_micros, trade_date, trade_time,
          market_state, status, source, observed_at, stale, updated_at)
       VALUES ('twse:0050', 201000001, 200000001, '2026-08-10', '13:30:00',
               'closed', 'complete', 'last_good', '2026-08-10T05:30:00.000Z', 0,
               '2026-08-10T05:30:00.000Z')`,
    ).run();

    const sync = await runPriceSync(testEnv(), dependencies({
      fetchTwsePrices: async () => ({
        outcome: 'http_error',
        records: [],
        httpStatus: 503,
        error: 'TWSE returned HTTP 503',
      }),
    }));

    expect(sync).toMatchObject({ outcome: 'failed', selected: 1, persisted: 1, complete: 0, errors: [expect.stringContaining('503')] });
    expect(sync.selected).not.toBe(0);
    expect(await latest('twse:0050')).toMatchObject({
      price_micros: 201000001,
      previous_close_micros: 200000001,
      trade_date: '2026-08-10',
      trade_time: '13:30:00',
      market_state: 'unknown',
      status: 'error',
      stale: 1,
      source: 'twse_stock_day_all',
      error_message: 'TWSE returned HTTP 503',
      observed_at: observedAt,
    });
    const observation = await env.DB.prepare(
      `SELECT http_status, status, raw_payload, payload_sha256
       FROM price_observations WHERE instrument_id = 'twse:0050'`,
    ).first<Record<string, string | number>>();
    expect(observation).toMatchObject({ http_status: 503, status: 'error' });
    expect(observation?.raw_payload).toContain('twse:0050');
    expect(observation?.raw_payload.length).toBeLessThanOrEqual(16_384);
    expect(observation?.payload_sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rolls back every observation and latest-price upsert when any statement in the D1 batch fails', async () => {
    const valid: PriceSyncSnapshot = {
      instrumentId: 'twse:0050',
      priceMicros: 201_000_001n,
      previousCloseMicros: 200_000_001n,
      tradeDate: '2026-08-11',
      tradeTime: '13:30:00',
      marketState: 'trading',
      status: 'complete',
      source: 'test',
      httpStatus: 200,
      observedAt,
      stale: false,
      errorMessage: null,
      rawPayload: { instrumentId: 'twse:0050' },
    };
    const invalid = { ...valid, instrumentId: 'twse:0056', status: 'invalid' } as unknown as PriceSyncSnapshot;

    await expect(persistPriceSnapshots(env.DB, [valid, invalid], observedAt)).rejects.toThrow();

    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM price_observations').first()).toEqual({ count: 0 });
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM latest_prices').first()).toEqual({ count: 0 });
  });

  it('keeps repeated unchanged market payloads idempotent while refreshing latest_prices', async () => {
    const first: PriceSyncSnapshot = {
      instrumentId: 'twse:0050', priceMicros: 201_000_001n,
      previousCloseMicros: 200_000_001n, tradeDate: '2026-08-11',
      tradeTime: '13:30:00', marketState: 'closed', status: 'complete',
      source: 'twstock_twse_mis+twse_stock_day_all', httpStatus: 200,
      observedAt: '2026-08-11T06:00:00.000Z', stale: false,
      errorMessage: null, rawPayload: { unchanged: true },
    };
    const second = { ...first, observedAt: '2026-08-11T07:00:00.000Z' };

    await persistPriceSnapshots(env.DB, [first], first.observedAt);
    await persistPriceSnapshots(env.DB, [second], second.observedAt);

    expect(await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM price_observations WHERE instrument_id = 'twse:0050'`,
    ).first()).toEqual({ count: 1 });
    expect(await latest('twse:0050')).toMatchObject({
      observed_at: '2026-08-11T07:00:00.000Z',
      price_micros: 201_000_001,
      previous_close_micros: 200_000_001,
    });
  });
});
