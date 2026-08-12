/**
 * TWSE Ex-Dividend Schedule Adapter — TWT48U_ALL
 * Fetches ex-dividend schedule from TWSE open data.
 * Date field is ROC compact (e.g. "1150818" → 2026-08-18).
 * CashDividend is often empty string for ETFs → null (NOT 0).
 */
import { fetchWithRetry } from './source-client';
import { hashPayload } from '../domain/reconciliation';
import { parseRocCompactDate } from '../domain/date';
import { parseDecimalToMicros } from '../domain/money';
import type { SourceObservation } from './types';
import { getSelectedTwseCodes } from './selected-instruments';

interface TwseExDividendRow {
  Date: string; // ROC compact, e.g. "1150818"
  Code: string; // ETF code, e.g. "0050"
  Name: string;
  CashDividend: string; // often empty string for ETFs
  [key: string]: string;
}

export interface TwseExDividendResult {
  observations: SourceObservation[];
  rowsRead: number;
  newestSourceDate: string | null;
  payloadSha256: string | null;
  httpStatus: number | null;
  error: string | null;
}

export async function fetchTwseExDividend(
  env: Env,
): Promise<TwseExDividendResult> {
  const url =
    env.TWSE_EX_DIVIDEND_URL ??
    'https://openapi.twse.com.tw/v1/exchangeReport/TWT48U_ALL';
  const observedAt = new Date().toISOString();
  // TWT48U_ALL covers selected TWSE stocks and ETFs.
  const selectedCodes = await getSelectedTwseCodes(env.DB);
  if (selectedCodes.size === 0) {
    return { observations: [], rowsRead: 0, newestSourceDate: null, payloadSha256: null, httpStatus: null, error: null };
  }

  try {
    const res = await fetchWithRetry(url, { accept: 'application/json' });
    const rows = res.json<TwseExDividendRow[]>();
    const filtered = rows.filter((row) => selectedCodes.has(row.Code));
    const payloadSha = await hashPayload(filtered);

    const observations: SourceObservation[] = [];
    let newestDate: string | null = null;

    for (const row of filtered) {
      const exDate = parseRocCompactDate(row.Date);
      if (!exDate) continue;

      // Track newest source date
      if (newestDate === null || exDate > newestDate) {
        newestDate = exDate;
      }

      // CashDividend: empty string → null, NOT 0
      const cashDividendRaw = row.CashDividend?.trim() ?? '';
      const dividendMicros = cashDividendRaw === '' ? null : parseDecimalToMicros(cashDividendRaw);

      observations.push({
        sourceKind: 'twse_ex_schedule' as const,
        sourcePriority: 20,
        sourceUrl: url,
        code: row.Code,
        fundUnifiedNo: null,
        exDate,
        baseDate: null,
        payDate: null, // TWSE schedule doesn't have pay_date
        dividendMicros,
        observedAt,
        rawPayload: row,
      });
    }

    return {
      observations,
      rowsRead: observations.length,
      newestSourceDate: newestDate,
      payloadSha256: payloadSha,
      httpStatus: res.status,
      error: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      observations: [],
      rowsRead: 0,
      newestSourceDate: null,
      payloadSha256: null,
      httpStatus: null,
      error: message,
    };
  }
}