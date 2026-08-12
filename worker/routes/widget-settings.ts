import { Hono } from 'hono';
import { z } from 'zod';
import { authUserId, requireAdmin, type AuthEnv } from '../auth/bearer';
import { getWidgetAppearance, saveWidgetAppearance } from '../db/widget-appearance';
import {
  HEX_COLOR_PATTERN,
  WIDGET_BACKGROUND_MODES,
} from '../domain/widget-appearance';

const customBackgroundSchema = z.object({
  mode: z.enum(WIDGET_BACKGROUND_MODES),
  startColor: z.string().regex(HEX_COLOR_PATTERN),
  endColor: z.string().regex(HEX_COLOR_PATTERN),
}).strict();

export const widgetSettingsRoutes = new Hono<AuthEnv>();

widgetSettingsRoutes.use('/api/v1/widget/settings', requireAdmin());

widgetSettingsRoutes.get('/api/v1/widget/settings', async (c) => {
  return c.json(await getWidgetAppearance(c.env.DB, authUserId(c)));
});

widgetSettingsRoutes.put('/api/v1/widget/settings', async (c) => {
  const parsed = customBackgroundSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: '背景設定格式錯誤，顏色需為 #RRGGBB' }, 400);
  return c.json(await saveWidgetAppearance(c.env.DB, authUserId(c), parsed.data));
});
