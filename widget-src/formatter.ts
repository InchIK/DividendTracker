/**
 * Display formatter helpers for the DividendTracker widget.
 *
 * These functions derive human-readable lines from the WidgetResponse payload
 * produced by the Cloudflare Worker (see `worker/domain/widget-response.ts`).
 * All text is in Traditional Chinese for the Taiwan audience.
 */

// ---------------------------------------------------------------------------
// Response payload type — must mirror `WidgetResponse` from the Worker domain.
// Kept inline so the widget source compiles standalone.
// ---------------------------------------------------------------------------

export interface WidgetItem {
  instrumentId?: string;
  market?: 'twse' | 'tpex';
  kind?: 'stock' | 'etf';
  code: string;
  name: string;
  shares: string;
  sharesBasis?: 'event_override' | 'current_portfolio_estimate';
  dividendPerUnit: string | null;
  payDate: string | null;
  estimatedGrossAmount: string | null;
  previousClose?: string | null;
  currentTrade?: string | null;
  tradeDate?: string | null;
  tradeTime?: string | null;
  priceStatus?: string | null;
  priceStale?: boolean;
  source?: {
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
  appearance?: WidgetAppearance;
}

export type WidgetTheme = 'ocean' | 'midnight' | 'sunset' | 'forest';
export type WidgetBackgroundMode = 'solid' | 'gradient';

export interface WidgetAppearance {
  theme: WidgetTheme;
  mode?: WidgetBackgroundMode;
  startColor?: string;
  endColor?: string;
  updatedAt: string | null;
}

export interface UpcomingWidgetResponse {
  periods: [WidgetResponse, WidgetResponse];
  generatedAt: string;
  appearance?: WidgetAppearance;
}

// ---------------------------------------------------------------------------
// Amounts.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

const COMPACT_UNITS = ['', 'K', 'M', 'B', 'T'] as const;

/** Compact an amount with an English suffix while preserving decimal-string precision. */
export function compactAmount(input: string | number): string {
  const value = compactAmountValue(input);
  return value === null ? '—' : `$${value}`;
}

/** Lock Screen total, for example `10K元`, `1.2M元`, or `500元`. */
export function compactYuanAmount(input: string | number): string {
  const value = compactAmountValue(input);
  return value === null ? '—' : `${value}元`;
}

function compactAmountValue(input: string | number): string | null {
  const raw = normalizeDecimal(input);
  if (raw === null) return null;
  const negative = raw.startsWith('-');
  const [integer = '0', fraction = ''] = raw.replace(/^-/, '').split('.');
  const wholeValue = BigInt(integer);

  let unitIndex = 0;
  let unitScale = 1n;
  while (unitIndex < COMPACT_UNITS.length - 1 && wholeValue >= unitScale * 1000n) {
    unitIndex += 1;
    unitScale *= 1000n;
  }

  if (unitIndex === 0) {
    return fullAmount(roundDecimal(raw, 1)).replace(/^\$/, '');
  }

  const fractionScale = 10n ** BigInt(fraction.length);
  const coefficient = BigInt(`${integer}${fraction}`);
  let divisor = unitScale * fractionScale;
  let tenths = ((coefficient * 10n) + divisor / 2n) / divisor;

  // Promote values such as 999.95K to 1M after rounding.
  if (tenths >= 10000n && unitIndex < COMPACT_UNITS.length - 1) {
    unitIndex += 1;
    unitScale *= 1000n;
    divisor = unitScale * fractionScale;
    tenths = ((coefficient * 10n) + divisor / 2n) / divisor;
  }

  const compactWhole = tenths / 10n;
  const compactDecimal = tenths % 10n;
  return `${negative ? '-' : ''}${compactWhole}${compactDecimal === 0n ? '' : `.${compactDecimal}`}${COMPACT_UNITS[unitIndex]}`;
}

/**
 * Full-string amount for Home Screen / StandBy. Formats the decimal string
 * directly so values larger than Number.MAX_SAFE_INTEGER remain exact.
 */
export function fullAmount(input: string | number | null | undefined): string {
  if (input === null || input === undefined || input === '') return '—';
  const raw = normalizeDecimal(input);
  if (raw === null) return '—';
  const rounded = roundDecimal(raw, 2);
  const [integer = '0', decimal = ''] = rounded.split('.');
  const sign = integer.startsWith('-') ? '-' : '';
  const digits = integer.replace('-', '').replace(/^0+(?=\d)/, '');
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `$${sign}${grouped}${decimal ? `.${decimal}` : ''}`;
}

function normalizeDecimal(input: string | number): string | null {
  const raw = String(input).trim().replace(/^\$/, '').replace(/,/g, '');
  return /^-?\d+(?:\.\d+)?$/.test(raw) ? raw : null;
}

function roundDecimal(raw: string, places: number): string {
  const negative = raw.startsWith('-');
  const unsigned = raw.replace(/^-/, '');
  const [integer = '0', fraction = ''] = unsigned.split('.');
  if (fraction.length <= places) {
    const trimmed = fraction.replace(/0+$/, '');
    return `${negative ? '-' : ''}${integer}${trimmed ? `.${trimmed}` : ''}`;
  }

  const kept = fraction.slice(0, places);
  const coefficient = BigInt(`${integer}${kept}`) + (fraction[places] >= '5' ? 1n : 0n);
  const scale = 10n ** BigInt(places);
  const whole = coefficient / scale;
  const decimals = places === 0
    ? ''
    : String(coefficient % scale).padStart(places, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${decimals ? `.${decimals}` : ''}`;
}

function formatShares(input: string): string {
  const digits = input.replace(/,/g, '');
  return /^\d+$/.test(digits) ? digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : input;
}

/**
 * Format a pay-date ISO string ("2026-08-10") for λ display.
 * The widget shows "8/10" on Lock Screen and "2026-08-10" on Home Screen.
 */
export function shortDate(isoDate: string | null): string {
  if (!isoDate) return '待定';
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  const [, , day] = parts;
  const m = parts[1].replace(/^0/, '');
  return `${m}/${day?.replace(/^0/, '')}`;
}

/** Lock Screen compact ISO date ("2026-08-10" → "8/10"). Identical to {@link shortDate}. */
export function payDateShort(isoDate: string | null): string {
  return shortDate(isoDate);
}

// ---------------------------------------------------------------------------
// Display line builders.
// ---------------------------------------------------------------------------

/**
 * Build up to 3 detail lines (for Home Screen / StandBy widgets).
 * Each line mirrors the dashboard fields in a phone-width compact form.
 * If no amount is yet announced, "金額待公告".
 */
export function buildDetailLines(items: WidgetItem[], maxLines = 3): string[] {
  const lines: string[] = [];
  for (let i = 0; i < Math.min(items.length, maxLines); i++) {
    const item = items[i];
    if (item.estimatedGrossAmount !== null && item.dividendPerUnit !== null) {
      const shares = formatShares(item.shares);
      lines.push(`${item.code} ${shortDate(item.payDate)}｜${shares}股 ×${item.dividendPerUnit} ${fullAmount(item.estimatedGrossAmount)}｜昨${item.previousClose ?? '—'} 今${item.currentTrade ?? '—'}`);
    } else {
      lines.push(`${item.code} 金額待公告`);
    }
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Status helpers.
// ---------------------------------------------------------------------------

/**
 * Map the API status enum to a user-friendly short label shown on the widget.
 * Returns null if the status is OK (no banner needed).
 */
export function statusBanner(status: WidgetResponse['status']): string | null {
  switch (status) {
    case 'ok':
      return null;
    case 'pending_amount':
      return '金額待公告';
    case 'no_announced_payout':
      return '尚無已公告配息';
    case 'source_stale':
      return '資料可能過期';
    case 'source_error':
      return '暫時無法取得';
    default:
      return null;
  }
}

export interface PeriodSummary {
  month: string;
  total: string;
  status: string | null;
  count: string;
}

export function buildUpcomingSummaries(res: UpcomingWidgetResponse): [PeriodSummary, PeriodSummary] {
  return res.periods.map((entry) => {
    let total = entry.display.total ?? '待公告';
    if (entry.status === 'no_announced_payout') total = '尚無配息';
    if (entry.status === 'source_error') total = '無法取得';
    return {
      month: `${entry.period.month}月`,
      total,
      status: statusBanner(entry.status),
      count: `${entry.items.length}筆`,
    };
  }) as [PeriodSummary, PeriodSummary];
}

export function markUpcomingPayloadStale(
  payload: UpcomingWidgetResponse,
  cachedAt: string,
): UpcomingWidgetResponse {
  return {
    ...payload,
    periods: payload.periods.map((entry) => ({
      ...entry,
      status: entry.status === 'ok' ? 'source_stale' : entry.status,
      freshness: {
        stale: true,
        lastSuccessfulSync: cachedAt,
      },
    })) as [WidgetResponse, WidgetResponse],
  };
}

/**
 * Build the small-widget summary content: month label, total amount, item count.
 */
export function buildSmallSummary(res: WidgetResponse): {
  month: string;
  total: string;
  count: string;
} {
  const month = `${res.period.month}月`;
  const total = res.display.total ?? '待公告';
  const count = `${res.items.length}筆`;
  return { month, total, count };
}

/**
 * Build the medium / StandBy hero content (title + total + 3 detail rows + footer).
 */
export function buildMediumContent(
  res: WidgetResponse,
): {
  title: string;
  total: string;
  detailLines: string[];
  footer: string;
} {
  const title = res.display.title;
  const total = res.display.total ?? '待公告';
  const detailLines = buildDetailLines(res.items, 3);

  const surplus = res.items.length - 3;
  let footer = '';
  if (res.items.length === 0) {
    footer = '本月尚無已公告配息';
  } else if (surplus > 0) {
    footer = `另${surplus}筆`;
  } else if (surplus === 0 && res.items.length === 3) {
    footer = '';
  } else if (surplus <= 0 && res.items.length > 0) {
    footer = '';
  }
  return { title, total, detailLines, footer };
}
