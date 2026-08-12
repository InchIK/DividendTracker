import { z } from 'zod';

import { parseDecimalToMicros } from '../domain/money';
import type {
  NormalizedPriceRecord,
  PriceAdapterOutcome,
  PriceAdapterResult,
  PriceFetch,
} from './twse-prices';

/**
 * TWSE MIS realtime adapter compatible with mlouielu/twstock's channel and
 * field mapping. twstock is MIT licensed: Copyright (c) 2017-2024 Louie Lu.
 * We port the protocol because Cloudflare Workers cannot execute Python.
 */
const MIS_URL = 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp';
const DEFAULT_STALE_AFTER_MS = 90 * 60 * 1000;

const rowSchema = z.object({
  ex: z.enum(['tse', 'otc']),
  ch: z.string().min(1),
  c: z.string().min(1),
  n: z.string().optional(),
  z: z.string().optional(),
  y: z.string().optional(),
  d: z.string().regex(/^\d{8}$/),
  t: z.string().regex(/^\d{2}:\d{2}:\d{2}$/),
  tlong: z.string().regex(/^\d+$/),
}).passthrough();

const responseSchema = z.object({
  rtcode: z.literal('0000'),
  msgArray: z.array(rowSchema),
}).passthrough();

type MisRow = z.infer<typeof rowSchema>;

function failure(
  outcome: PriceAdapterOutcome,
  httpStatus: number | null,
  error: string,
): PriceAdapterResult {
  return { outcome, records: [], httpStatus, error };
}

function positiveMicros(value: string | undefined): bigint | null {
  const normalized = value?.trim();
  if (!normalized || normalized === '-' || normalized === '--') return null;
  const micros = parseDecimalToMicros(normalized.replaceAll(',', ''));
  return micros !== null && micros > 0n ? micros : null;
}

function isoDate(compact: string): string {
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
}

function instrumentId(row: MisRow): string {
  return `${row.ex === 'tse' ? 'twse' : 'tpex'}:${row.c}`;
}

function taipeiMinutes(isoTimestamp: string): { day: number; minutes: number } {
  const shifted = new Date(Date.parse(isoTimestamp) + 8 * 60 * 60 * 1000);
  return { day: shifted.getUTCDay(), minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes() };
}

function normalize(
  row: MisRow,
  observedAt: string,
  staleAfterMs: number,
): NormalizedPriceRecord {
  const priceMicros = positiveMicros(row.z);
  const previousCloseMicros = positiveMicros(row.y);
  const observedMs = Date.parse(observedAt);
  const tradeMs = Number(row.tlong);
  if (!Number.isFinite(observedMs) || !Number.isFinite(tradeMs)) {
    throw new Error(`Invalid MIS timestamp for ${row.c}`);
  }

  const taipei = taipeiMinutes(observedAt);
  const marketOpen = taipei.day >= 1 && taipei.day <= 5 && taipei.minutes >= 9 * 60 && taipei.minutes < 13 * 60 + 30;
  const marketState: NormalizedPriceRecord['marketState'] = priceMicros === null
    ? 'no_trade'
    : marketOpen ? 'trading' : 'closed';
  const stale = marketOpen && priceMicros !== null && observedMs - tradeMs > staleAfterMs;
  let status: NormalizedPriceRecord['status'];
  if (stale) status = 'stale';
  else if (priceMicros !== null && previousCloseMicros !== null) status = 'complete';
  else if (priceMicros !== null || previousCloseMicros !== null) status = 'partial';
  else status = 'not_covered';

  return {
    instrumentId: instrumentId(row),
    priceMicros,
    previousCloseMicros,
    tradeDate: isoDate(row.d),
    tradeTime: row.t,
    marketState,
    status,
    source: 'twstock_twse_mis',
    observedAt,
    stale,
    errorMessage: priceMicros === null ? 'No latest trade was published by TWSE MIS' : null,
    rawPayload: row,
  };
}

function channel(id: string): string {
  const [market, code] = id.split(':', 2);
  if ((market !== 'twse' && market !== 'tpex') || !code) {
    throw new Error(`Invalid selected instrument ID: ${id}`);
  }
  return `${market === 'twse' ? 'tse' : 'otc'}_${code}.tw`;
}

export async function fetchTwstockRealtimePrices(
  activeInstrumentIds: ReadonlySet<string>,
  fetchImpl: PriceFetch,
  options: { observedAt: string; staleAfterMs?: number; url?: string },
): Promise<PriceAdapterResult> {
  if (activeInstrumentIds.size === 0) {
    return { outcome: 'empty_selection', records: [], httpStatus: null, error: null };
  }

  let channels: string[];
  try {
    channels = [...activeInstrumentIds].map(channel);
  } catch (error) {
    return failure('schema_error', null, error instanceof Error ? error.message : 'Invalid selected instrument');
  }
  const query = new URLSearchParams({
    ex_ch: channels.join('|'),
    json: '1',
    delay: '0',
  });

  let response: Response;
  try {
    response = await fetchImpl(`${options.url ?? MIS_URL}?${query.toString()}`, {
      headers: { Accept: 'application/json' },
    });
  } catch (error) {
    return failure('http_error', null, error instanceof Error ? error.message : 'TWSE MIS request failed');
  }
  if (response.status === 429) return failure('rate_limited', 429, 'TWSE MIS rate limit exceeded');
  if (!response.ok) return failure('http_error', response.status, `TWSE MIS returned HTTP ${response.status}`);

  try {
    const payload = responseSchema.parse(await response.json());
    const records = payload.msgArray
      .filter((row) => activeInstrumentIds.has(instrumentId(row)))
      .map((row) => normalize(row, options.observedAt, options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS));
    if (records.length === 0) {
      return failure('schema_error', response.status, 'TWSE MIS returned no selected instruments');
    }
    return { outcome: 'ok', records, httpStatus: response.status, error: null };
  } catch (error) {
    return failure(
      'schema_error',
      response.status,
      error instanceof Error ? error.message : 'Invalid TWSE MIS response schema',
    );
  }
}
