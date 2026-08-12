import { z } from 'zod';

import { parseDecimalToMicros } from '../domain/money';

export type PriceMarketState = 'trading' | 'closed' | 'halted' | 'no_trade' | 'unknown';
export type PriceStatus = 'complete' | 'partial' | 'not_covered' | 'stale' | 'error';

export interface NormalizedPriceRecord {
  instrumentId: string;
  priceMicros: bigint | null;
  previousCloseMicros: bigint | null;
  tradeDate: string | null;
  tradeTime: string | null;
  marketState: PriceMarketState;
  status: PriceStatus;
  source: string;
  observedAt: string;
  stale: boolean;
  errorMessage: string | null;
  rawPayload: unknown;
}

export type PriceAdapterOutcome =
  | 'ok'
  | 'empty_selection'
  | 'not_configured'
  | 'unauthorized'
  | 'rate_limited'
  | 'schema_error'
  | 'http_error';

export interface PriceAdapterResult {
  outcome: PriceAdapterOutcome;
  records: NormalizedPriceRecord[];
  httpStatus: number | null;
  error: string | null;
}

export type PriceFetch = (input: string, init?: RequestInit) => Promise<Response>;

const TWSE_URL = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL';
const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const twseRowsSchema = z.array(z.object({
  Code: z.string().min(1),
  Name: z.string().optional(),
  ClosingPrice: z.string(),
}).passthrough());

function officialClose(raw: string): bigint | null {
  const value = raw.trim();
  if (value === '' || value === '-' || value === '--') return null;
  const micros = parseDecimalToMicros(value);
  return micros !== null && micros > 0n ? micros : null;
}

function failure(
  outcome: PriceAdapterOutcome,
  httpStatus: number | null,
  error: string,
): PriceAdapterResult {
  return { outcome, records: [], httpStatus, error };
}

export async function fetchTwsePrices(
  activeInstrumentIds: ReadonlySet<string>,
  fetchImpl: PriceFetch,
  options: { observedAt: string; tradeDate: string; url?: string },
): Promise<PriceAdapterResult> {
  if (activeInstrumentIds.size === 0) {
    return { outcome: 'empty_selection', records: [], httpStatus: null, error: null };
  }
  if (!isoDate.test(options.tradeDate)) {
    return failure('schema_error', null, 'Invalid TWSE trade date');
  }

  let response: Response;
  try {
    response = await fetchImpl(options.url ?? TWSE_URL, {
      headers: { Accept: 'application/json' },
    });
  } catch (error) {
    return failure('http_error', null, error instanceof Error ? error.message : 'TWSE request failed');
  }
  if (!response.ok) return failure('http_error', response.status, `TWSE returned HTTP ${response.status}`);

  try {
    const rows = twseRowsSchema.parse(await response.json());
    const records = rows
      .filter((row) => activeInstrumentIds.has(`twse:${row.Code}`))
      .map((row): NormalizedPriceRecord => {
        const close = officialClose(row.ClosingPrice);
        return {
          instrumentId: `twse:${row.Code}`,
          priceMicros: null,
          previousCloseMicros: close,
          tradeDate: options.tradeDate,
          tradeTime: null,
          marketState: close === null ? 'no_trade' : 'closed',
          status: close === null ? 'not_covered' : 'partial',
          source: 'twse_stock_day_all',
          observedAt: options.observedAt,
          stale: false,
          errorMessage: close === null ? 'No official close was published' : null,
          rawPayload: row,
        };
      });
    return { outcome: 'ok', records, httpStatus: response.status, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid TWSE response schema';
    return failure('schema_error', response.status, message);
  }
}
