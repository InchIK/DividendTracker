export const WIDGET_THEMES = ['ocean', 'midnight', 'sunset', 'forest'] as const;
export const WIDGET_BACKGROUND_MODES = ['solid', 'gradient'] as const;
export const WIDGET_SORT_MODES = ['dividend_desc', 'random', 'price_desc', 'featured'] as const;

export const MIN_WIDGET_REFRESH_MINUTES = 15;
export const MAX_WIDGET_REFRESH_MINUTES = 1440;
export const DEFAULT_WIDGET_REFRESH_MINUTES = 180;

export type WidgetTheme = typeof WIDGET_THEMES[number];
export type WidgetBackgroundMode = typeof WIDGET_BACKGROUND_MODES[number];
export type WidgetSortMode = typeof WIDGET_SORT_MODES[number];

export const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

export const WIDGET_THEME_COLORS: Record<WidgetTheme, { startColor: string; endColor: string }> = {
  ocean: { startColor: '#071426', endColor: '#0F766E' },
  midnight: { startColor: '#020617', endColor: '#334155' },
  sunset: { startColor: '#2E1065', endColor: '#BE123C' },
  forest: { startColor: '#052E16', endColor: '#166534' },
};

export interface WidgetAppearance {
  theme: WidgetTheme;
  mode: WidgetBackgroundMode;
  startColor: string;
  endColor: string;
  sortMode: WidgetSortMode;
  featuredInstrumentId: string | null;
  refreshMinutes: number;
  updatedAt: string | null;
}

export const DEFAULT_WIDGET_APPEARANCE: WidgetAppearance = {
  theme: 'ocean',
  mode: 'gradient',
  ...WIDGET_THEME_COLORS.ocean,
  sortMode: 'dividend_desc',
  featuredInstrumentId: null,
  refreshMinutes: DEFAULT_WIDGET_REFRESH_MINUTES,
  updatedAt: null,
};

export function isWidgetTheme(value: unknown): value is WidgetTheme {
  return typeof value === 'string' && (WIDGET_THEMES as readonly string[]).includes(value);
}

export function isWidgetBackgroundMode(value: unknown): value is WidgetBackgroundMode {
  return typeof value === 'string'
    && (WIDGET_BACKGROUND_MODES as readonly string[]).includes(value);
}

export function isWidgetSortMode(value: unknown): value is WidgetSortMode {
  return typeof value === 'string'
    && (WIDGET_SORT_MODES as readonly string[]).includes(value);
}

export function isWidgetRefreshMinutes(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= MIN_WIDGET_REFRESH_MINUTES
    && value <= MAX_WIDGET_REFRESH_MINUTES;
}

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR_PATTERN.test(value);
}

export function normalizeHexColor(value: string): string {
  return value.toUpperCase();
}

export function matchingWidgetTheme(
  mode: WidgetBackgroundMode,
  startColor: string,
  endColor: string,
): WidgetTheme | null {
  if (mode !== 'gradient') return null;
  const normalizedStart = normalizeHexColor(startColor);
  const normalizedEnd = normalizeHexColor(endColor);
  for (const theme of WIDGET_THEMES) {
    const preset = WIDGET_THEME_COLORS[theme];
    if (preset.startColor === normalizedStart && preset.endColor === normalizedEnd) return theme;
  }
  return null;
}

export function appearanceForTheme(
  theme: WidgetTheme,
  updatedAt: string | null = null,
): WidgetAppearance {
  return {
    theme,
    mode: 'gradient',
    ...WIDGET_THEME_COLORS[theme],
    sortMode: DEFAULT_WIDGET_APPEARANCE.sortMode,
    featuredInstrumentId: DEFAULT_WIDGET_APPEARANCE.featuredInstrumentId,
    refreshMinutes: DEFAULT_WIDGET_APPEARANCE.refreshMinutes,
    updatedAt,
  };
}
