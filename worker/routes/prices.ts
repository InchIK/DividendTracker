import { Hono } from 'hono';
import { authUserId, requireAdmin, type AuthEnv } from '../auth/bearer';
import { getWatchlistPrices } from '../db/queries';

export const priceRoutes = new Hono<AuthEnv>();

priceRoutes.use('/api/v1/prices', requireAdmin());

priceRoutes.get('/api/v1/prices', async (c) => {
  const items = await getWatchlistPrices(c.env.DB, authUserId(c));
  return c.json({
    items: items.map((item) => ({
      instrumentId: item.instrument_id,
      code: item.code,
      displayName: item.display_name,
      latestPriceMicros: item.latest_price_micros,
      previousCloseMicros: item.previous_close_micros,
      tradeDate: item.trade_date,
      tradeTime: item.trade_time,
      marketState: item.market_state,
      status: item.status,
      source: item.source,
      observedAt: item.observed_at,
      stale: item.stale === 1,
      errorMessage: item.error_message,
    })),
  });
});
