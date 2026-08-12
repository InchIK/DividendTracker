import { fetchTwstockRealtimePrices } from '../sources/twstock-realtime-prices';
import { fetchTpexPrices } from '../sources/tpex-prices';
import {
  fetchTwsePrices,
  type NormalizedPriceRecord,
  type PriceAdapterResult,
  type PriceFetch,
} from '../sources/twse-prices';
import type { MarketState, PriceStatus, SelectedPriceInstrumentRow } from '../db/types';

export interface PriceSyncSnapshot {
  instrumentId: string;
  priceMicros: bigint | null;
  previousCloseMicros: bigint | null;
  tradeDate: string | null;
  tradeTime: string | null;
  marketState: MarketState;
  status: PriceStatus;
  source: string;
  httpStatus: number | null;
  observedAt: string;
  stale: boolean;
  errorMessage: string | null;
  rawPayload: unknown;
}

export interface PriceSyncDependencies {
  now: () => string;
  previousTradingDate: (observedAt: string) => string;
  fetchImpl: PriceFetch;
  fetchTwsePrices: typeof fetchTwsePrices;
  fetchTpexPrices: typeof fetchTpexPrices;
  fetchTwstockRealtimePrices: typeof fetchTwstockRealtimePrices;
  persistPriceSnapshots: typeof persistPriceSnapshots;
}

export interface PriceSyncOptions extends Partial<PriceSyncDependencies> {
  /** Restrict an immediate refresh to newly configured instruments. */
  instrumentIds?: ReadonlySet<string>;
}

export interface PriceSyncResult {
  outcome: 'empty_selection' | 'success' | 'partial' | 'failed';
  selected: number;
  persisted: number;
  complete: number;
  partial: number;
  stale: number;
  errors: string[];
  sources: Record<string, string>;
}

const SOURCE_BY_MARKET = {
  twse: 'twse_stock_day_all',
  tpex: 'tpex_mainboard_quotes',
} as const;

function defaultPreviousTradingDate(observedAt: string): string {
  const date = new Date(observedAt);
  if (Number.isNaN(date.getTime())) throw new Error('Invalid price synchronization timestamp');
  do {
    date.setUTCDate(date.getUTCDate() - 1);
  } while (date.getUTCDay() === 0 || date.getUTCDay() === 6);
  return date.toISOString().slice(0, 10);
}

function selectedFetcher(): PriceFetch {
  return (input, init) => fetch(input, init);
}

function boundedJson(value: unknown): string {
  const json = JSON.stringify(value) ?? 'null';
  return json.length <= 16_384
    ? json
    : JSON.stringify({ truncated: true, preview: json.slice(0, 16_300) });
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function safeMicros(value: bigint | null): number | null {
  if (value === null) return null;
  if (value <= 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Price micros are outside the safe D1 integer range');
  }
  return Number(value);
}

export async function persistPriceSnapshots(
  db: D1Database,
  snapshots: PriceSyncSnapshot[],
  updatedAt: string,
): Promise<void> {
  const statements: D1PreparedStatement[] = [];
  for (const snapshot of snapshots) {
    const rawPayload = boundedJson(snapshot.rawPayload);
    const payloadSha256 = await sha256(rawPayload);
    const observationKey = `${snapshot.instrumentId}:${snapshot.observedAt}:${payloadSha256.slice(0, 16)}`;
    const priceMicros = safeMicros(snapshot.priceMicros);
    const previousCloseMicros = safeMicros(snapshot.previousCloseMicros);

    statements.push(
      db.prepare(
        `INSERT OR IGNORE INTO price_observations
           (observation_key, instrument_id, price_micros, previous_close_micros,
            trade_date, trade_time, market_state, status, source, http_status,
            observed_at, payload_sha256, raw_payload, error_message, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        observationKey,
        snapshot.instrumentId,
        priceMicros,
        previousCloseMicros,
        snapshot.tradeDate,
        snapshot.tradeTime,
        snapshot.marketState,
        snapshot.status,
        snapshot.source,
        snapshot.httpStatus,
        snapshot.observedAt,
        payloadSha256,
        rawPayload,
        snapshot.errorMessage,
        updatedAt,
      ),
      db.prepare(
        `INSERT INTO latest_prices
           (instrument_id, price_micros, previous_close_micros, trade_date, trade_time,
            market_state, status, source, observed_at, stale, error_message, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(instrument_id) DO UPDATE SET
           price_micros = COALESCE(excluded.price_micros, latest_prices.price_micros),
           previous_close_micros = COALESCE(excluded.previous_close_micros, latest_prices.previous_close_micros),
           trade_date = CASE WHEN excluded.status IN ('stale', 'error')
             THEN latest_prices.trade_date ELSE COALESCE(excluded.trade_date, latest_prices.trade_date) END,
           trade_time = CASE WHEN excluded.status IN ('stale', 'error')
             THEN latest_prices.trade_time ELSE COALESCE(excluded.trade_time, latest_prices.trade_time) END,
           market_state = excluded.market_state,
           status = excluded.status,
           source = excluded.source,
           observed_at = excluded.observed_at,
           stale = excluded.stale,
           error_message = excluded.error_message,
           updated_at = excluded.updated_at`,
      ).bind(
        snapshot.instrumentId,
        priceMicros,
        previousCloseMicros,
        snapshot.tradeDate,
        snapshot.tradeTime,
        snapshot.marketState,
        snapshot.status,
        snapshot.source,
        snapshot.observedAt,
        snapshot.stale ? 1 : 0,
        snapshot.errorMessage,
        updatedAt,
      ),
    );
  }
  if (statements.length > 0) await db.batch(statements);
}

function sourceFailureSnapshot(
  instrument: SelectedPriceInstrumentRow,
  result: PriceAdapterResult,
  observedAt: string,
): PriceSyncSnapshot {
  const source = SOURCE_BY_MARKET[instrument.market];
  const message = result.error ?? `${source} failed without an error message`;
  return {
    instrumentId: instrument.instrument_id,
    priceMicros: null,
    previousCloseMicros: null,
    tradeDate: null,
    tradeTime: null,
    marketState: 'unknown',
    status: 'error',
    source,
    httpStatus: result.httpStatus,
    observedAt,
    stale: true,
    errorMessage: message,
    rawPayload: { instrumentId: instrument.instrument_id, source, outcome: result.outcome, error: message },
  };
}

function mergeSnapshot(
  instrument: SelectedPriceInstrumentRow,
  official: NormalizedPriceRecord | undefined,
  intraday: NormalizedPriceRecord | undefined,
  officialHttpStatus: number | null,
  intradayHttpStatus: number | null,
  observedAt: string,
): PriceSyncSnapshot {
  const priceMicros = intraday?.priceMicros ?? null;
  const previousCloseMicros = official?.previousCloseMicros ?? intraday?.previousCloseMicros ?? null;
  const errorMessages = [intraday?.errorMessage, official?.errorMessage].filter((item): item is string => Boolean(item));
  const marketState = intraday?.marketState ?? official?.marketState ?? 'unknown';
  const hasCompletePrice = priceMicros !== null && previousCloseMicros !== null;
  const hasAnyPrice = priceMicros !== null || previousCloseMicros !== null;
  const stale = intraday?.stale === true || (!hasAnyPrice && errorMessages.length > 0);
  let status: PriceStatus = hasCompletePrice ? 'complete' : hasAnyPrice ? 'partial' : 'not_covered';
  if (stale) status = 'stale';

  const sources = [intraday?.source, official?.source].filter((item): item is string => Boolean(item));
  const source = sources.join('+') || SOURCE_BY_MARKET[instrument.market];
  return {
    instrumentId: instrument.instrument_id,
    priceMicros,
    previousCloseMicros,
    tradeDate: intraday?.tradeDate ?? official?.tradeDate ?? null,
    tradeTime: intraday?.tradeTime ?? official?.tradeTime ?? null,
    marketState,
    status,
    source,
    httpStatus: intraday ? intradayHttpStatus : officialHttpStatus,
    observedAt,
    stale,
    errorMessage: errorMessages.length > 0 ? errorMessages.join('; ') : null,
    rawPayload: {
      instrumentId: instrument.instrument_id,
      intraday: intraday?.rawPayload ?? null,
      official: official?.rawPayload ?? null,
    },
  };
}

export async function runPriceSync(
  env: Env,
  options: PriceSyncOptions = {},
): Promise<PriceSyncResult> {
  const { instrumentIds, ...overrides } = options;
  const deps: PriceSyncDependencies = {
    now: () => new Date().toISOString(),
    previousTradingDate: defaultPreviousTradingDate,
    fetchImpl: selectedFetcher(),
    fetchTwsePrices,
    fetchTpexPrices,
    fetchTwstockRealtimePrices,
    persistPriceSnapshots,
    ...overrides,
  };
  const observedAt = deps.now();
  const selectedResult = await env.DB.prepare(
    `SELECT DISTINCT i.instrument_id, i.market, i.code
     FROM watchlist AS w
     JOIN instruments AS i ON i.instrument_id = w.instrument_id
     WHERE w.enabled = 1 AND w.archived_at IS NULL AND i.active = 1
     ORDER BY i.market, i.code`,
  ).all<SelectedPriceInstrumentRow>();
  const selected = (selectedResult.results ?? []).filter((item) =>
    instrumentIds === undefined || instrumentIds.has(item.instrument_id));
  if (selected.length === 0) {
    return {
      outcome: 'empty_selection', selected: 0, persisted: 0,
      complete: 0, partial: 0, stale: 0, errors: [], sources: {},
    };
  }

  const twseIds = new Set(selected.filter((item) => item.market === 'twse').map((item) => item.instrument_id));
  const tpexIds = new Set(selected.filter((item) => item.market === 'tpex').map((item) => item.instrument_id));
  const allIds = new Set(selected.map((item) => item.instrument_id));
  const sourceResults: Record<string, PriceAdapterResult> = {};

  if (twseIds.size > 0) {
    sourceResults.twse_stock_day_all = await deps.fetchTwsePrices(twseIds, deps.fetchImpl, {
      observedAt,
      tradeDate: deps.previousTradingDate(observedAt),
    });
  }
  if (tpexIds.size > 0) {
    sourceResults.tpex_mainboard_quotes = await deps.fetchTpexPrices(tpexIds, deps.fetchImpl, { observedAt });
  }
  sourceResults.twstock_twse_mis = await deps.fetchTwstockRealtimePrices(
    allIds,
    deps.fetchImpl,
    { observedAt },
  );

  const recordsBySource = new Map<string, Map<string, NormalizedPriceRecord>>();
  for (const [source, result] of Object.entries(sourceResults)) {
    recordsBySource.set(source, new Map(result.records.map((item) => [item.instrumentId, item])));
  }
  const errors = Object.values(sourceResults)
    .filter((item) => !['ok', 'empty_selection', 'not_configured'].includes(item.outcome))
    .flatMap((item) => item.error ? [item.error] : []);

  const snapshots = selected.map((instrument): PriceSyncSnapshot => {
    const officialSource = SOURCE_BY_MARKET[instrument.market];
    const officialResult = sourceResults[officialSource];
    if (officialResult && officialResult.outcome !== 'ok') {
      return sourceFailureSnapshot(instrument, officialResult, observedAt);
    }
    return mergeSnapshot(
      instrument,
      recordsBySource.get(officialSource)?.get(instrument.instrument_id),
      recordsBySource.get('twstock_twse_mis')?.get(instrument.instrument_id),
      officialResult?.httpStatus ?? null,
      sourceResults.twstock_twse_mis?.httpStatus ?? null,
      observedAt,
    );
  });

  await deps.persistPriceSnapshots(env.DB, snapshots, observedAt);
  const complete = snapshots.filter((item) => item.status === 'complete').length;
  const stale = snapshots.filter((item) => item.status === 'stale' || item.status === 'error').length;
  const partial = snapshots.length - complete - stale;
  const failed = snapshots.every((item) => item.status === 'error');
  return {
    outcome: failed ? 'failed' : complete === snapshots.length ? 'success' : 'partial',
    selected: selected.length,
    persisted: snapshots.length,
    complete,
    partial,
    stale,
    errors,
    sources: Object.fromEntries(Object.entries(sourceResults).map(([source, value]) => [source, value.outcome])),
  };
}
