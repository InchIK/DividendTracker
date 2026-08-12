/** Read-only health probe for the configured public market data sources. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requestedCodes = process.argv.slice(2).map((code) => code.trim().toUpperCase());
if (requestedCodes.some((code) => !/^[A-Z0-9]{2,10}$/u.test(code))) {
  throw new Error('標的代碼必須是 2 至 10 碼英數字。');
}

const TWSE_FUND_MAPPING_URL = 'https://openapi.twse.com.tw/v1/opendata/t187ap47_L';
const TWSE_EX_DIVIDEND_URL = 'https://openapi.twse.com.tw/v1/exchangeReport/TWT48U_ALL';
const SITCA_CSV_URL = 'https://www.sitca.org.tw/MemberK0000/F/03/160547投信投顧公會境內基金配息資料.csv';

type Row = Record<string, unknown>;

function field(row: Row, patterns: RegExp[]): string | undefined {
  const key = Object.keys(row).find((candidate) => patterns.some((pattern) => pattern.test(candidate)));
  const value = key ? row[key] : undefined;
  return typeof value === 'string' ? value.trim() : undefined;
}

async function fetchJson(url: string): Promise<{ status: number; rows: Row[] }> {
  const response = await fetch(url, { headers: { 'User-Agent': 'dividend-tracker-source-probe/1.0', Accept: 'application/json' } });
  const value: unknown = await response.json();
  return { status: response.status, rows: Array.isArray(value) ? value.filter((row): row is Row => typeof row === 'object' && row !== null) : [] };
}

async function probeMapping(): Promise<{ status: number; totalRows: number; requestedMatches: number; unifiedIds: string[] }> {
  try {
    const result = await fetchJson(TWSE_FUND_MAPPING_URL);
    const matches = requestedCodes.length === 0 ? [] : result.rows.filter((row) => {
      const code = field(row, [/code/i, /代號/u, /代碼/u]);
      return code !== undefined && requestedCodes.includes(code.toUpperCase());
    });
    const unifiedIds = matches.map((row) => field(row, [/unified/i, /統一/u, /編號/u])).filter((value): value is string => Boolean(value));
    return { status: result.status, totalRows: result.rows.length, requestedMatches: matches.length, unifiedIds };
  } catch {
    return { status: 0, totalRows: 0, requestedMatches: 0, unifiedIds: [] };
  }
}

async function probeExDividend(): Promise<{ status: number; totalRows: number; requestedMatches: number }> {
  try {
    const result = await fetchJson(TWSE_EX_DIVIDEND_URL);
    const matches = requestedCodes.length === 0 ? [] : result.rows.filter((row) => {
      const code = field(row, [/^code$/i, /代號/u, /代碼/u]);
      return code !== undefined && requestedCodes.includes(code.toUpperCase());
    });
    return { status: result.status, totalRows: result.rows.length, requestedMatches: matches.length };
  } catch {
    return { status: 0, totalRows: 0, requestedMatches: 0 };
  }
}

async function probeSitca(unifiedIds: string[]): Promise<{ status: number; totalRows: number; requestedMatches: number }> {
  try {
    const response = await fetch(SITCA_CSV_URL, { headers: { 'User-Agent': 'dividend-tracker-source-probe/1.0', Accept: 'text/csv, application/octet-stream' } });
    const text = (await response.text()).replace(/^\uFEFF/u, '');
    const lines = text.split(/\r?\n/u).filter((line) => line.trim());
    if (lines.length === 0 || unifiedIds.length === 0) return { status: response.status, totalRows: Math.max(0, lines.length - 1), requestedMatches: 0 };
    const headers = lines[0].split(',');
    const unifiedIndex = headers.findIndex((header) => /unified|統一|編號/u.test(header));
    const matches = unifiedIndex < 0 ? [] : lines.slice(1).filter((line) => unifiedIds.includes(line.split(',')[unifiedIndex]?.trim() ?? ''));
    return { status: response.status, totalRows: lines.length - 1, requestedMatches: matches.length };
  } catch {
    return { status: 0, totalRows: 0, requestedMatches: 0 };
  }
}

const timestamp = new Date();
const mapping = await probeMapping();
const [exDividend, sitca] = await Promise.all([
  probeExDividend(),
  probeSitca(mapping.unifiedIds),
]);
const report = {
  timestamp: timestamp.toISOString(),
  requestedCodes,
  sources: { twseFundMapping: { ...mapping, unifiedIds: undefined }, twseExDividend: exDividend, sitcaCsv: sitca },
};
const reportDir = resolve(rootDir, 'reports');
mkdirSync(reportDir, { recursive: true });
const fileStamp = timestamp.toISOString().replace(/[:T]/gu, '').replace(/\..*$/u, '');
const reportPath = resolve(reportDir, `source-probe-${fileStamp}.json`);
writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`來源健康檢查完成：${relative(rootDir, reportPath)}`);
