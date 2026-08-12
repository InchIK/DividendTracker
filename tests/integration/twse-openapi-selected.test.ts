import { env, reset } from 'cloudflare:test';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import initialMigration from '../../migrations/0001_initial.sql?raw';
import dynamicMigration from '../../migrations/0002_dynamic_instruments_prices.sql?raw';
import { getSelectedFundMappings } from '../../worker/db/queries';
import { hashPayload } from '../../worker/domain/reconciliation';
import { fetchTwseExDividend } from '../../worker/sources/twse-ex-dividend';
import { fetchTwseFundMapping } from '../../worker/sources/twse-fund-mapping';

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

describe('TWSE OpenAPI selected-only adapters', () => {
  beforeEach(async () => {
    await reset();
    await applyMigration(env.DB, initialMigration);
    await applyMigration(env.DB, dynamicMigration);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('does not call TWSE when there is no enabled active watchlist ETF', async () => {
    await env.DB.prepare('UPDATE watchlist SET enabled = 0').run();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect((await fetchTwseFundMapping(testEnv())).rowsRead).toBe(0);
    expect((await fetchTwseExDividend(testEnv())).rowsRead).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('filters and hashes fund mappings before persistence evidence is returned', async () => {
    await env.DB.prepare(`UPDATE watchlist SET enabled = 0 WHERE instrument_id <> 'twse:0056'`).run();
    const selected = { 基金代號: '0056', 基金簡稱: '元大高股息', 基金統一編號: 'selected' };
    const unselected = { 基金代號: '00878', 基金簡稱: '國泰永續高股息', 基金統一編號: 'discarded' };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([selected, unselected]), { status: 200 })));

    const result = await fetchTwseFundMapping(testEnv());

    expect(result.observations.map((row) => row.code)).toEqual(['0056']);
    expect(result.payloadSha256).toBe(await hashPayload([selected]));
    expect(result.payloadSha256).not.toBe(await hashPayload([selected, unselected]));
  });

  it('passes only enabled active nonarchived TWSE ETF mappings to SITCA', async () => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO fund_mapping (
           instrument_id, fund_unified_no, fund_name, source_kind,
           source_observed_at, updated_at
         )
         SELECT instrument_id, 'fund-' || code, display_name, 'test',
                '2026-08-11T00:00:00.000Z', '2026-08-11T00:00:00.000Z'
         FROM instruments`,
      ),
      env.DB.prepare(`UPDATE watchlist SET enabled = 0 WHERE instrument_id = 'twse:0050'`),
      env.DB.prepare(
        `UPDATE watchlist SET archived_at = '2026-08-11T00:00:00.000Z'
         WHERE instrument_id = 'twse:00878'`,
      ),
      env.DB.prepare(`UPDATE instruments SET active = 0 WHERE instrument_id = 'twse:00919'`),
    ]);

    const mappings = await getSelectedFundMappings(env.DB);

    expect(mappings.map((mapping) => mapping.instrument_id)).toEqual(['twse:0056']);
  });

  it('filters ex-dividend rows and parses micros exactly without Number', async () => {
    await env.DB.prepare(`UPDATE watchlist SET enabled = 0 WHERE instrument_id <> 'twse:0056'`).run();
    const selected = { Date: '1150721', Code: '0056', Name: '元大高股息', CashDividend: '0.123456' };
    const unselected = { Date: '1150722', Code: '00878', Name: '國泰永續高股息', CashDividend: '9.9' };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([selected, unselected]), { status: 200 })));

    const result = await fetchTwseExDividend(testEnv());

    expect(result.observations).toHaveLength(1);
    expect(result.observations[0]).toMatchObject({ code: '0056', dividendMicros: 123456n });
    expect(result.payloadSha256).toBe(await hashPayload([selected]));
    expect(result.payloadSha256).not.toBe(await hashPayload([selected, unselected]));
  });

  it('includes a user-configured TWSE stock in the ex-dividend source', async () => {
    const now = '2026-08-11T00:00:00.000Z';
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO instruments (
           instrument_id, market, code, kind, display_name, active,
           metadata_source, metadata_observed_at, created_at, updated_at
         ) VALUES (?, 'twse', ?, 'stock', ?, 1, 'user_pending_validation', ?, ?, ?)`,
      ).bind('twse:2330', '2330', '台積電', now, now, now),
      env.DB.prepare(
        `INSERT INTO watchlist (
           instrument_id, current_shares, enabled, archived_at, created_at, updated_at
         ) VALUES (?, 1000, 1, NULL, ?, ?)`,
      ).bind('twse:2330', now, now),
      env.DB.prepare(`UPDATE watchlist SET enabled = 0 WHERE instrument_id <> 'twse:2330'`),
    ]);
    const stock = { Date: '1150721', Code: '2330', Name: '台積電', CashDividend: '5' };
    const unselected = { Date: '1150722', Code: '0056', Name: '元大高股息', CashDividend: '1' };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([stock, unselected]), { status: 200 })));

    const result = await fetchTwseExDividend(testEnv());

    expect(result.observations).toHaveLength(1);
    expect(result.observations[0]).toMatchObject({ code: '2330', dividendMicros: 5000000n });
    expect(result.payloadSha256).toBe(await hashPayload([stock]));
  });
});
