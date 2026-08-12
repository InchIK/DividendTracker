import { env, reset } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import initialMigration from '../../migrations/0001_initial.sql?raw';
import dynamicMigration from '../../migrations/0002_dynamic_instruments_prices.sql?raw';
import appearanceMigration from '../../migrations/0003_widget_appearance.sql?raw';
import customAppearanceMigration from '../../migrations/0004_widget_custom_background.sql?raw';
import multiUserMigration from '../../migrations/0005_multi_user_auth.sql?raw';
import registrationPolicyMigration from '../../migrations/0006_registration_policy.sql?raw';
import cleanInstallMigration from '../../migrations/0007_clean_install_privacy_reset.sql?raw';
import { applyMigration } from '../helpers/multi-user';

beforeEach(async () => {
  await reset();
  for (const migration of [
    initialMigration,
    dynamicMigration,
    appearanceMigration,
    customAppearanceMigration,
    multiUserMigration,
    registrationPolicyMigration,
  ]) {
    await applyMigration(env.DB, migration);
  }
});

describe('migration 0007 clean-install privacy reset', () => {
  it('clears every account and user/market data row while preserving schema', async () => {
    const now = '2026-08-12T00:00:00.000Z';
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO users (
           user_id, username, display_name, password_hash, password_salt,
           password_iterations, role, account_status, created_at, updated_at
         ) VALUES ('usr_reset_owner', 'reset-owner', 'Reset owner', 'unusable', 'unusable', 100000,
                   'owner', 'active', ?, ?)`,
      ).bind(now, now),
      env.DB.prepare(
        `INSERT INTO users (
           user_id, username, display_name, password_hash, password_salt,
           password_iterations, role, account_status, created_at, updated_at
         ) VALUES ('usr_reset_member', 'reset-member', 'Reset member', 'unusable', 'unusable', 100000,
                   'user', 'active', ?, ?)`,
      ).bind(now, now),
      env.DB.prepare(
        `INSERT INTO auth_sessions (session_hash, user_id, expires_at, created_at, last_seen_at)
         VALUES ('reset-session', 'usr_reset_member', ?, ?, ?)`,
      ).bind(now, now, now),
      env.DB.prepare(
        `INSERT INTO google_accounts (google_sub, user_id, email, created_at)
         VALUES ('reset-google-sub', 'usr_reset_member', 'reset@example.test', ?)`,
      ).bind(now),
      env.DB.prepare(
        `INSERT INTO widget_credentials
           (user_id, token_hash, token_ciphertext, token_iv, token_suffix, created_at, rotated_at)
         VALUES ('usr_reset_member', 'reset-hash', 'reset-ciphertext', 'reset-iv', 'reset', ?, ?)`,
      ).bind(now, now),
      env.DB.prepare(
        `INSERT INTO widget_appearance
           (user_id, theme, background_mode, start_color, end_color, updated_at)
         VALUES ('usr_reset_member', 'ocean', 'gradient', '#071426', '#0F766E', ?)`,
      ).bind(now),
      env.DB.prepare(
        `INSERT INTO watchlist
           (user_id, instrument_id, current_shares, enabled, created_at, updated_at)
         VALUES ('usr_reset_member', 'twse:0050', 10, 1, ?, ?)`,
      ).bind(now, now),
      env.DB.prepare(
        `INSERT INTO fund_mapping
           (instrument_id, fund_unified_no, fund_name, source_kind, source_observed_at, updated_at)
         VALUES ('twse:0050', 'reset-fund', 'Reset fund', 'test', ?, ?)`,
      ).bind(now, now),
      env.DB.prepare(
        `INSERT INTO dividend_events
           (event_key, instrument_id, ex_date, status, canonical_source_kind,
            canonical_source_priority, created_at, updated_at)
         VALUES ('twse:0050:2026-08-12', 'twse:0050', '2026-08-12', 'announced',
                 'test', 1, ?, ?)`,
      ).bind(now, now),
      env.DB.prepare(
        `INSERT INTO user_dividend_overrides
           (user_id, event_key, dividend_micros, manual_locked, created_at, updated_at)
         VALUES ('usr_reset_member', 'twse:0050:2026-08-12', 1000000, 1, ?, ?)`,
      ).bind(now, now),
      env.DB.prepare(
        `INSERT INTO dividend_observations
           (observation_key, event_key, source_kind, source_priority, source_observed_at,
            payload_sha256, raw_payload, created_at)
         VALUES ('reset-observation', 'twse:0050:2026-08-12', 'test', 1, ?,
                 'reset-payload-hash', '{}', ?)`,
      ).bind(now, now),
      env.DB.prepare(
        `INSERT INTO latest_prices
           (instrument_id, price_micros, previous_close_micros, market_state, status,
            source, observed_at, updated_at)
         VALUES ('twse:0050', 1000000, 900000, 'closed', 'complete', 'test', ?, ?)`,
      ).bind(now, now),
      env.DB.prepare(
        `INSERT INTO price_observations
           (observation_key, instrument_id, price_micros, previous_close_micros,
            market_state, status, source, observed_at, payload_sha256, raw_payload, created_at)
         VALUES ('reset-price-observation', 'twse:0050', 1000000, 900000, 'closed',
                 'complete', 'test', ?, 'reset-price-hash', '{}', ?)`,
      ).bind(now, now),
      env.DB.prepare(
        `INSERT INTO sync_runs (trigger_kind, started_at, status)
         VALUES ('test', ?, 'success')`,
      ).bind(now),
      env.DB.prepare(
        `INSERT INTO source_status (source_kind, status, updated_at)
         VALUES ('reset-source', 'ok', ?)`,
      ).bind(now),
      env.DB.prepare(
        `INSERT INTO application_settings
           (setting_key, setting_value, updated_by_user_id, updated_at)
         VALUES ('allow_registration', 'false', 'usr_reset_owner', ?)`,
      ).bind(now),
    ]);

    const before = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM users`,
    ).first<{ count: number }>();
    expect(before?.count).toBeGreaterThan(0);

    await applyMigration(env.DB, cleanInstallMigration);

    const tables = [
      'users', 'auth_sessions', 'google_accounts', 'widget_credentials',
      'user_dividend_overrides', 'widget_appearance', 'watchlist',
      'dividend_observations', 'latest_prices', 'price_observations',
      'fund_mapping', 'dividend_events', 'legacy_profile_claim',
      'sync_runs', 'source_status', 'application_settings', 'instruments',
    ];
    for (const table of tables) {
      const row = await env.DB.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<{ count: number }>();
      expect(row?.count, table).toBe(0);
    }

    const schema = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM sqlite_master
       WHERE type = 'table' AND name IN (${tables.map(() => '?').join(', ')})`,
    ).bind(...tables).first<{ count: number }>();
    expect(schema?.count).toBe(tables.length);
    expect((await env.DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
  });
});
