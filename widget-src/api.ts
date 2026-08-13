/**
 * API request helper for the DividendTracker widget.
 *
 * Targets the Cloudflare Worker endpoint
 *   GET /api/v1/widget/upcoming
 * with the personalized read-only Widget bearer credential.
 *
 * Behavior:
 *   - 12-second timeout using Scriptable's native `Request.timeoutInterval`.
 *   - On 2xx → return a small response wrapper with `.json()` / `.text()`.
 *   - On non-2xx → throw `WidgetApiError` with status + body for the caller
 *     to decide whether to fall back to cache.
 *   - Network failure → throw `WidgetApiError` (status 0).
 *
 * This module is compiled into the widget bundle; it has no side effects at
 * import time.
 */

import type {
  UpcomingWidgetResponse,
  WidgetBackgroundMode,
  WidgetAppearance,
  WidgetResponse,
  WidgetTheme,
  WidgetSortMode,
} from './formatter';
import {
  DEFAULT_WIDGET_REFRESH_MINUTES,
  DEFAULT_WIDGET_SORT_MODE,
  MAX_WIDGET_REFRESH_MINUTES,
  MIN_WIDGET_REFRESH_MINUTES,
} from './formatter';

/** Error raised by `fetchWidgetData` when the API is unreachable or returns non-2xx. */
export class WidgetApiError extends Error {
  readonly status: number;
  readonly bodyText: string | null;
  override readonly cause?: unknown;

  constructor(message: string, status: number, bodyText?: string | null, cause?: unknown) {
    super(message);
    this.name = 'WidgetApiError';
    this.status = status;
    this.bodyText = bodyText ?? null;
    if (cause !== undefined) this.cause = cause;
  }
}

/** Timeout for widget API fetch. Keep generous enough for a slow cold start on Workers. */
export const WIDGET_API_TIMEOUT_MS = 12_000;

/** Canonical endpoint path on the Worker. */
export const WIDGET_API_PATH = '/api/v1/widget/upcoming';

/**
 * Build the API URL from a base URL (with or without trailing slash) and the
 * canonical path. Used by the widget, by the setup "test API" flow, and by the
 * probe scripts (with a different auth token).
 */
export function buildApiUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}${WIDGET_API_PATH}`;
}

/**
 * Fetch the widget payload and parse it. On any failure (network, non-2xx,
 * bad JSON) throws `WidgetApiError`. Callers should catch and fall back to
 * cache.
 *
 * Scriptable does not provide the browser Fetch API. Use its native `Request`
 * class so the downloaded bundle runs on iOS without a polyfill.
 */
export interface WidgetHttpResponse {
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

export async function fetchWidgetData(
  baseUrl: string,
  cfg: { widgetToken: string } | { baseUrl: string; widgetToken: string },
): Promise<WidgetHttpResponse> {
  const token = 'widgetToken' in cfg ? cfg.widgetToken : '';
  const url = buildApiUrl(baseUrl);

  const request = new Request(url);
  request.method = 'GET';
  request.headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };
  request.timeoutInterval = WIDGET_API_TIMEOUT_MS / 1_000;

  let bodyText: string;
  try {
    bodyText = await request.loadString();
  } catch (err) {
    throw new WidgetApiError(
      `網路錯誤：${(err as Error).message ?? 'unknown'}`,
      0,
      null,
      err,
    );
  }

  const status = request.response?.statusCode ?? 0;
  if (status < 200 || status >= 300) {
    throw new WidgetApiError(`HTTP ${status}`, status, bodyText);
  }

  return {
    status,
    text() { return Promise.resolve(bodyText); },
    json() { return Promise.resolve(JSON.parse(bodyText) as unknown); },
  };
}

/**
 * Convenience: fetch + parse JSON in one step. Returns the validated two-period payload
 * or throws `WidgetApiError`.
 */
export async function fetchWidgetPayload(
  baseUrl: string,
  widgetToken: string,
): Promise<UpcomingWidgetResponse> {
  const res = await fetchWidgetData(baseUrl, { widgetToken });
  try {
    return parseUpcomingWidgetPayload(await res.json());
  } catch (err) {
    throw new WidgetApiError(`API 回應格式錯誤：${(err as Error).message}`, res.status, null, err);
  }
}

const VALID_STATUSES = new Set<WidgetResponse['status']>([
  'ok',
  'pending_amount',
  'no_announced_payout',
  'source_stale',
  'source_error',
]);
const VALID_THEMES = new Set<WidgetTheme>(['ocean', 'midnight', 'sunset', 'forest']);
const VALID_BACKGROUND_MODES = new Set<WidgetBackgroundMode>(['solid', 'gradient']);
const VALID_SORT_MODES = new Set<WidgetSortMode>(['dividend_desc', 'random', 'price_desc', 'featured']);
const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseNullableString(value: Record<string, unknown>, key: string, context: string): string | null {
  const field = value[key];
  if (field !== null && typeof field !== 'string') {
    throw new Error(`${context} has invalid ${key}`);
  }
  return field;
}

function parseWidgetItem(value: unknown, index: number): WidgetResponse['items'][number] {
  const context = `period item ${index}`;
  if (!isRecord(value)) throw new Error(`${context} must be an object`);
  if (typeof value.code !== 'string' || typeof value.name !== 'string' || typeof value.shares !== 'string') {
    throw new Error(`${context} has invalid required text fields`);
  }
  if (typeof value.hasConflict !== 'boolean') throw new Error(`${context} has invalid hasConflict`);

  const market = value.market;
  if (market !== undefined && market !== 'twse' && market !== 'tpex') {
    throw new Error(`${context} has invalid market`);
  }
  const kind = value.kind;
  if (kind !== undefined && kind !== 'stock' && kind !== 'etf') {
    throw new Error(`${context} has invalid kind`);
  }
  const sharesBasis = value.sharesBasis;
  if (sharesBasis !== undefined
    && sharesBasis !== 'event_override'
    && sharesBasis !== 'current_portfolio_estimate') {
    throw new Error(`${context} has invalid sharesBasis`);
  }
  if (value.instrumentId !== undefined && typeof value.instrumentId !== 'string') {
    throw new Error(`${context} has invalid instrumentId`);
  }
  if (value.priceStatus !== undefined && value.priceStatus !== null && typeof value.priceStatus !== 'string') {
    throw new Error(`${context} has invalid priceStatus`);
  }
  for (const key of ['previousClose', 'currentTrade', 'tradeDate', 'tradeTime'] as const) {
    if (value[key] !== undefined) parseNullableString(value, key, context);
  }
  if (value.priceStale !== undefined && typeof value.priceStale !== 'boolean') {
    throw new Error(`${context} has invalid priceStale`);
  }
  const source = value.source;
  let parsedSource: { kind: string; label: string } | undefined;
  if (source !== undefined) {
    if (!isRecord(source) || typeof source.kind !== 'string' || typeof source.label !== 'string') {
      throw new Error(`${context} has invalid source`);
    }
    parsedSource = { kind: source.kind, label: source.label };
  }

  return {
    code: value.code,
    name: value.name,
    shares: value.shares,
    dividendPerUnit: parseNullableString(value, 'dividendPerUnit', context),
    payDate: parseNullableString(value, 'payDate', context),
    estimatedGrossAmount: parseNullableString(value, 'estimatedGrossAmount', context),
    hasConflict: value.hasConflict,
    ...(value.instrumentId === undefined ? {} : { instrumentId: value.instrumentId }),
    ...(market === undefined ? {} : { market }),
    ...(kind === undefined ? {} : { kind }),
    ...(sharesBasis === undefined ? {} : { sharesBasis }),
    ...(value.previousClose === undefined ? {} : { previousClose: value.previousClose as string | null }),
    ...(value.currentTrade === undefined ? {} : { currentTrade: value.currentTrade as string | null }),
    ...(value.tradeDate === undefined ? {} : { tradeDate: value.tradeDate as string | null }),
    ...(value.tradeTime === undefined ? {} : { tradeTime: value.tradeTime as string | null }),
    ...(value.priceStatus === undefined ? {} : { priceStatus: value.priceStatus }),
    ...(value.priceStale === undefined ? {} : { priceStale: value.priceStale }),
    ...(parsedSource === undefined ? {} : { source: parsedSource }),
  };
}

function parseFreshness(value: unknown, context: string): WidgetResponse['freshness'] {
  if (!isRecord(value)
    || typeof value.stale !== 'boolean'
    || (value.lastSuccessfulSync !== null && typeof value.lastSuccessfulSync !== 'string')) {
    throw new Error(`${context} has invalid freshness`);
  }
  return {
    stale: value.stale,
    lastSuccessfulSync: value.lastSuccessfulSync,
  };
}

function validatePeriod(value: unknown, index: number): WidgetResponse {
  if (!isRecord(value)) throw new Error(`period ${index} must be an object`);
  if (typeof value.status !== 'string' || !VALID_STATUSES.has(value.status as WidgetResponse['status'])) {
    throw new Error(`period ${index} has invalid status`);
  }
  if (!isRecord(value.period)
    || !Number.isInteger(value.period.year)
    || !Number.isInteger(value.period.month)
    || (value.period.month as number) < 1
    || (value.period.month as number) > 12
    || value.period.timezone !== 'Asia/Taipei') {
    throw new Error(`period ${index} has invalid period`);
  }
  if (!Array.isArray(value.items)) throw new Error(`period ${index} has invalid items`);
  if (value.totalGrossAmount !== null && typeof value.totalGrossAmount !== 'string') {
    throw new Error(`period ${index} has invalid total`);
  }
  if (!isRecord(value.display)
    || typeof value.display.title !== 'string'
    || (value.display.total !== null && typeof value.display.total !== 'string')
    || !Array.isArray(value.display.lines)
    || !value.display.lines.every((line) => typeof line === 'string')
    || (value.display.compact !== null && typeof value.display.compact !== 'string')) {
    throw new Error(`period ${index} has invalid display`);
  }
  if (typeof value.generatedAt !== 'string') throw new Error(`period ${index} has invalid generatedAt`);
  return {
    status: value.status as WidgetResponse['status'],
    period: {
      year: value.period.year as number,
      month: value.period.month as number,
      timezone: value.period.timezone,
    },
    items: value.items.map((item, itemIndex) => parseWidgetItem(item, itemIndex)),
    totalGrossAmount: value.totalGrossAmount,
    display: {
      title: value.display.title,
      total: value.display.total,
      lines: value.display.lines,
      compact: value.display.compact,
    },
    generatedAt: value.generatedAt,
    ...(value.freshness === undefined ? {} : { freshness: parseFreshness(value.freshness, `period ${index}`) }),
  };
}

function validateAppearance(value: unknown): WidgetAppearance {
  if (!isRecord(value)
    || typeof value.theme !== 'string'
    || !VALID_THEMES.has(value.theme as WidgetTheme)
    || (value.updatedAt !== null && typeof value.updatedAt !== 'string')) {
    throw new Error('upcoming response has invalid appearance');
  }
  const hasCustomBackground = value.mode !== undefined
    || value.startColor !== undefined
    || value.endColor !== undefined;
  if (hasCustomBackground
    && (typeof value.mode !== 'string'
      || !VALID_BACKGROUND_MODES.has(value.mode as WidgetBackgroundMode)
      || typeof value.startColor !== 'string'
      || !HEX_COLOR_PATTERN.test(value.startColor)
      || typeof value.endColor !== 'string'
      || !HEX_COLOR_PATTERN.test(value.endColor))) {
    throw new Error('upcoming response has invalid appearance');
  }
  let mode: WidgetBackgroundMode = 'gradient';
  let startColor = '#071426';
  let endColor = '#0F766E';
  if (hasCustomBackground) {
    mode = value.mode as WidgetBackgroundMode;
    startColor = value.startColor as string;
    endColor = value.endColor as string;
  }

  const sortMode = value.sortMode === undefined ? DEFAULT_WIDGET_SORT_MODE : value.sortMode;
  if (typeof sortMode !== 'string' || !VALID_SORT_MODES.has(sortMode as WidgetSortMode)) {
    throw new Error('upcoming response has invalid appearance');
  }
  const featuredInstrumentId = value.featuredInstrumentId === undefined
    ? null
    : value.featuredInstrumentId;
  if (featuredInstrumentId !== null
    && (typeof featuredInstrumentId !== 'string' || featuredInstrumentId.trim().length === 0)) {
    throw new Error('upcoming response has invalid appearance');
  }
  if (sortMode === 'featured' && featuredInstrumentId === null) {
    throw new Error('upcoming response has invalid appearance');
  }
  const refreshMinutes = value.refreshMinutes === undefined
    ? DEFAULT_WIDGET_REFRESH_MINUTES
    : value.refreshMinutes;
  if (typeof refreshMinutes !== 'number'
    || !Number.isInteger(refreshMinutes)
    || refreshMinutes < MIN_WIDGET_REFRESH_MINUTES
    || refreshMinutes > MAX_WIDGET_REFRESH_MINUTES) {
    throw new Error('upcoming response has invalid appearance');
  }
  return {
    theme: value.theme as WidgetTheme,
    updatedAt: value.updatedAt,
    mode,
    startColor,
    endColor,
    sortMode: sortMode as WidgetSortMode,
    featuredInstrumentId,
    refreshMinutes,
  };
}

export function parseUpcomingWidgetPayload(value: unknown): UpcomingWidgetResponse {
  if (!isRecord(value) || !Array.isArray(value.periods) || value.periods.length !== 2) {
    throw new Error('upcoming response must contain exactly two periods');
  }
  const periods: [WidgetResponse, WidgetResponse] = [
    validatePeriod(value.periods[0], 0),
    validatePeriod(value.periods[1], 1),
  ];
  if (typeof value.generatedAt !== 'string') throw new Error('upcoming response has invalid generatedAt');
  const validatedAppearance = value.appearance === undefined
    ? undefined
    : validateAppearance(value.appearance);

  const current = periods[0].period;
  const following = periods[1].period;
  const expectedYear = current.month === 12 ? current.year + 1 : current.year;
  const expectedMonth = current.month === 12 ? 1 : current.month + 1;
  if (following.year !== expectedYear || following.month !== expectedMonth) {
    throw new Error('upcoming response periods must be consecutive');
  }
  return {
    periods,
    generatedAt: value.generatedAt,
    ...(validatedAppearance === undefined ? {} : { appearance: validatedAppearance }),
  };
}
