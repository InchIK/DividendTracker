import { Hono } from 'hono';
import { z } from 'zod';
import { authUserId, requireAdmin, type AuthEnv } from '../auth/bearer';
import {
  archiveWatchlistItem,
  createOrRestoreWatchlistItem,
  getWatchlist,
  updateWatchlistItem,
} from '../db/queries';
import type { WatchlistItemRow } from '../db/types';
import { runInstrumentRefresh, type InstrumentRefreshResult } from '../sync/run-instrument-refresh';

export const watchlistRoutes = new Hono<AuthEnv>();

watchlistRoutes.use('/api/v1/watchlist/*', requireAdmin());

const codeSchema = z.string().regex(/^[0-9][0-9A-Z]{3,5}$/);
const displayNameSchema = z.string().trim().min(1).max(100);
const sharesSchema = z.union([
  z.number().int().nonnegative().safe(),
  z.string()
    .regex(/^(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)$/)
    .transform((value) => Number(value.replaceAll(',', '')))
    .pipe(z.number().int().nonnegative().safe()),
]);

const createSchema = z.object({
  market: z.enum(['twse', 'tpex']),
  code: codeSchema,
  kind: z.enum(['stock', 'etf']),
  displayName: displayNameSchema,
  shares: sharesSchema,
  enabled: z.boolean(),
  metadataSource: z.enum([
    'twse_t187ap03_L',
    'twse_t187ap47_L',
    'tpex_mopsfin_t187ap03_O',
  ]).optional(),
}).strict();

const updateSchema = z.object({
  shares: sharesSchema.optional(),
  enabled: z.boolean().optional(),
  displayName: displayNameSchema.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, '至少提供一個修改欄位');

function serialize(item: WatchlistItemRow) {
  return {
    instrumentId: item.instrument_id,
    market: item.market,
    code: item.code,
    kind: item.kind,
    displayName: item.display_name,
    shares: item.current_shares,
    enabled: item.enabled === 1,
    status: item.metadata_source === 'user_pending_validation'
      ? 'pending_validation' as const
      : 'validated' as const,
    updatedAt: item.updated_at,
  };
}

async function immediateRefresh(env: Env, instrumentId: string): Promise<InstrumentRefreshResult> {
  return runInstrumentRefresh(env, new Set([instrumentId]));
}

watchlistRoutes.get('/api/v1/watchlist', async (c) => {
  const items = await getWatchlist(c.env.DB, authUserId(c));
  return c.json({ items: items.map(serialize) });
});

watchlistRoutes.post('/api/v1/watchlist', async (c) => {
  const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: '請求格式錯誤', details: parsed.error.flatten() }, 400);
  }

  const result = await createOrRestoreWatchlistItem(c.env.DB, authUserId(c), parsed.data);
  if (!result) return c.json({ error: '標的已在自選清單中' }, 409);
  const refresh = parsed.data.enabled
    ? await immediateRefresh(c.env, result.item.instrument_id)
    : null;
  return c.json({
    status: serialize(result.item).status,
    restored: result.restored,
    item: serialize(result.item),
    refresh,
  }, result.restored ? 200 : 201);
});

watchlistRoutes.patch('/api/v1/watchlist/:instrumentId', async (c) => {
  const parsed = updateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: '請求格式錯誤', details: parsed.error.flatten() }, 400);
  }

  const item = await updateWatchlistItem(c.env.DB, authUserId(c), c.req.param('instrumentId'), parsed.data);
  if (!item) return c.json({ error: '找不到自選標的' }, 404);
  const refresh = parsed.data.enabled === true
    ? await immediateRefresh(c.env, item.instrument_id)
    : null;
  return c.json({ status: serialize(item).status, item: serialize(item), refresh });
});

watchlistRoutes.delete('/api/v1/watchlist/:instrumentId', async (c) => {
  const instrumentId = c.req.param('instrumentId');
  if (!await archiveWatchlistItem(c.env.DB, authUserId(c), instrumentId)) {
    return c.json({ error: '找不到自選標的' }, 404);
  }
  return c.json({ instrumentId, status: 'archived' as const });
});
