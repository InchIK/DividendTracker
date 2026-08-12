import { parseDate } from '../domain/date';
import { parseDecimalToMicros } from '../domain/money';
import { PRIORITY, type SourceObservation } from '../domain/reconciliation';
import type { WatchlistItemRow } from '../db/types';
import { fetchWithRetry } from './source-client';

export const FINMIND_DIVIDEND_URL = 'https://api.finmindtrade.com/api/v4/data';

interface FinmindDividendRow {
  date: string;
  stock_id: string;
  year: string;
  CashEarningsDistribution: number | string;
  CashStatutorySurplus: number | string;
  CashExDividendTradingDate: string;
  CashDividendPaymentDate: string;
  AnnouncementDate?: string;
  AnnouncementTime?: string;
  [key: string]: unknown;
}

interface FinmindResponse {
  status: number;
  msg: string;
  data: FinmindDividendRow[];
}

export interface FinmindInstrumentResult {
  instrumentId: string;
  rowsRead: number;
  observations: SourceObservation[];
  httpStatus: number | null;
  error: string | null;
}

function roundedMicros(value: number | string): bigint {
  const raw = String(value).trim();
  if (!/^\d+(?:\.\d+)?$/.test(raw)) throw new Error(`invalid dividend amount: ${raw}`);
  const [integer = '0', fraction = ''] = raw.split('.');
  const kept = fraction.slice(0, 6).padEnd(6, '0');
  let micros = parseDecimalToMicros(`${integer}.${kept}`) ?? 0n;
  if ((fraction[6] ?? '0') >= '5') micros += 1n;
  return micros;
}

function dividendMicros(row: FinmindDividendRow): bigint {
  return roundedMicros(row.CashEarningsDistribution ?? 0)
    + roundedMicros(row.CashStatutorySurplus ?? 0);
}

function rowRevisionKey(row: FinmindDividendRow): string {
  return `${row.AnnouncementDate ?? ''}T${row.AnnouncementTime ?? ''}|${row.date ?? ''}`;
}

function dedupeRows(rows: FinmindDividendRow[]): FinmindDividendRow[] {
  const latest = new Map<string, FinmindDividendRow>();
  for (const row of rows) {
    const exDate = parseDate(row.CashExDividendTradingDate ?? '');
    if (!exDate) continue;
    const previous = latest.get(exDate);
    if (!previous || rowRevisionKey(row) >= rowRevisionKey(previous)) latest.set(exDate, row);
  }
  return [...latest.values()].sort((left, right) =>
    left.CashExDividendTradingDate.localeCompare(right.CashExDividendTradingDate));
}

export async function fetchFinmindDividendHistory(
  instrument: Pick<WatchlistItemRow, 'instrument_id' | 'code' | 'market' | 'kind'>,
  startDate: string,
  endDate: string,
  observedAt: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FinmindInstrumentResult> {
  const url = new URL(FINMIND_DIVIDEND_URL);
  url.searchParams.set('dataset', 'TaiwanStockDividend');
  url.searchParams.set('data_id', instrument.code);
  url.searchParams.set('start_date', startDate);
  url.searchParams.set('end_date', endDate);

  try {
    const response = await fetchWithRetry(url.toString(), {
      accept: 'application/json',
      timeoutMs: 20_000,
      fetchImpl,
    });
    if (!response.ok) throw new Error(`FinMind returned HTTP ${response.status}`);
    const payload = response.json<FinmindResponse>();
    if (payload.status !== 200 || !Array.isArray(payload.data)) {
      throw new Error(`FinMind rejected request: ${payload.msg || payload.status}`);
    }

    const observations: SourceObservation[] = [];
    for (const row of dedupeRows(payload.data.filter((item) => item.stock_id === instrument.code))) {
      const exDate = parseDate(row.CashExDividendTradingDate ?? '');
      if (!exDate) continue;
      const amount = dividendMicros(row);
      if (amount <= 0n) continue;
      observations.push({
        sourceKind: 'finmind_dividend',
        sourcePriority: PRIORITY.FINMIND_DIVIDEND,
        sourceUrl: FINMIND_DIVIDEND_URL,
        instrumentId: instrument.instrument_id,
        code: instrument.code,
        fundUnifiedNo: null,
        exDate,
        baseDate: parseDate(row.date ?? ''),
        payDate: parseDate(row.CashDividendPaymentDate ?? ''),
        dividendMicros: amount,
        observedAt,
        rawPayload: {
          market: instrument.market,
          kind: instrument.kind,
          query: { startDate, endDate },
          row,
        },
      });
    }

    return {
      instrumentId: instrument.instrument_id,
      rowsRead: payload.data.length,
      observations,
      httpStatus: response.status,
      error: null,
    };
  } catch (error) {
    return {
      instrumentId: instrument.instrument_id,
      rowsRead: 0,
      observations: [],
      httpStatus: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
