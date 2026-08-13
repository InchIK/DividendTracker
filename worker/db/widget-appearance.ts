import {
  DEFAULT_WIDGET_APPEARANCE,
  DEFAULT_WIDGET_REFRESH_MINUTES,
  isHexColor,
  isWidgetBackgroundMode,
  isWidgetRefreshMinutes,
  isWidgetSortMode,
  isWidgetTheme,
  matchingWidgetTheme,
  normalizeHexColor,
  type WidgetAppearance,
  type WidgetBackgroundMode,
  type WidgetSortMode,
  type WidgetTheme,
} from '../domain/widget-appearance';

interface WidgetAppearanceRow {
  theme: string;
  background_mode: string;
  start_color: string;
  end_color: string;
  updated_at: string;
  sort_mode?: string | null;
  featured_instrument_id?: string | null;
  refresh_minutes?: number | null;
}

/** Read one user's appearance setting, falling back only when the row is absent or invalid. */
export async function getWidgetAppearance(db: D1Database, userId: string): Promise<WidgetAppearance> {
  const row = await db.prepare(
    `SELECT theme, background_mode, start_color, end_color, updated_at,
            sort_mode, featured_instrument_id, refresh_minutes
     FROM widget_appearance WHERE user_id = ?`,
  ).bind(userId).first<WidgetAppearanceRow>();
  if (!row) return DEFAULT_WIDGET_APPEARANCE;

  // Validate each column independently. A malformed preference must not hide
  // otherwise valid colors (or any other persisted appearance setting).
  const theme = isWidgetTheme(row.theme) ? row.theme : DEFAULT_WIDGET_APPEARANCE.theme;
  const mode = isWidgetBackgroundMode(row.background_mode)
    ? row.background_mode
    : DEFAULT_WIDGET_APPEARANCE.mode;
  const startColor = normalizeHexColor(
    isHexColor(row.start_color)
      ? row.start_color
      : DEFAULT_WIDGET_APPEARANCE.startColor,
  );
  const endColor = normalizeHexColor(
    isHexColor(row.end_color)
      ? row.end_color
      : DEFAULT_WIDGET_APPEARANCE.endColor,
  );
  const sortMode = isWidgetSortMode(row.sort_mode)
    ? row.sort_mode
    : DEFAULT_WIDGET_APPEARANCE.sortMode;
  const featuredInstrumentId = typeof row.featured_instrument_id === 'string'
    && row.featured_instrument_id.trim().length > 0
    ? row.featured_instrument_id
    : DEFAULT_WIDGET_APPEARANCE.featuredInstrumentId;
  const refreshMinutes = isWidgetRefreshMinutes(row.refresh_minutes)
    ? row.refresh_minutes
    : DEFAULT_WIDGET_REFRESH_MINUTES;
  return {
    theme,
    mode,
    startColor,
    endColor: mode === 'solid'
      ? startColor
      : endColor,
    sortMode,
    featuredInstrumentId,
    refreshMinutes,
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null,
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
    sortMode?: WidgetSortMode;
    featuredInstrumentId?: string | null;
    refreshMinutes?: number;
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
  const sortMode = isWidgetSortMode(input.sortMode)
    ? input.sortMode
    : DEFAULT_WIDGET_APPEARANCE.sortMode;
  const featuredInstrumentId = typeof input.featuredInstrumentId === 'string'
    && input.featuredInstrumentId.trim().length > 0
    ? input.featuredInstrumentId
    : null;
  const refreshMinutes = isWidgetRefreshMinutes(input.refreshMinutes)
    ? input.refreshMinutes
    : DEFAULT_WIDGET_REFRESH_MINUTES;
  await db.prepare(`
    INSERT INTO widget_appearance (
      user_id, theme, background_mode, start_color, end_color,
      sort_mode, featured_instrument_id, refresh_minutes, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      theme = excluded.theme,
      background_mode = excluded.background_mode,
      start_color = excluded.start_color,
      end_color = excluded.end_color,
      sort_mode = excluded.sort_mode,
      featured_instrument_id = excluded.featured_instrument_id,
      refresh_minutes = excluded.refresh_minutes,
      updated_at = excluded.updated_at
  `).bind(
    userId,
    theme,
    input.mode,
    startColor,
    endColor,
    sortMode,
    featuredInstrumentId,
    refreshMinutes,
    now,
  ).run();
  return {
    theme,
    mode: input.mode,
    startColor,
    endColor,
    sortMode,
    featuredInstrumentId,
    refreshMinutes,
    updatedAt: now,
  };
}
