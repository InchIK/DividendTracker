import { z } from 'zod';

import { parseDecimalToMicros } from '../domain/money';
import type {
  NormalizedPriceRecord,
  PriceAdapterOutcome,
  PriceAdapterResult,
  PriceFetch,
} from './twse-prices';

const TPEX_URL = 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes';
const tpexRowsSchema = z.array(z.object({
  Date: z.string().min(1),
  SecuritiesCompanyCode: z.string().min(1),
  CompanyName: z.string().optional(),
  Close: z.string(),
}).passthrough());

function parseTpexDate(value: string): string | null {
  const compact = value.trim().replaceAll('/', '').replaceAll('-', '');
  if (!/^\d{7}$/.test(compact)) return null;
  const year = Number(compact.slice(0, 3)) + 1911;
  const month = compact.slice(3, 5);
  const day = compact.slice(5, 7);
  const result = `${year}-${month}-${day}`;
  const date = new Date(`${result}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === result
    ? result
    : null;
}

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

export async function fetchTpexPrices(
  activeInstrumentIds: ReadonlySet<string>,
  fetchImpl: PriceFetch,
  options: { observedAt: string; url?: string },
): Promise<PriceAdapterResult> {
  if (activeInstrumentIds.size === 0) {
    return { outcome: 'empty_selection', records: [], httpStatus: null, error: null };
  }

  let response: Response;
  try {
    response = await fetchImpl(options.url ?? TPEX_URL, {
      headers: { Accept: 'application/json' },
    });
  } catch (error) {
    return failure('http_error', null, error instanceof Error ? error.message : 'TPEx request failed');
  }
  if (!response.ok) return failure('http_error', response.status, `TPEx returned HTTP ${response.status}`);

  try {
    const rows = tpexRowsSchema.parse(await response.json());
    const records = rows
      .filter((row) => activeInstrumentIds.has(`tpex:${row.SecuritiesCompanyCode}`))
      .map((row): NormalizedPriceRecord => {
        const tradeDate = parseTpexDate(row.Date);
        if (tradeDate === null) throw new Error(`Invalid TPEx trade date for ${row.SecuritiesCompanyCode}`);
        const close = officialClose(row.Close);
        return {
          instrumentId: `tpex:${row.SecuritiesCompanyCode}`,
          priceMicros: null,
          previousCloseMicros: close,
          tradeDate,
          tradeTime: null,
          marketState: close === null ? 'no_trade' : 'closed',
          status: close === null ? 'not_covered' : 'partial',
          source: 'tpex_mainboard_quotes',
          observedAt: options.observedAt,
          stale: false,
          errorMessage: close === null ? 'No official close was published' : null,
          rawPayload: row,
        };
      });
    return { outcome: 'ok', records, httpStatus: response.status, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid TPEx response schema';
    return failure('schema_error', response.status, message);
  }
}
