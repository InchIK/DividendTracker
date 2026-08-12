import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import initialMigration from '../../migrations/0001_initial.sql?raw';
import dynamicMigration from '../../migrations/0002_dynamic_instruments_prices.sql?raw';

async function applyMigration(db: D1Database, sql: string): Promise<void> {
  for (const statement of sql.split(';').map((part) => part.trim()).filter(Boolean)) {
    if (statement.startsWith('PRAGMA ')) continue;
    await db.prepare(statement).run();
  }
}

async function expectConstraint(statement: D1PreparedStatement): Promise<void> {
  await expect(statement.run()).rejects.toThrow();
}

describe('0002 dynamic instruments and prices migration', () => {
  it('preserves holdings and dividend evidence while enforcing identity, archive, FK, and price invariants', async () => {
    const db = env.DB;
    await applyMigration(db, initialMigration);

    await db.batch([
      db.prepare(
        `UPDATE portfolio
         SET current_shares = 7450, display_name = '保留的0056名稱', enabled = 0,
             updated_at = '2026-08-11T01:02:03.000Z'
         WHERE code = '0056'`,
      ),
      db.prepare(
        `UPDATE portfolio SET current_shares = 12345 WHERE code = '0050'`,
      ),
      db.prepare(
        `INSERT INTO fund_mapping
           (code, fund_unified_no, fund_name, source_kind, source_observed_at, updated_at)
         VALUES
           ('0056', 'FUND-0056', '來源基金名稱', 'twse_fund_mapping',
            '2026-08-10T01:00:00.000Z', '2026-08-10T01:00:01.000Z')`,
      ),
      db.prepare(
        `INSERT INTO dividend_events
           (event_key, code, ex_date, base_date, pay_date, dividend_micros,
            eligible_shares_override, status, canonical_source_kind,
            canonical_source_priority, manual_locked, manual_note, created_at, updated_at)
         VALUES
           ('0056:2026-07-16', '0056', '2026-07-16', '2026-07-17', '2026-08-08',
            1070000, 7000, 'verified', 'manual_verified', 100, 1, '保留人工鎖定',
            '2026-07-01T00:00:00.000Z', '2026-07-02T00:00:00.000Z')`,
      ),
      db.prepare(
        `INSERT INTO dividend_observations
           (observation_key, event_key, source_kind, source_priority, source_url,
            ex_date, base_date, pay_date, dividend_micros, source_observed_at,
            payload_sha256, raw_payload, created_at)
         VALUES
           ('obs-0056-20260716', '0056:2026-07-16', 'sitca_open_data', 80,
            'https://example.test/0056', '2026-07-16', '2026-07-17', '2026-08-08',
            1070000, '2026-07-01T12:00:00.000Z', 'seed-sha',
            '{"code":"0056","amount":"1.07"}', '2026-07-01T12:00:01.000Z')`,
      ),
    ]);

    await applyMigration(db, dynamicMigration);

    const tables = await db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name IN
           ('instruments', 'watchlist', 'fund_mapping', 'dividend_events',
            'dividend_observations', 'latest_prices', 'price_observations')`,
      )
      .all<{ name: string }>();
    expect(new Set(tables.results.map((row) => row.name))).toEqual(
      new Set([
        'instruments',
        'watchlist',
        'fund_mapping',
        'dividend_events',
        'dividend_observations',
        'latest_prices',
        'price_observations',
      ]),
    );

    expect(await db.prepare('SELECT COUNT(*) AS count FROM instruments').first<{ count: number }>())
      .toEqual({ count: 4 });
    expect(await db.prepare('SELECT COUNT(*) AS count FROM watchlist').first<{ count: number }>())
      .toEqual({ count: 4 });
    expect(await db.prepare('SELECT COUNT(*) AS count FROM dividend_events').first<{ count: number }>())
      .toEqual({ count: 1 });
    expect(await db.prepare('SELECT COUNT(*) AS count FROM dividend_observations').first<{ count: number }>())
      .toEqual({ count: 1 });

    const holding = await db
      .prepare(
        `SELECT i.instrument_id, i.market, i.code, i.kind, i.display_name,
                w.current_shares, w.enabled, w.created_at, w.updated_at
         FROM instruments i JOIN watchlist w USING (instrument_id)
         WHERE i.instrument_id = 'twse:0056'`,
      )
      .first<Record<string, string | number>>();
    expect(holding).toMatchObject({
      instrument_id: 'twse:0056',
      market: 'twse',
      code: '0056',
      kind: 'etf',
      display_name: '保留的0056名稱',
      current_shares: 7450,
      enabled: 0,
      updated_at: '2026-08-11T01:02:03.000Z',
    });

    expect(
      await db.prepare(`SELECT current_shares FROM watchlist WHERE instrument_id = 'twse:0050'`)
        .first<{ current_shares: number }>(),
    ).toEqual({ current_shares: 12345 });

    const mapping = await db.prepare(`SELECT * FROM fund_mapping WHERE instrument_id = 'twse:0056'`)
      .first<Record<string, string>>();
    expect(mapping).toMatchObject({
      instrument_id: 'twse:0056',
      fund_unified_no: 'FUND-0056',
      fund_name: '來源基金名稱',
      source_kind: 'twse_fund_mapping',
      source_observed_at: '2026-08-10T01:00:00.000Z',
    });

    const evidence = await db
      .prepare(
        `SELECT e.event_key, e.instrument_id, e.manual_locked, e.manual_note,
                o.event_key AS observation_event_key, o.payload_sha256, o.raw_payload
         FROM dividend_events e
         JOIN dividend_observations o ON o.event_key = e.event_key`,
      )
      .first<Record<string, string | number>>();
    expect(evidence).toMatchObject({
      event_key: 'twse:0056:2026-07-16',
      instrument_id: 'twse:0056',
      manual_locked: 1,
      manual_note: '保留人工鎖定',
      observation_event_key: 'twse:0056:2026-07-16',
      payload_sha256: 'seed-sha',
      raw_payload: '{"code":"0056","amount":"1.07"}',
    });

    await expectConstraint(
      db.prepare(
        `INSERT INTO instruments
           (instrument_id, market, code, kind, display_name, active, created_at, updated_at)
         VALUES ('twse:0056-duplicate', 'twse', '0056', 'etf', 'duplicate', 1,
                 datetime('now'), datetime('now'))`,
      ),
    );
    await db.prepare(
      `INSERT INTO instruments
         (instrument_id, market, code, kind, display_name, active, created_at, updated_at)
       VALUES ('tpex:0056', 'tpex', '0056', 'stock', 'OTC same code', 1,
               datetime('now'), datetime('now'))`,
    ).run();

    await expectConstraint(
      db.prepare(
        `INSERT INTO watchlist
           (instrument_id, current_shares, enabled, created_at, updated_at)
         VALUES ('twse:0050', -1, 1, datetime('now'), datetime('now'))`,
      ),
    );
    await expectConstraint(
      db.prepare(
        `INSERT INTO watchlist
           (instrument_id, current_shares, enabled, created_at, updated_at)
         VALUES ('twse:9999', 1, 1, datetime('now'), datetime('now'))`,
      ),
    );
    await expectConstraint(
      db.prepare(
        `INSERT INTO dividend_observations
           (observation_key, event_key, source_kind, source_priority,
            source_observed_at, payload_sha256, raw_payload, created_at)
         VALUES ('orphan', 'twse:0056:2099-01-01', 'test', 1, datetime('now'),
                 'orphan-sha', '{}', datetime('now'))`,
      ),
    );
    await expectConstraint(db.prepare(`DELETE FROM instruments WHERE instrument_id = 'twse:0056'`));

    await db.prepare(
      `UPDATE watchlist
       SET enabled = 0, archived_at = '2026-08-11T03:00:00.000Z'
       WHERE instrument_id = 'twse:0056'`,
    ).run();
    expect(
      await db.prepare(
        `SELECT COUNT(*) AS count FROM dividend_events WHERE instrument_id = 'twse:0056'`,
      ).first<{ count: number }>(),
    ).toEqual({ count: 1 });
    expect(
      await db.prepare(
        `SELECT archived_at FROM watchlist WHERE instrument_id = 'twse:0056'`,
      ).first<{ archived_at: string }>(),
    ).toEqual({ archived_at: '2026-08-11T03:00:00.000Z' });

    await expectConstraint(
      db.prepare(
        `INSERT INTO dividend_events
           (event_key, instrument_id, ex_date, status, canonical_source_kind,
            canonical_source_priority, manual_locked, created_at, updated_at)
         VALUES ('different-key', 'twse:0056', '2026-07-16', 'announced', 'test', 1,
                 0, datetime('now'), datetime('now'))`,
      ),
    );

    await expectConstraint(
      db.prepare(
        `INSERT INTO latest_prices
           (instrument_id, price_micros, market_state, status, source,
            observed_at, updated_at)
         VALUES ('twse:0050', 0, 'trading', 'complete', 'test', datetime('now'), datetime('now'))`,
      ),
    );
    await expectConstraint(
      db.prepare(
        `INSERT INTO price_observations
           (observation_key, instrument_id, price_micros, market_state, status,
            source, observed_at, payload_sha256, raw_payload, created_at)
         VALUES ('price-zero', 'twse:0050', 0, 'trading', 'complete', 'test',
                 datetime('now'), 'price-zero-sha', '{}', datetime('now'))`,
      ),
    );
    await expectConstraint(
      db.prepare(
        `INSERT INTO price_observations
           (observation_key, instrument_id, market_state, status, source,
            observed_at, payload_sha256, raw_payload, created_at)
         VALUES ('full-market', 'twse:0050', 'unknown', 'error', 'test',
                 datetime('now'), 'large-sha', ?, datetime('now'))`,
      ).bind('x'.repeat(16_385)),
    );
    await expectConstraint(
      db.prepare(
        `INSERT INTO price_observations
           (observation_key, instrument_id, price_micros, previous_close_micros,
            market_state, status, source, observed_at, payload_sha256, raw_payload, created_at)
         VALUES ('incomplete-complete', 'twse:0050', 201500000, NULL,
                 'trading', 'complete', 'test', datetime('now'),
                 'incomplete-complete-sha', '{}', datetime('now'))`,
      ),
    );

    await db.prepare(
      `INSERT INTO latest_prices
         (instrument_id, price_micros, previous_close_micros, trade_date, trade_time,
          market_state, status, source, observed_at, updated_at)
       VALUES ('twse:0050', 201500000, 200000000, '2026-08-11', '13:30:00',
               'closed', 'complete', 'twstock_twse_mis', '2026-08-11T05:30:00.000Z',
               '2026-08-11T05:30:00.000Z')`,
    ).run();
    await db.prepare(
      `INSERT INTO latest_prices
         (instrument_id, price_micros, previous_close_micros, trade_date, trade_time,
          market_state, status, source, observed_at, updated_at)
       VALUES ('twse:0056', NULL, NULL, NULL, NULL, 'unknown', 'error', 'twstock_twse_mis',
               '2026-08-11T05:30:00.000Z', '2026-08-11T05:30:00.000Z')`,
    ).run();

    expect(await db.prepare('SELECT COUNT(*) AS count FROM latest_prices').first<{ count: number }>())
      .toEqual({ count: 2 });
  });
});
