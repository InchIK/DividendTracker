import {
  DEFAULT_WIDGET_APPEARANCE,
  isHexColor,
  isWidgetBackgroundMode,
  isWidgetTheme,
  matchingWidgetTheme,
  normalizeHexColor,
  type WidgetAppearance,
  type WidgetBackgroundMode,
  type WidgetTheme,
} from '../domain/widget-appearance';

interface WidgetAppearanceRow {
  theme: string;
  background_mode: string;
  start_color: string;
  end_color: string;
  updated_at: string;
}

/** Read one user's appearance setting, falling back only when the row is absent or invalid. */
export async function getWidgetAppearance(db: D1Database, userId: string): Promise<WidgetAppearance> {
  const row = await db.prepare(
    `SELECT theme, background_mode, start_color, end_color, updated_at
     FROM widget_appearance WHERE user_id = ?`,
  ).bind(userId).first<WidgetAppearanceRow>();
  if (!row
    || !isWidgetTheme(row.theme)
    || !isWidgetBackgroundMode(row.background_mode)
    || !isHexColor(row.start_color)
    || !isHexColor(row.end_color)) {
    return DEFAULT_WIDGET_APPEARANCE;
  }
  const startColor = normalizeHexColor(row.start_color);
  return {
    theme: row.theme,
    mode: row.background_mode,
    startColor,
    endColor: row.background_mode === 'solid'
      ? startColor
      : normalizeHexColor(row.end_color),
    updatedAt: row.updated_at,
  };
}

export async function saveWidgetAppearance(
  db: D1Database,
  userId: string,
  input: {
    theme?: WidgetTheme;
    mode: WidgetBackgroundMode;
    startColor: string;
    endColor: string;
  },
  now = new Date().toISOString(),
): Promise<WidgetAppearance> {
  const startColor = normalizeHexColor(input.startColor);
  const endColor = input.mode === 'solid'
    ? startColor
    : normalizeHexColor(input.endColor);
  const theme = input.theme
    ?? matchingWidgetTheme(input.mode, startColor, endColor)
    ?? 'ocean';
  await db.prepare(`
    INSERT INTO widget_appearance (
      user_id, theme, background_mode, start_color, end_color, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      theme = excluded.theme,
      background_mode = excluded.background_mode,
      start_color = excluded.start_color,
      end_color = excluded.end_color,
      updated_at = excluded.updated_at
  `).bind(userId, theme, input.mode, startColor, endColor, now).run();
  return { theme, mode: input.mode, startColor, endColor, updatedAt: now };
}
