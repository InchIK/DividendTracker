/**
 * TWSE Fund Mapping Adapter — t187ap47_L
 * Fetches ETF code → fund_unified_no mapping from TWSE open data.
 */
import { fetchWithRetry } from './source-client';
import { hashPayload } from '../domain/reconciliation';
import type { SourceObservation } from './types';
import { getSelectedTwseCodes } from './selected-instruments';

interface TwseFundMappingRow {
  基金代號: string;
  基金簡稱: string;
  基金統一編號: string;
  [key: string]: string;
}

export interface TwseFundMappingResult {
  observations: SourceObservation[];
  rowsRead: number;
  newestSourceDate: string | null;
  payloadSha256: string | null;
  httpStatus: number | null;
  error: string | null;
}

export async function fetchTwseFundMapping(
  env: Env,
): Promise<TwseFundMappingResult> {
  const url =
    env.TWSE_FUND_MAPPING_URL ??
    'https://openapi.twse.com.tw/v1/opendata/t187ap47_L';
  const observedAt = new Date().toISOString();
  // This endpoint is a fund master, so stocks are intentionally out of scope.
  const selectedCodes = await getSelectedTwseCodes(env.DB, 'etf');
  if (selectedCodes.size === 0) {
    return { observations: [], rowsRead: 0, newestSourceDate: null, payloadSha256: null, httpStatus: null, error: null };
  }

  try {
    const res = await fetchWithRetry(url, { accept: 'application/json' });
    const rows = res.json<TwseFundMappingRow[]>();
    const filtered = rows.filter((row) => selectedCodes.has(row['基金代號']));
    const payloadSha = await hashPayload(filtered);

    const observations: SourceObservation[] = filtered.map((row) => ({
      sourceKind: 'twse_fund_mapping' as const,
      sourcePriority: 10,
      sourceUrl: url,
      code: row['基金代號'],
      fundUnifiedNo: row['基金統一編號'] ?? null,
      exDate: null,
      baseDate: null,
      payDate: null,
      dividendMicros: null,
      observedAt,
      rawPayload: row,
    }));

    return {
      observations,
      rowsRead: filtered.length,
      newestSourceDate: observedAt,
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