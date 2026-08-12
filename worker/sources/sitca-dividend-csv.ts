/**
 * SITCA Dividend CSV Adapter
 * Fetches official dividend data from 投信投顧公會境內基金配息資料 CSV.
 *
 * CSV headers: 基金類型,基金統編,基金名稱,配息幣別,配息基準日,除息日,收益分配發放日,每單位分派金額
 * Dates in YYYYMMDD format.
 *
 * If the fetch fails, log the error but do NOT delete existing events.
 */
import { fetchWithRetry } from './source-client';
import { hashPayload } from '../domain/reconciliation';
import { parseDate } from '../domain/date';
import { parseDecimalToMicros } from '../domain/money';
import type { SourceObservation } from './types';
import type { FundMappingRow } from '../db/types';

interface SitcaCsvResult {
  observations: SourceObservation[];
  rowsRead: number;
  newestSourceDate: string | null;
  payloadSha256: string | null;
  httpStatus: number | null;
  error: string | null;
}

/** RFC 4180 compatible CSV parser */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          // Escaped quote
          currentField += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        currentField += char;
        i++;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        i++;
      } else if (char === ',') {
        currentRow.push(currentField);
        currentField = '';
        i++;
      } else if (char === '\r') {
        // Handle \r\n or \r
        currentRow.push(currentField);
        rows.push(currentRow);
        currentRow = [];
        currentField = '';
        if (i + 1 < text.length && text[i + 1] === '\n') {
          i += 2;
        } else {
          i++;
        }
      } else if (char === '\n') {
        currentRow.push(currentField);
        rows.push(currentRow);
        currentRow = [];
        currentField = '';
        i++;
      } else {
        currentField += char;
        i++;
      }
    }
  }

  // Last field/row
  if (currentField !== '' || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  return rows.filter((r) => r.length > 0 && r.some((f) => f.trim() !== ''));
}

/** Normalize header: trim, remove BOM, full-width space → half-width */
function normalizeHeader(h: string): string {
  return h
    .trim()
    .replace(/^\uFEFF/, '')
    .replace(/\u3000/g, ' ');
}

export async function fetchSitcaDividendCsv(
  env: Env,
  fundMappings: FundMappingRow[],
): Promise<SitcaCsvResult> {
  const url =
    env.SITCA_DIVIDEND_CSV_URL ??
    'https://www.sitca.org.tw/MemberK0000/F/03/160547投信投顧公會境內基金配息資料.csv';
  const observedAt = new Date().toISOString();

  // Build set of unified_no for filtering
  const unifiedNoToCode = new Map<string, string>();
  for (const m of fundMappings) {
    if (m.fund_unified_no) {
      unifiedNoToCode.set(m.fund_unified_no, m.code);
    }
  }

  try {
    const res = await fetchWithRetry(url, { accept: 'text/csv, application/octet-stream' });
    const text = res.text.replace(/^\uFEFF/, '');

    const rows = parseCsv(text);
    if (rows.length < 2) {
      return {
        observations: [],
        rowsRead: 0,
        newestSourceDate: null,
        payloadSha256: null,
        httpStatus: res.status,
        error: 'CSV has no data rows',
      };
    }

    // Parse headers
    const headerRow = rows[0]!;
    const headers = headerRow.map(normalizeHeader);
    const colIdx = {
      type: headers.indexOf('基金類型'),
      unifiedNo: headers.indexOf('基金統編'),
      name: headers.indexOf('基金名稱'),
      currency: headers.indexOf('配息幣別'),
      baseDate: headers.indexOf('配息基準日'),
      exDate: headers.indexOf('除息日'),
      payDate: headers.indexOf('收益分配發放日'),
      perUnit: headers.indexOf('每單位分派金額'),
    };

    const observations: SourceObservation[] = [];
    let newestDate: string | null = null;

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r]!;
      if (row.length < headers.length) continue;

      const fundType = (row[colIdx.type] ?? '')?.trim() ?? '';
      const unifiedNo = (row[colIdx.unifiedNo] ?? '')?.trim() ?? '';
      const currency = (row[colIdx.currency] ?? '')?.trim() ?? '';

      // Only TWD dividends, only our ETFs by unified_no
      if (currency !== 'TWD') continue;
      const code = unifiedNoToCode.get(unifiedNo);
      if (!code) continue;

      const exDate = parseDate(row[colIdx.exDate] ?? '');
      const payDate = parseDate(row[colIdx.payDate] ?? '');
      const baseDate = parseDate(row[colIdx.baseDate] ?? '');
      const perUnitRaw = (row[colIdx.perUnit] ?? '')?.trim() ?? '';

      if (!exDate) continue; // Need at least ex_date

      // Track newest source date
      if (payDate && (newestDate === null || payDate > newestDate)) {
        newestDate = payDate;
      }

      // Parse dividend amount — empty → null (pending), NOT 0
      let dividendMicros: bigint | null = null;
      if (perUnitRaw !== '' && perUnitRaw !== '尚未公告') {
        try {
          dividendMicros = parseDecimalToMicros(perUnitRaw);
        } catch {
          dividendMicros = null;
        }
      }

      observations.push({
        sourceKind: 'sitca_open_data' as const,
        sourcePriority: 80,
        sourceUrl: url,
        code,
        fundUnifiedNo: unifiedNo,
        exDate,
        baseDate,
        payDate,
        dividendMicros,
        observedAt,
        rawPayload: {
          fundType,
          unifiedNo,
          name: (row[colIdx.name] ?? '')?.trim() ?? '',
          currency,
          baseDate: (row[colIdx.baseDate] ?? '')?.trim() ?? '',
          exDate: (row[colIdx.exDate] ?? '')?.trim() ?? '',
          payDate: (row[colIdx.payDate] ?? '')?.trim() ?? '',
          perUnit: perUnitRaw,
        },
      });
    }

    const payloadSha = await hashPayload({ rows: rows.length, headers });

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