/**
 * Widget route — GET /api/v1/widget/current
 * Auth: browser session for Web preview or per-user Widget credential for Scriptable.
 * Returns widget response filtered by pay_date month.
 */
import { Hono } from 'hono';
import { authUserId, requireAnyAuth, type AuthEnv } from '../auth/bearer';
import { getUserDividendEvents, getPortfolio, getWatchlistPrices } from '../db/queries';
import { getWidgetAppearance } from '../db/widget-appearance';
import { buildWidgetResponse } from '../domain/widget-response';
import { isFreshnessStale, getLastSuccessfulSync } from '../sync/source-health';
import type { DividendEventRow, PortfolioRow } from '../db/types';
import type { CanonicalEvent } from '../domain/reconciliation';

export const widgetRoutes = new Hono<AuthEnv>();

widgetRoutes.use('/api/v1/widget/current', requireAnyAuth());

// GET /api/v1/widget/current
widgetRoutes.get('/api/v1/widget/current', async (c) => {
  const db = c.env.DB;
  const userId = authUserId(c);

  // Parse optional year/month from query
  const yearParam = c.req.query('year');
  const monthParam = c.req.query('month');

  let year: number | undefined;
  let month: number | undefined;

  if (yearParam && monthParam) {
    year = parseInt(yearParam, 10);
    month = parseInt(monthParam, 10);
  }

  // Get all dividend events (passing null to get all, then filter in widget builder)
  const events = await getUserDividendEvents(db, userId, null);
  const [portfolio, prices, appearance] = await Promise.all([
    getPortfolio(db, userId),
    getWatchlistPrices(db, userId),
    getWidgetAppearance(db, userId),
  ]);

  // Convert DB rows to CanonicalEvent
  const canonicalEvents: CanonicalEvent[] = events.map((e: DividendEventRow) => ({
    eventKey: e.event_key,
    instrumentId: e.instrument_id,
    code: e.code,
    exDate: e.ex_date,
    baseDate: e.base_date,
    payDate: e.pay_date,
    dividendMicros: e.dividend_micros !== null ? BigInt(e.dividend_micros) : null,
    status: e.status as CanonicalEvent['status'],
    canonicalSourceKind: e.canonical_source_kind,
    canonicalSourcePriority: e.canonical_source_priority,
    manualLocked: e.manual_locked === 1,
    manualNote: e.manual_note,
  }));

  // Convert portfolio rows
  const portfolioEntries = portfolio.map((p: PortfolioRow) => ({
    instrumentId: p.instrument_id,
    market: p.market,
    kind: p.kind,
    code: p.code,
    displayName: p.display_name,
    currentShares: p.current_shares,
    enabled: p.enabled === 1,
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

  // Get freshness info
  const stale = await isFreshnessStale(db);
  const lastSync = await getLastSuccessfulSync(db);

  const response = buildWidgetResponse(
    canonicalEvents,
    portfolioEntries,
    year,
    month,
    stale,
    lastSync,
    priceEntries,
  );

  return c.json({ ...response, appearance });
});
