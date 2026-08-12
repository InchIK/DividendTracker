import { env, reset } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import initialMigration from '../../migrations/0001_initial.sql?raw';
import dynamicMigration from '../../migrations/0002_dynamic_instruments_prices.sql?raw';
import fixture from '../fixtures/etfortune-dividend-list.html?raw';
import { ETFORTUNE_SOURCE_URL } from '../../worker/sources/twse-etfortune-html';
import { runEtfortuneYearlySync } from '../../worker/sync/run-etfortune-sync';
import { runSync } from '../../worker/sync/run-sync';

const observedAt = '2026-08-11T00:00:00.000Z';

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

function response(html: string, status = 200): Response {
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

async function counts(): Promise<{ events: number; observations: number; runs: number; statuses: number }> {
  const [events, observations, runs, statuses] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS count FROM dividend_events').first<{ count: number }>(),
    env.DB.prepare('SELECT COUNT(*) AS count FROM dividend_observations').first<{ count: number }>(),
    env.DB.prepare('SELECT COUNT(*) AS count FROM sync_runs').first<{ count: number }>(),
    env.DB.prepare('SELECT COUNT(*) AS count FROM source_status').first<{ count: number }>(),
  ]);
  return {
    events: events?.count ?? -1,
    observations: observations?.count ?? -1,
    runs: runs?.count ?? -1,
    statuses: statuses?.count ?? -1,
  };
}

function only0056(html: string): string {
  return html.replace(/\s*<tr>\s*<td>00878<\/td>[\s\S]*?<\/tr>/, '');
}

describe('selected-only e添富 yearly synchronization', () => {
  beforeEach(async () => {
    await reset();
    await applyMigration(env.DB, initialMigration);
    await applyMigration(env.DB, dynamicMigration);
  });

  it('reads enabled active nonarchived ETFs first and does no network or write for an empty selection', async () => {
    await env.DB.prepare('UPDATE watchlist SET enabled = 0').run();
    const fetchImpl = vi.fn();
    const before = await counts();

    const result = await runEtfortuneYearlySync(testEnv(), { fetchImpl, now: () => observedAt });

    expect(result).toEqual({
      outcome: 'empty_selection',
      selected: 0,
      selectedRows: 0,
      observationsApplied: 0,
      eventsChanged: 0,
      error: null,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await counts()).toEqual(before);
  });

  it('persists and hashes only selected ETF rows, with canonical parent data before observations', async () => {
    await env.DB.prepare(`UPDATE watchlist SET enabled = 0 WHERE instrument_id = 'twse:0050'`).run();
    await env.DB.prepare(`UPDATE instruments SET active = 0 WHERE instrument_id = 'twse:00878'`).run();
    await env.DB.prepare(
      `UPDATE watchlist SET archived_at = ? WHERE instrument_id = 'twse:00919'`,
    ).bind(observedAt).run();
    const fetchImpl = vi.fn(async () => response(fixture));

    const result = await runEtfortuneYearlySync(testEnv(), { fetchImpl, now: () => observedAt });

    expect(fetchImpl).toHaveBeenCalledWith(ETFORTUNE_SOURCE_URL, expect.objectContaining({ method: 'GET' }));
    expect(result).toMatchObject({
      outcome: 'success', selected: 1, selectedRows: 1,
      observationsApplied: 1, eventsChanged: 1, error: null,
    });
    expect(await env.DB.prepare(
      `SELECT event_key, instrument_id, pay_date, dividend_micros, canonical_source_kind,
              canonical_source_priority
       FROM dividend_events`,
    ).all()).toMatchObject({
      results: [{
        event_key: 'twse:0056:2026-07-21',
        instrument_id: 'twse:0056',
        pay_date: '2026-08-07',
        dividend_micros: 866_000,
        canonical_source_kind: 'etfortune_html',
        canonical_source_priority: 90,
      }],
    });
    const observation = await env.DB.prepare(
      `SELECT event_key, source_kind, pay_date, dividend_micros, raw_payload, payload_sha256
       FROM dividend_observations`,
    ).first<Record<string, string | number>>();
    expect(observation).toMatchObject({
      event_key: 'twse:0056:2026-07-21',
      source_kind: 'etfortune_html',
      pay_date: '2026-08-07',
      dividend_micros: 866_000,
    });
    expect(observation?.raw_payload).toContain('0056');
    expect(observation?.raw_payload).not.toContain('0050');
    expect(observation?.raw_payload).not.toContain('00878');
    expect(observation?.payload_sha256).toMatch(/^[a-f0-9]{64}$/);
    const status = await env.DB.prepare(
      `SELECT source_kind, status, last_http_status, last_payload_sha256, newest_source_date
       FROM source_status WHERE source_kind = 'etfortune_html'`,
    ).first<Record<string, string | number | null>>();
    expect(status).toMatchObject({
      source_kind: 'etfortune_html',
      status: 'ok',
      last_http_status: 200,
      newest_source_date: '2026-08-07',
      last_payload_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(status?.last_payload_sha256).not.toBe(observation?.payload_sha256);
  });

  it('rejects selected-empty/schema-drift/HTTP failures and preserves last-good rows', async () => {
    await env.DB.prepare(`UPDATE watchlist SET enabled = 0 WHERE instrument_id NOT IN ('twse:0056')`).run();
    await runEtfortuneYearlySync(testEnv(), {
      fetchImpl: async () => response(fixture),
      now: () => observedAt,
    });
    const before = await counts();

    for (const [html, status] of [
      [fixture.replace('<td>0056</td>', '<td>0050</td>'), 200],
      [fixture.replace('收益分配發放日', '付款日期'), 200],
      ['upstream unavailable', 503],
    ] as const) {
      const result = await runEtfortuneYearlySync(testEnv(), {
        fetchImpl: async () => response(html, status),
        now: () => '2026-08-12T00:00:00.000Z',
      });
      expect(result.outcome).toBe('rejected');
      expect(result.error).toEqual(expect.any(String));
      expect((await counts()).events).toBe(before.events);
      expect((await counts()).observations).toBe(before.observations);
    }

    expect(await env.DB.prepare(
      `SELECT status, last_success_at, error_message FROM source_status
       WHERE source_kind = 'etfortune_html'`,
    ).first()).toMatchObject({
      status: 'error',
      last_success_at: observedAt,
      error_message: expect.stringContaining('HTTP 503'),
    });
  });

  it('rejects a drop from prior selected yearly coverage without deleting old data', async () => {
    await env.DB.prepare(`UPDATE watchlist SET enabled = 0 WHERE instrument_id NOT IN ('twse:0056', 'twse:00878')`).run();
    await runEtfortuneYearlySync(testEnv(), {
      fetchImpl: async () => response(fixture),
      now: () => observedAt,
    });
    const before = await counts();

    const result = await runEtfortuneYearlySync(testEnv(), {
      fetchImpl: async () => response(only0056(fixture)),
      now: () => '2026-08-12T00:00:00.000Z',
    });

    expect(result).toMatchObject({ outcome: 'rejected', selectedRows: 1 });
    expect(result.error).toMatch(/abnormal drop/i);
    expect(await counts()).toMatchObject({ events: before.events, observations: before.observations });
  });

  it('keeps a locked official/manual canonical event while recording the selected fallback observation', async () => {
    await env.DB.prepare(`UPDATE watchlist SET enabled = 0 WHERE instrument_id NOT IN ('twse:0056')`).run();
    await env.DB.prepare(
      `INSERT INTO dividend_events
         (event_key, instrument_id, ex_date, base_date, pay_date, dividend_micros,
          status, canonical_source_kind, canonical_source_priority, manual_locked,
          manual_note, created_at, updated_at)
       VALUES ('twse:0056:2026-07-21', 'twse:0056', '2026-07-21', '2026-07-27',
               '2026-08-20', 999000, 'verified', 'manual_verified', 100, 1,
               'locked', ?, ?)`,
    ).bind(observedAt, observedAt).run();

    await runEtfortuneYearlySync(testEnv(), {
      fetchImpl: async () => response(fixture),
      now: () => observedAt,
    });

    expect(await env.DB.prepare(
      `SELECT pay_date, dividend_micros, canonical_source_kind, canonical_source_priority,
              manual_locked, manual_note
       FROM dividend_events WHERE event_key = 'twse:0056:2026-07-21'`,
    ).first()).toMatchObject({
      pay_date: '2026-08-20',
      dividend_micros: 999000,
      canonical_source_kind: 'manual_verified',
      canonical_source_priority: 100,
      manual_locked: 1,
      manual_note: 'locked',
    });
    expect(await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM dividend_observations
       WHERE source_kind = 'etfortune_html'`,
    ).first()).toEqual({ count: 1 });
  });

  it('is invoked by the low-frequency dividend sync and contributes run evidence', async () => {
    const runEtfortune = vi.fn(async () => ({
      outcome: 'success' as const,
      selected: 4,
      selectedRows: 2,
      observationsApplied: 2,
      eventsChanged: 1,
      error: null,
    }));
    const emptySource = {
      observations: [], rowsRead: 0, payloadSha256: 'selected-only',
      newestSourceDate: null, httpStatus: 200, error: null,
    };

    const result = await runSync(testEnv(), 'test', {
      runEtfortuneYearlySync: runEtfortune,
      runFinmindDividendSync: async () => ({
        outcome: 'empty_selection', selected: 0, rowsRead: 0,
        observationsApplied: 0, eventsChanged: 0, errors: [],
      }),
      fetchTwseFundMapping: async () => emptySource,
      fetchTwseExDividend: async () => emptySource,
      fetchSitcaDividendCsv: async () => emptySource,
    });

    expect(runEtfortune).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      status: 'success', etfortuneRows: 2,
      observationsApplied: 2, eventsChanged: 1,
    });
    expect(await env.DB.prepare('SELECT dividend_rows_read FROM sync_runs WHERE id = ?')
      .bind(result.runId).first()).toEqual({ dividend_rows_read: 2 });
  });
});
