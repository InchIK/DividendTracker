import { getCurrentPeriodInTaipei } from './date';
import {
  buildWidgetResponse,
  type PortfolioEntry,
  type WidgetPriceEntry,
  type WidgetResponse,
} from './widget-response';
import type { CanonicalEvent } from './reconciliation';

export interface UpcomingWidgetResponse {
  periods: [WidgetResponse, WidgetResponse];
  generatedAt: string;
}

function nextMonth(period: { year: number; month: number }): { year: number; month: number } {
  if (period.month === 12) return { year: period.year + 1, month: 1 };
  return { year: period.year, month: period.month + 1 };
}

export function buildUpcomingWidgetResponse(
  events: CanonicalEvent[],
  portfolio: PortfolioEntry[],
  currentPeriod: { year: number; month: number } = getCurrentPeriodInTaipei(),
  freshnessStale = false,
  lastSuccessfulSync: string | null = null,
  prices: WidgetPriceEntry[] = [],
): UpcomingWidgetResponse {
  const followingPeriod = nextMonth(currentPeriod);
  const current = buildWidgetResponse(
    events,
    portfolio,
    currentPeriod.year,
    currentPeriod.month,
    freshnessStale,
    lastSuccessfulSync,
    prices,
  );
  const following = buildWidgetResponse(
    events,
    portfolio,
    followingPeriod.year,
    followingPeriod.month,
    freshnessStale,
    lastSuccessfulSync,
    prices,
  );

  return {
    periods: [current, following],
    generatedAt: new Date().toISOString(),
  };
}
