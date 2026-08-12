import { env, reset } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import worker from '../../worker/index';
import { applyMultiUserMigrations, seedAuthenticatedUser, seedMarketFixtures, sessionHeaders, testEnv } from '../helpers/multi-user';

function request(headers?: HeadersInit): Promise<Response> {
  return worker.fetch(
    new Request('https://example.test/api/v1/prices', { headers }),
    testEnv(env.DB),
  );
}

async function insertPrice(instrumentId: string, values: {
  priceMicros?: string | null;
  previousCloseMicros?: string | null;
  marketState: 'trading' | 'closed' | 'halted' | 'no_trade' | 'unknown';
  status: 'complete' | 'partial' | 'not_covered' | 'stale' | 'error';
  stale?: 0 | 1;
  errorMessage?: string | null;
}): Promise<void> {
  const price = values.priceMicros === undefined ? 'NULL' : values.priceMicros;
  const previousClose = values.previousCloseMicros === undefined ? 'NULL' : values.previousCloseMicros;
  await env.DB.prepare(
    `INSERT INTO latest_prices
       (instrument_id, price_micros, previous_close_micros, trade_date, trade_time,
        market_state, status, source, observed_at, stale, error_message, updated_at)
     VALUES (?, ${price}, ${previousClose}, '2026-08-11', '13:30:00', ?, ?, 'twse_openapi',
             '2026-08-11T05:31:00.000Z', ?, ?, '2026-08-11T05:31:00.000Z')`,
  ).bind(instrumentId, values.marketState, values.status, values.stale ?? 0, values.errorMessage ?? null).run();
}

describe('admin prices route', () => {
  beforeEach(async () => {
    await reset();
    await applyMultiUserMigrations(env.DB);
    await seedAuthenticatedUser(env.DB);
    await seedMarketFixtures(env.DB);
  });

  it('requires a browser session', async () => {
    const response = await request();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: '請先登入' });
  });

  it('returns only unarchived watchlist instruments and preserves exact micros as strings', async () => {
    await insertPrice('twse:0050', {
      priceMicros: '9007199254740993',
      previousCloseMicros: '9007199254740001',
      marketState: 'trading',
      status: 'complete',
    });
    await env.DB.prepare(
      `UPDATE watchlist SET archived_at = '2026-08-11T00:00:00.000Z' WHERE instrument_id = 'twse:0056'`,
    ).run();
    await insertPrice('twse:0056', {
      priceMicros: '1000000',
      previousCloseMicros: '900000',
      marketState: 'closed',
      status: 'complete',
    });
    await env.DB.prepare(
      `INSERT INTO instruments
         (instrument_id, market, code, kind, display_name, active, metadata_source, created_at, updated_at)
       VALUES ('twse:2330', 'twse', '2330', 'stock', '台積電', 1, 'test', datetime('now'), datetime('now'))`,
    ).run();
    await insertPrice('twse:2330', {
      priceMicros: '123000000',
      previousCloseMicros: '122000000',
      marketState: 'closed',
      status: 'complete',
    });

    const response = await request(sessionHeaders());
    const body = await response.json<{ items: Record<string, unknown>[] }>();

    expect(response.status).toBe(200);
    expect(body.items.map((item) => item.instrumentId)).toEqual(['twse:0050', 'twse:00878', 'twse:00919']);
    expect(body.items[0]).toEqual({
      instrumentId: 'twse:0050',
      code: '0050',
      displayName: '元大台灣50',
      latestPriceMicros: '9007199254740993',
      previousCloseMicros: '9007199254740001',
      tradeDate: '2026-08-11',
      tradeTime: '13:30:00',
      marketState: 'trading',
      status: 'complete',
      source: 'twse_openapi',
      observedAt: '2026-08-11T05:31:00.000Z',
      stale: false,
      errorMessage: null,
    });
  });

  it('represents missing, stale, and source-error states without inventing prices', async () => {
    await insertPrice('twse:00878', {
      priceMicros: '24560000',
      previousCloseMicros: '24600000',
      marketState: 'closed',
      status: 'stale',
      stale: 1,
    });
    await insertPrice('twse:00919', {
      marketState: 'unknown',
      status: 'error',
      errorMessage: 'upstream timeout',
    });

    const response = await request(sessionHeaders());
    const body = await response.json<{ items: Record<string, unknown>[] }>();
    const byId = Object.fromEntries(body.items.map((item) => [item.instrumentId, item]));

    expect(response.status).toBe(200);
    expect(byId['twse:0050']).toMatchObject({
      latestPriceMicros: null,
      previousCloseMicros: null,
      tradeDate: null,
      tradeTime: null,
      marketState: null,
      status: null,
      source: null,
      observedAt: null,
      stale: false,
      errorMessage: null,
    });
    expect(byId['twse:00878']).toMatchObject({
      latestPriceMicros: '24560000',
      previousCloseMicros: '24600000',
      status: 'stale',
      stale: true,
      errorMessage: null,
    });
    expect(byId['twse:00919']).toMatchObject({
      latestPriceMicros: null,
      previousCloseMicros: null,
      marketState: 'unknown',
      status: 'error',
      stale: false,
      errorMessage: 'upstream timeout',
    });
  });
});
