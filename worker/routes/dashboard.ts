/**
 * Dashboard route — GET /api/v1/dashboard?year=&month=&day=
 * Admin auth required.
 * Returns monthly summary with events, portfolio, and freshness info.
 */
import { Hono } from 'hono';
import { authUserId, requireAdmin, type AuthEnv } from '../auth/bearer';
import { getUserDividendEvents, getPortfolio, getWatchlistPrices } from '../db/queries';
import { calculateAmount, formatMicros, formatMicrosWithCommas } from '../domain/money';
import { PeriodFilterError, parsePeriodFilter } from '../domain/period-filter';
import { checkSourceHealth, getLastSuccessfulSync } from '../sync/source-health';
import type { DividendEventRow } from '../db/types';

export const dashboardRoutes = new Hono<AuthEnv>();

dashboardRoutes.use('/api/v1/dashboard/*', requireAdmin());

dashboardRoutes.get('/api/v1/dashboard', async (c) => {
  const db = c.env.DB;
  const userId = authUserId(c);

  // No period defaults to the current Taipei month. Explicit all-time flags override it.
  const allParam = c.req.query('all');
  const scopeParam = c.req.query('scope');
  const yearParam = c.req.query('year');
  const monthParam = c.req.query('month');
  const dayParam = c.req.query('day');
  let parsedPeriod;
  try {
    parsedPeriod = parsePeriodFilter(yearParam, monthParam, true, dayParam);
  } catch (error) {
    if (error instanceof PeriodFilterError) {
      return c.json({ error: error.message }, 400);
    }
    throw error;
  }
  const isAll = allParam === '1' || scopeParam === 'all';
  const prefix = isAll ? null : parsedPeriod.prefix;

  // Fetch data
  const [events, portfolio, prices, health, lastSync] = await Promise.all([
    getUserDividendEvents(db, userId, prefix),
    getPortfolio(db, userId),
    getWatchlistPrices(db, userId),
    checkSourceHealth(db),
    getLastSuccessfulSync(db),
  ]);
  const { sources: sourceHealth, anyStale } = health;

  // Build portfolio map
  const portfolioMap = new Map(portfolio.map((p) => [p.instrument_id, p]));
  const priceMap = new Map(prices.map((price) => [price.instrument_id, price]));

  // Build summary
  let totalMicros = 0n;
  let pendingCount = 0;
  const announcedInstruments = new Set<string>();
  let conflictCount = 0;

  // Historical events remain archived in D1, but the dashboard only exposes
  // instruments that are still present in the user's current watchlist.
  const items = events.filter((event) => portfolioMap.has(event.instrument_id)).map((e: DividendEventRow) => {
    const port = portfolioMap.get(e.instrument_id);
    const price = priceMap.get(e.instrument_id);
    const shares = e.eligible_shares_override ?? port?.current_shares ?? 0;
    const dividendMicros = e.dividend_micros !== null ? BigInt(e.dividend_micros) : null;
    const amountMicros = calculateAmount(shares, dividendMicros);

    if (amountMicros !== null) {
      totalMicros += amountMicros;
    } else {
      pendingCount++;
    }
    if (e.status === 'announced' || e.status === 'verified') announcedInstruments.add(e.instrument_id);
    if (e.status === 'conflict') conflictCount++;

    return {
      eventKey: e.event_key,
      instrumentId: e.instrument_id,
      market: port?.market ?? e.instrument_id.split(':')[0],
      kind: port?.kind ?? 'stock',
      code: e.code,
      displayName: port?.display_name ?? e.code,
      exDate: e.ex_date,
      payDate: e.pay_date,
      baseDate: e.base_date,
      shares,
      sharesBasis: e.eligible_shares_override !== null ? 'event_override' : 'current_portfolio_estimate',
      dividendPerUnit: dividendMicros !== null ? formatMicros(dividendMicros) : null,
      formula: dividendMicros !== null ? `${shares} × ${formatMicros(dividendMicros)}` : `${shares} × 待公告`,
      estimatedGrossAmount: amountMicros !== null ? formatMicros(amountMicros) : null,
      estimatedGrossAmountDisplay: amountMicros !== null ? formatMicrosWithCommas(amountMicros) : null,
      status: e.status,
      source: e.canonical_source_kind,
      sourceKind: e.canonical_source_kind,
      sourceLabel: sourceLabel(e.canonical_source_kind),
      previousClose: price?.previous_close_micros !== null && price?.previous_close_micros !== undefined
        ? formatMicros(BigInt(price.previous_close_micros))
        : null,
      currentTrade: price?.latest_price_micros !== null && price?.latest_price_micros !== undefined
        ? formatMicros(BigInt(price.latest_price_micros))
        : null,
      tradeDate: price?.trade_date ?? null,
      tradeTime: price?.trade_time ?? null,
      priceStatus: price?.status ?? null,
      priceStale: price?.stale === 1,
      manualLocked: e.manual_locked === 1,
      manualNote: e.manual_note,
    };
  });

  return c.json({
    period: isAll ? null : parsedPeriod.period,
    summary: {
      totalGrossAmount: formatMicros(totalMicros),
      totalGrossAmountDisplay: formatMicrosWithCommas(totalMicros),
      instrumentCount: announcedInstruments.size,
      etfCount: announcedInstruments.size,
      pendingCount,
      conflictCount,
      lastSuccessfulSync: lastSync,
    },
    items,
    sources: sourceHealth.map((s) => ({
      sourceKind: s.sourceKind,
      status: s.status,
      stale: s.stale,
      lastSuccessAt: s.lastSuccessAt,
      hoursSinceLastSuccess: s.hoursSinceLastSuccess,
      errorMessage: s.errorMessage,
    })),
    freshness: {
      stale: anyStale,
      lastSuccessfulSync: lastSync,
    },
  });
});

function sourceLabel(source: string): string {
  const labels: Record<string, string> = {
    manual_verified: '人工覆核',
    etfortune_html: 'TWSE e添富',
    sitca_open_data: '投信投顧公會',
    finmind_dividend: 'FinMind（TWSE/MOPS）',
    twse_ex_schedule: 'TWSE 除權息預告',
  };
  return labels[source] ?? source;
}
