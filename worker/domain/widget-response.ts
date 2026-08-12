/**
 * Widget response builder.
 * Filters events by pay_date month (NOT ex_date month).
 * Calculates estimated gross amounts using BigInt micros.
 */
import { getCurrentPeriodInTaipei, yearMonthPrefix } from './date';
import { calculateAmount, formatMicros, formatMicrosWithCommas } from './money';
import type { CanonicalEvent } from './reconciliation';

export interface PortfolioEntry {
  instrumentId?: string;
  market?: 'twse' | 'tpex';
  kind?: 'stock' | 'etf';
  code: string;
  displayName: string;
  currentShares: number;
  enabled: boolean;
}

export interface WidgetPriceEntry {
  instrumentId: string;
  latestPriceMicros: string | null;
  previousCloseMicros: string | null;
  tradeDate: string | null;
  tradeTime: string | null;
  status: string | null;
  stale: boolean;
}

export interface WidgetItem {
  instrumentId: string;
  market: 'twse' | 'tpex';
  kind: 'stock' | 'etf';
  code: string;
  name: string;
  shares: string;
  sharesBasis: 'event_override' | 'current_portfolio_estimate';
  dividendPerUnit: string | null;
  payDate: string | null;
  estimatedGrossAmount: string | null;
  previousClose: string | null;
  currentTrade: string | null;
  tradeDate: string | null;
  tradeTime: string | null;
  priceStatus: string | null;
  priceStale: boolean;
  source: {
    kind: string;
    label: string;
  };
  hasConflict: boolean;
}

export interface WidgetResponse {
  status: 'ok' | 'pending_amount' | 'no_announced_payout' | 'source_stale' | 'source_error';
  period: {
    year: number;
    month: number;
    timezone: string;
  };
  items: WidgetItem[];
  totalGrossAmount: string | null;
  display: {
    title: string;
    total: string | null;
    lines: string[];
    compact: string | null;
  };
  freshness?: {
    stale: boolean;
    lastSuccessfulSync: string | null;
  };
  generatedAt: string;
}

const SOURCE_LABELS: Record<string, string> = {
  manual_verified: '官方人工覆核',
  sitca_open_data: '政府開放資料',
  twse_ex_schedule: '證交所預告',
  etfortune_html: 'TWSE e添富',
  finmind_dividend: 'FinMind（TWSE/MOPS）',
};

export function buildWidgetResponse(
  events: CanonicalEvent[],
  portfolio: PortfolioEntry[],
  year?: number,
  month?: number,
  freshnessStale = false,
  lastSuccessfulSync: string | null = null,
  prices: WidgetPriceEntry[] = [],
): WidgetResponse {
  const period = year && month ? { year, month } : getCurrentPeriodInTaipei();
  const prefix = yearMonthPrefix(period.year, period.month);

  // Filter events by pay_date month
  const monthlyEvents = events.filter(
    (e) => e.payDate?.startsWith(prefix) === true,
  );

  const portfolioMap = new Map(portfolio.map((p) => [p.instrumentId ?? `twse:${p.code}`, p]));
  const priceMap = new Map(prices.map((price) => [price.instrumentId, price]));

  const items: WidgetItem[] = [];
  const itemAmounts: (bigint | null)[] = [];
  let totalMicros = 0n;
  let anyItemHasAmount = false;
  let anyItemPending = false;

  for (const event of monthlyEvents) {
    const instrumentId = event.instrumentId ?? `twse:${event.code}`;
    const port = portfolioMap.get(instrumentId);
    if (!port?.enabled) continue;
    const price = priceMap.get(instrumentId);

    const shares = event.eligibleSharesOverride ?? port.currentShares;
    if (shares === 0) continue;

    const sharesBasis =
      event.eligibleSharesOverride !== null
        ? 'event_override'
        : 'current_portfolio_estimate';

    const amountMicros = calculateAmount(shares, event.dividendMicros);

    if (amountMicros !== null) {
      totalMicros += amountMicros;
      anyItemHasAmount = true;
    } else {
      anyItemPending = true;
    }

    items.push({
      instrumentId,
      market: port.market ?? (instrumentId.startsWith('tpex:') ? 'tpex' : 'twse'),
      kind: port.kind ?? 'etf',
      code: event.code,
      name: port.displayName,
      shares: String(shares),
      sharesBasis,
      dividendPerUnit: event.dividendMicros !== null ? formatMicros(event.dividendMicros) : null,
      payDate: event.payDate,
      estimatedGrossAmount: amountMicros !== null ? formatMicros(amountMicros) : null,
      previousClose: price?.previousCloseMicros !== null && price?.previousCloseMicros !== undefined
        ? formatMicros(BigInt(price.previousCloseMicros))
        : null,
      currentTrade: price?.latestPriceMicros !== null && price?.latestPriceMicros !== undefined
        ? formatMicros(BigInt(price.latestPriceMicros))
        : null,
      tradeDate: price?.tradeDate ?? null,
      tradeTime: price?.tradeTime ?? null,
      priceStatus: price?.status ?? null,
      priceStale: price?.stale ?? false,
      source: {
        kind: event.canonicalSourceKind,
        label: SOURCE_LABELS[event.canonicalSourceKind] ?? event.canonicalSourceKind,
      },
      hasConflict: event.status === 'conflict',
    });
    itemAmounts.push(amountMicros);
  }

  // Determine status
  let status: WidgetResponse['status'] = 'ok';
  if (items.length === 0) {
    status = 'no_announced_payout';
  } else if (anyItemPending && !anyItemHasAmount) {
    status = 'pending_amount';
  } else if (freshnessStale) {
    status = 'source_stale';
  }

  // Build display
  const monthLabel = `${period.month}月`;
  const totalStr = items.length > 0 && !anyItemPending ? formatMicrosWithCommas(totalMicros) : null;

  const lines: string[] = [];
  if (items.length === 0) {
    lines.push('本月尚無已公告配息');
  } else {
    for (const [index, item] of items.slice(0, 3).entries()) {
      const amountMicros = itemAmounts[index] ?? null;
      if (amountMicros !== null) {
        lines.push(
          `${item.code} ${item.payDate ?? '待定'}｜${Number(item.shares).toLocaleString()}股 ×${item.dividendPerUnit}＝${formatMicrosWithCommas(amountMicros)}｜昨${item.previousClose ?? '—'} 今${item.currentTrade ?? '—'}`,
        );
      } else {
        lines.push(`${item.code} 金額／發放日待公告`);
      }
    }
    if (items.length > 3) {
      lines.push(`另 ${items.length - 3} 筆`);
    }
  }

  const compact =
    items.length > 0 && totalStr
      ? `${monthLabel} $${totalStr}｜${items.map((item, index) => `${item.code} $${formatMicrosWithCommas(itemAmounts[index] ?? 0n)}`).join('｜')}`
      : null;

  return {
    status,
    period: {
      year: period.year,
      month: period.month,
      timezone: 'Asia/Taipei',
    },
    items,
    totalGrossAmount: items.length > 0 && !anyItemPending ? formatMicros(totalMicros) : null,
    display: {
      title: `${monthLabel}預計配息`,
      total: items.length > 0 && !anyItemPending ? `$${formatMicrosWithCommas(totalMicros)}` : null,
      lines,
      compact,
    },
    freshness: {
      stale: freshnessStale,
      lastSuccessfulSync,
    },
    generatedAt: new Date().toISOString(),
  };
}
