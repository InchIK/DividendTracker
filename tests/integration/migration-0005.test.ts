import { env, reset } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import initialMigration from '../../migrations/0001_initial.sql?raw';
import dynamicMigration from '../../migrations/0002_dynamic_instruments_prices.sql?raw';
import appearanceMigration from '../../migrations/0003_widget_appearance.sql?raw';
import customAppearanceMigration from '../../migrations/0004_widget_custom_background.sql?raw';
import multiUserMigration from '../../migrations/0005_multi_user_auth.sql?raw';
import { applyMigration } from '../helpers/multi-user';

beforeEach(async () => {
  await reset();
  for (const migration of [initialMigration, dynamicMigration, appearanceMigration, customAppearanceMigration]) {
    await applyMigration(env.DB, migration);
  }
});

describe('migration 0005 multi-user ownership', () => {
  it('assigns legacy settings to a claimable profile and privatizes legacy manual overrides', async () => {
    await env.DB.prepare(
      `UPDATE watchlist SET current_shares = 1234 WHERE instrument_id = 'twse:0050'`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO dividend_events (
         event_key, instrument_id, ex_date, base_date, pay_date, dividend_micros,
         eligible_shares_override, status, canonical_source_kind,
         canonical_source_priority, manual_locked, manual_note, created_at, updated_at
       ) VALUES (
         'twse:0050:2026-08-01', 'twse:0050', '2026-08-01', NULL, '2026-08-20',
         1200000, 10000, 'verified', 'manual_verified', 100, 1, 'private note',
         '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'
       )`,
    ).run();

    await applyMigration(env.DB, multiUserMigration);

    expect(await env.DB.prepare(
      `SELECT user_id, current_shares FROM watchlist WHERE instrument_id = 'twse:0050'`,
    ).first()).toEqual({ user_id: 'legacy-unclaimed', current_shares: 1234 });
    expect(await env.DB.prepare(
      `SELECT user_id, background_mode, start_color, end_color FROM widget_appearance`,
    ).first()).toEqual({
      user_id: 'legacy-unclaimed', background_mode: 'gradient',
      start_color: '#071426', end_color: '#0F766E',
    });
    expect(await env.DB.prepare(
      `SELECT user_id, dividend_micros, manual_locked, manual_note
       FROM user_dividend_overrides WHERE event_key = 'twse:0050:2026-08-01'`,
    ).first()).toEqual({
      user_id: 'legacy-unclaimed', dividend_micros: 1200000,
      manual_locked: 1, manual_note: 'private note',
    });
    expect(await env.DB.prepare(
      `SELECT owner_user_id, manual_locked, manual_note
       FROM dividend_events WHERE event_key = 'twse:0050:2026-08-01'`,
    ).first()).toEqual({ owner_user_id: 'legacy-unclaimed', manual_locked: 0, manual_note: null });
    expect((await env.DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
  });
});
