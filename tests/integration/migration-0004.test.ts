import { env, reset } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';

import initialMigration from '../../migrations/0001_initial.sql?raw';
import dynamicMigration from '../../migrations/0002_dynamic_instruments_prices.sql?raw';
import widgetAppearanceMigration from '../../migrations/0003_widget_appearance.sql?raw';
import customBackgroundMigration from '../../migrations/0004_widget_custom_background.sql?raw';

async function applyMigration(db: D1Database, sql: string): Promise<void> {
  for (const statement of sql.split(';').map((part) => part.trim()).filter(Boolean)) {
    if (statement.startsWith('PRAGMA ')) continue;
    await db.prepare(statement).run();
  }
}

afterEach(() => reset());

describe('migration 0004 custom Widget background', () => {
  it('preserves the selected legacy theme as editable gradient colors', async () => {
    await applyMigration(env.DB, initialMigration);
    await applyMigration(env.DB, dynamicMigration);
    await applyMigration(env.DB, widgetAppearanceMigration);
    await env.DB.prepare(
      `UPDATE widget_appearance SET theme = 'sunset' WHERE singleton_id = 1`,
    ).run();

    await applyMigration(env.DB, customBackgroundMigration);

    const row = await env.DB.prepare(`
      SELECT theme, background_mode, start_color, end_color
      FROM widget_appearance WHERE singleton_id = 1
    `).first();
    expect(row).toEqual({
      theme: 'sunset',
      background_mode: 'gradient',
      start_color: '#2E1065',
      end_color: '#BE123C',
    });
  });
});
