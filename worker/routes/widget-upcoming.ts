import { Hono } from 'hono';
import { authUserId, requireAnyAuth, type AuthEnv } from '../auth/bearer';
import { getUserDividendEvents, getPortfolio, getWatchlistPrices } from '../db/queries';
import { getWidgetAppearance } from '../db/widget-appearance';
import { buildUpcomingWidgetResponse } from '../domain/upcoming-widget';
import { isFreshnessStale, getLastSuccessfulSync } from '../sync/source-health';
import type { DividendEventRow, PortfolioRow } from '../db/types';
import type { CanonicalEvent } from '../domain/reconciliation';

export const widgetUpcomingRoutes = new Hono<AuthEnv>();

widgetUpcomingRoutes.use('/api/v1/widget/upcoming', requireAnyAuth());

widgetUpcomingRoutes.get('/api/v1/widget/upcoming', async (c) => {
  const db = c.env.DB;
  const userId = authUserId(c);
  const events = await getUserDividendEvents(db, userId, null);
  const [portfolio, prices, appearance] = await Promise.all([
    getPortfolio(db, userId),
    getWatchlistPrices(db, userId),
    getWidgetAppearance(db, userId),
  ]);

  const canonicalEvents: CanonicalEvent[] = events.map((event: DividendEventRow) => ({
    eventKey: event.event_key,
    instrumentId: event.instrument_id,
    code: event.code,
    exDate: event.ex_date,
    baseDate: event.base_date,
    payDate: event.pay_date,
    dividendMicros: event.dividend_micros === null ? null : BigInt(event.dividend_micros),
    status: event.status as CanonicalEvent['status'],
    canonicalSourceKind: event.canonical_source_kind,
    canonicalSourcePriority: event.canonical_source_priority,
    manualLocked: event.manual_locked === 1,
    manualNote: event.manual_note,
  }));

  const portfolioEntries = portfolio.map((entry: PortfolioRow) => ({
    instrumentId: entry.instrument_id,
    market: entry.market,
    kind: entry.kind,
    code: entry.code,
    displayName: entry.display_name,
    currentShares: entry.current_shares,
    enabled: entry.enabled === 1 && entry.archived_at === null,
  }));
  const priceEntries = prices.map((price) => ({
    instrumentId: price.instrument_id,
    latestPriceMicros: price.latest_price_micros,
    previousCloseMicros: price.previous_close_micros,
    tradeDate: price.trade_date,
    tradeTime: price.trade_time,
    status: price.status,
    stale: price.stale === 1,
  }));

  const [stale, lastSync] = await Promise.all([
    isFreshnessStale(db),
    getLastSuccessfulSync(db),
  ]);

  return c.json({
    ...buildUpcomingWidgetResponse(
      canonicalEvents,
      portfolioEntries,
      undefined,
      stale,
      lastSync,
      priceEntries,
    ),
    appearance,
  });
});
