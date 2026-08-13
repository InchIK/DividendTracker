/**
 * Widget response builder.
 * Filters events by pay_date month (NOT ex_date month).
 * Calculates estimated gross amounts using BigInt micros.
 */
import { getCurrentPeriodInTaipei, yearMonthPrefix } from './date';
import { calculateAmount, formatMicros, formatMicrosWithCommas } from './money';
import type { WidgetSortMode } from './widget-appearance';
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

export interface WidgetBuildOptions {
  sortMode?: WidgetSortMode;
  featuredInstrumentId?: string | null;
  random?: () => number;
}

interface SortableWidgetItem {
  item: WidgetItem;
  amountMicros: bigint | null;
  priceMicros: bigint | null;
  originalIndex: number;
}

const SOURCE_LABELS: Record<string, string> = {
  manual_verified: '官方人工覆核',
  sitca_open_data: '政府開放資料',
  twse_ex_schedule: '證交所預告',
  etfortune_html: 'TWSE e添富',
  finmind_dividend: 'FinMind（TWSE/MOPS）',
};

function parseMicros(value: string | null | undefined): bigint | null {
  if (value === null || value === undefined || !/^-?\d+$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function compareTieBreakers(a: SortableWidgetItem, b: SortableWidgetItem): number {
  const payDateA = a.item.payDate ?? '\uffff';
  const payDateB = b.item.payDate ?? '\uffff';
  if (payDateA < payDateB) return -1;
  if (payDateA > payDateB) return 1;
  if (a.item.code < b.item.code) return -1;
  if (a.item.code > b.item.code) return 1;
  return a.originalIndex - b.originalIndex;
}

function compareNullableDescending(
  a: bigint | null,
  b: bigint | null,
): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (a > b) return -1;
  if (a < b) return 1;
  return 0;
}

function sortWidgetItems(
  entries: SortableWidgetItem[],
  options: WidgetBuildOptions,
): SortableWidgetItem[] {
  const sortMode = options.sortMode ?? 'dividend_desc';
  if (sortMode === 'random') {
    const random = options.random ?? Math.random;
    for (let index = entries.length - 1; index > 0; index -= 1) {
      const sampled = random();
      const normalized = Number.isFinite(sampled)
        ? Math.max(0, Math.min(sampled, 0.9999999999999999))
        : 0;
      const swapIndex = Math.floor(normalized * (index + 1));
      const current = entries[index];
      const replacement = entries[swapIndex];
      if (current && replacement) {
        entries[index] = replacement;
        entries[swapIndex] = current;
      }
    }
    return entries;
  }

  return entries.sort((a, b) => {
    if (sortMode === 'featured') {
      const featuredId = options.featuredInstrumentId;
      const aFeatured = featuredId !== null && featuredId !== undefined
        && a.item.instrumentId === featuredId;
      const bFeatured = featuredId !== null && featuredId !== undefined
        && b.item.instrumentId === featuredId;
      if (aFeatured !== bFeatured) return aFeatured ? -1 : 1;
      const byDividend = compareNullableDescending(a.amountMicros, b.amountMicros);
      return byDividend === 0 ? compareTieBreakers(a, b) : byDividend;
    }
    if (sortMode === 'price_desc') {
      const byPrice = compareNullableDescending(a.priceMicros, b.priceMicros);
      return byPrice === 0 ? compareTieBreakers(a, b) : byPrice;
    }
    const byDividend = compareNullableDescending(a.amountMicros, b.amountMicros);
    return byDividend === 0 ? compareTieBreakers(a, b) : byDividend;
  });
}

export function buildWidgetResponse(
  events: CanonicalEvent[],
  portfolio: PortfolioEntry[],
  year?: number,
  month?: number,
  freshnessStale = false,
  lastSuccessfulSync: string | null = null,
  prices: WidgetPriceEntry[] = [],
  options: WidgetBuildOptions = {},
): WidgetResponse {
  const period = year && month ? { year, month } : getCurrentPeriodInTaipei();
  const prefix = yearMonthPrefix(period.year, period.month);

  // Filter events by pay_date month
  const monthlyEvents = events.filter(
    (e) => e.payDate?.startsWith(prefix) === true,
  );

  const portfolioMap = new Map(portfolio.map((p) => [p.instrumentId ?? `twse:${p.code}`, p]));
  const priceMap = new Map(prices.map((price) => [price.instrumentId, price]));

  const entries: SortableWidgetItem[] = [];
  let totalMicros = 0n;
  let anyItemHasAmount = false;
  let anyItemPending = false;

  for (const event of monthlyEvents) {
    const instrumentId = event.instrumentId ?? `twse:${event.code}`;
    const port = portfolioMap.get(instrumentId);
    if (!port?.enabled) continue;
    const price = priceMap.get(instrumentId);
    const priceMicros = parseMicros(price?.latestPriceMicros)
      ?? parseMicros(price?.previousCloseMicros);
    const previousCloseMicros = parseMicros(price?.previousCloseMicros);
    const currentTradeMicros = parseMicros(price?.latestPriceMicros);

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

    const item: WidgetItem = {
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
      previousClose: previousCloseMicros !== null
        ? formatMicros(previousCloseMicros)
        : null,
      currentTrade: currentTradeMicros !== null
        ? formatMicros(currentTradeMicros)
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
    };
    entries.push({
      item,
      amountMicros,
      priceMicros,
      originalIndex: entries.length,
    });
  }

  const orderedEntries = sortWidgetItems(entries, options);
  const items = orderedEntries.map((entry) => entry.item);
  const itemAmounts = orderedEntries.map((entry) => entry.amountMicros);

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
