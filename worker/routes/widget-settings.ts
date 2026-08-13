import { Hono } from 'hono';
import { z } from 'zod';
import { authUserId, requireAdmin, type AuthEnv } from '../auth/bearer';
import { getWatchlistItem } from '../db/queries';
import { getWidgetAppearance, saveWidgetAppearance } from '../db/widget-appearance';
import {
  HEX_COLOR_PATTERN,
  MAX_WIDGET_REFRESH_MINUTES,
  MIN_WIDGET_REFRESH_MINUTES,
  WIDGET_BACKGROUND_MODES,
  WIDGET_SORT_MODES,
} from '../domain/widget-appearance';

const customBackgroundSchema = z.object({
  mode: z.enum(WIDGET_BACKGROUND_MODES),
  startColor: z.string().regex(HEX_COLOR_PATTERN),
  endColor: z.string().regex(HEX_COLOR_PATTERN),
  sortMode: z.enum(WIDGET_SORT_MODES),
  featuredInstrumentId: z.string().nullable(),
  refreshMinutes: z.number()
    .int()
    .min(MIN_WIDGET_REFRESH_MINUTES)
    .max(MAX_WIDGET_REFRESH_MINUTES),
}).strict();

export const widgetSettingsRoutes = new Hono<AuthEnv>();

widgetSettingsRoutes.use('/api/v1/widget/settings', requireAdmin());

widgetSettingsRoutes.get('/api/v1/widget/settings', async (c) => {
  return c.json(await getWidgetAppearance(c.env.DB, authUserId(c)));
});

widgetSettingsRoutes.put('/api/v1/widget/settings', async (c) => {
  const parsed = customBackgroundSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'Widget 設定格式錯誤：請提供完整的外觀、排列與更新欄位。' }, 400);
  }
  if (parsed.data.sortMode === 'featured') {
    const featuredId = parsed.data.featuredInstrumentId?.trim() ?? '';
    if (!featuredId) return c.json({ error: '自訂第一個顯示模式必須選擇標的。' }, 400);
    const item = await getWatchlistItem(c.env.DB, authUserId(c), featuredId);
    if (item?.archived_at !== null || item?.enabled !== 1) {
      return c.json({ error: '自訂標的必須是目前帳號啟用中的自選標的。' }, 400);
    }
  }
  return c.json(await saveWidgetAppearance(c.env.DB, authUserId(c), {
    ...parsed.data,
    featuredInstrumentId: parsed.data.sortMode === 'featured'
      ? parsed.data.featuredInstrumentId?.trim() ?? null
      : null,
  }));
});
