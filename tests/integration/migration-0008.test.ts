import { env, reset } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import initialMigration from '../../migrations/0001_initial.sql?raw';
import dynamicMigration from '../../migrations/0002_dynamic_instruments_prices.sql?raw';
import appearanceMigration from '../../migrations/0003_widget_appearance.sql?raw';
import customAppearanceMigration from '../../migrations/0004_widget_custom_background.sql?raw';
import multiUserMigration from '../../migrations/0005_multi_user_auth.sql?raw';
import registrationPolicyMigration from '../../migrations/0006_registration_policy.sql?raw';
import cleanInstallMigration from '../../migrations/0007_clean_install_privacy_reset.sql?raw';
import widgetPreferencesMigration from '../../migrations/0008_widget_preferences.sql?raw';
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
    cleanInstallMigration,
  ]) {
    await applyMigration(env.DB, migration);
  }
});

describe('migration 0008 Widget preferences', () => {
  it('preserves existing appearance rows and adds data-free preference defaults', async () => {
    const now = '2026-08-13T00:00:00.000Z';
    await env.DB.prepare(
      `INSERT INTO users (
         user_id, username, display_name, password_hash, password_salt,
         password_iterations, role, account_status, created_at, updated_at
       ) VALUES ('usr_migration', 'migration-user', 'Migration user', 'unusable',
                 'unusable', 100000, 'owner', 'active', ?, ?)`,
    ).bind(now, now).run();
    await env.DB.prepare(
      `INSERT INTO widget_appearance (
         user_id, theme, background_mode, start_color, end_color, updated_at
       ) VALUES ('usr_migration', 'sunset', 'gradient', '#123ABC', '#FEDCBA', ?)`,
    ).bind(now).run();

    await applyMigration(env.DB, widgetPreferencesMigration);

    await expect(env.DB.prepare(
      `SELECT theme, background_mode, start_color, end_color,
              sort_mode, featured_instrument_id, refresh_minutes
       FROM widget_appearance WHERE user_id = 'usr_migration'`,
    ).first()).resolves.toEqual({
      theme: 'sunset',
      background_mode: 'gradient',
      start_color: '#123ABC',
      end_color: '#FEDCBA',
      sort_mode: 'dividend_desc',
      featured_instrument_id: null,
      refresh_minutes: 180,
    });
  });

  it('enforces the generic sort-mode and refresh bounds in D1', async () => {
    await applyMigration(env.DB, widgetPreferencesMigration);
    const now = '2026-08-13T00:00:00.000Z';
    await env.DB.prepare(
      `INSERT INTO users (
         user_id, username, display_name, password_hash, password_salt,
         password_iterations, role, account_status, created_at, updated_at
       ) VALUES ('usr_constraints', 'constraints-user', 'Constraints user', 'unusable',
                 'unusable', 100000, 'owner', 'active', ?, ?)`,
    ).bind(now, now).run();

    await expect(env.DB.prepare(
      `INSERT INTO widget_appearance (
         user_id, theme, background_mode, start_color, end_color,
         sort_mode, refresh_minutes, updated_at
       ) VALUES ('usr_constraints', 'ocean', 'gradient', '#071426', '#0F766E',
                 'invalid', 180, ?)`,
    ).bind(now).run()).rejects.toThrow();
    await expect(env.DB.prepare(
      `INSERT INTO widget_appearance (
         user_id, theme, background_mode, start_color, end_color,
         sort_mode, refresh_minutes, updated_at
       ) VALUES ('usr_constraints', 'ocean', 'gradient', '#071426', '#0F766E',
                 'random', 14, ?)`,
    ).bind(now).run()).rejects.toThrow();
  });
});
