/** Strict parser for the user-authorized TWSE e添富 dividend table. */
import { parseDate } from '../domain/date';
import { parseDecimalToMicros } from '../domain/money';
import { makeEventKey } from '../domain/reconciliation';

export const ETFORTUNE_SOURCE_URL = 'https://www.twse.com.tw/zh/ETFortune/dividendList';
export const ETFORTUNE_PARSER_VERSION = '2';
export const ETFORTUNE_REQUIRED_HEADERS = [
  '證券代號',
  '證券名稱',
  '除息交易日',
  '收益分配基準日',
  '收益分配發放日',
  '每受益權單位配發金額',
] as const;
const ETFORTUNE_CURRENT_HEADERS = [
  '證券代號',
  '證券簡稱',
  '除息交易日',
  '收益分配基準日',
  '收益分配發放日',
  '收益分配金額 (每1受益權益單位)',
  '收益分配金標準 (102年度起啟用)',
  '公告年度',
] as const;
const ETFORTUNE_HEADER_VARIANTS: readonly (readonly string[])[] = [
  ETFORTUNE_REQUIRED_HEADERS,
  ETFORTUNE_CURRENT_HEADERS,
];

const DEFAULT_MIN_ROWS = 1;
const DEFAULT_MAX_ROWS = 2_000;

export interface EtfortuneRawRow {
  code: string;
  name: string;
  exDate: string;
  baseDate: string;
  payDate: string;
  dividendPerUnit: string;
}

export interface EtfortuneObservation {
  eventKey: string;
  instrumentId: string;
  sourceKind: 'etfortune_html';
  sourcePriority: 90;
  sourceUrl: string;
  code: string;
  fundUnifiedNo: null;
  exDate: string;
  baseDate: string | null;
  payDate: string | null;
  dividendMicros: bigint | null;
  observedAt: string;
  rawPayload: EtfortuneRawRow;
}

export interface EtfortuneParseResult {
  sourceUrl: string;
  parserVersion: string;
  totalRows: number;
  selectedRows: number;
  earliestPayDate: string | null;
  latestPayDate: string | null;
  observations: EtfortuneObservation[];
}

export interface EtfortuneParseOptions {
  sourceUrl?: string;
  observedAt?: string;
  minRows?: number;
  maxRows?: number;
}

export class EtfortuneParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EtfortuneParseError';
  }
}

export function parseTwseEtfortuneHtml(
  html: string,
  selectedInstrumentIds: ReadonlySet<string>,
  options: EtfortuneParseOptions = {},
): EtfortuneParseResult {
  if (html.trim() === '') throw new EtfortuneParseError('e添富 empty payload');
  validateSelection(selectedInstrumentIds);

  const sourceUrl = options.sourceUrl ?? ETFORTUNE_SOURCE_URL;
  const observedAt = options.observedAt ?? new Date().toISOString();
  const minRows = options.minRows ?? DEFAULT_MIN_ROWS;
  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;
  validateThreshold(minRows, maxRows);

  const tableHtml = findTableById(html, 'myTable');
  const tableRows = parseTableRows(tableHtml);
  const headerRowIndex = tableRows.findIndex((row) => row.kind === 'header');
  if (headerRowIndex < 0) throw new EtfortuneParseError('e添富 table header is missing');

  const headers = tableRows[headerRowIndex]!.cells;
  if (!ETFORTUNE_HEADER_VARIANTS.some((variant) => sameStrings(headers, variant))) {
    throw new EtfortuneParseError(
      `e添富 header mismatch: unsupported ${headers.join(' | ')}`,
    );
  }

  const dataRows = tableRows.slice(headerRowIndex + 1).filter((row) => row.kind === 'data');
  if (dataRows.length === 0) throw new EtfortuneParseError('e添富 table has no data rows');
  if (dataRows.length < minRows || dataRows.length > maxRows) {
    throw new EtfortuneParseError(
      `e添富 abnormal row count: ${dataRows.length} (expected ${minRows}-${maxRows})`,
    );
  }

  const observations: EtfortuneObservation[] = [];
  const observationsByKey = new Map<string, EtfortuneObservation>();

  for (let index = 0; index < dataRows.length; index++) {
    const cells = dataRows[index]!.cells;
    const code = cells[0]?.trim() ?? '';
    const instrumentId = `twse:${code}`;
    if (!selectedInstrumentIds.has(instrumentId)) continue;

    let observation: EtfortuneObservation;
    try {
      observation = parseSelectedRow(cells, headers.length, sourceUrl, observedAt);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new EtfortuneParseError(`e添富 malformed selected row ${index + 1} (${instrumentId}): ${detail}`);
    }

    const previous = observationsByKey.get(observation.eventKey);
    if (previous) {
      if (sameObservation(previous, observation)) {
        throw new EtfortuneParseError(`e添富 duplicate stable event key: ${observation.eventKey}`);
      }
      throw new EtfortuneParseError(`e添富 conflicting duplicate: ${observation.eventKey}`);
    }

    observationsByKey.set(observation.eventKey, observation);
    observations.push(observation);
  }

  const payDates = observations
    .map((observation) => observation.payDate)
    .filter((payDate): payDate is string => payDate !== null)
    .sort();

  return {
    sourceUrl,
    parserVersion: ETFORTUNE_PARSER_VERSION,
    totalRows: dataRows.length,
    selectedRows: observations.length,
    earliestPayDate: payDates[0] ?? null,
    latestPayDate: payDates.at(-1) ?? null,
    observations,
  };
}

function parseSelectedRow(
  cells: string[],
  expectedCellCount: number,
  sourceUrl: string,
  observedAt: string,
): EtfortuneObservation {
  if (cells.length !== expectedCellCount) {
    throw new Error(`expected ${expectedCellCount} cells, received ${cells.length}`);
  }

  const rawPayload: EtfortuneRawRow = {
    code: cells[0]!.trim(),
    name: cells[1]!.trim(),
    exDate: cells[2]!.trim(),
    baseDate: cells[3]!.trim(),
    payDate: cells[4]!.trim(),
    dividendPerUnit: cells[5]!.trim(),
  };
  if (!/^\d{4,6}$/.test(rawPayload.code) || rawPayload.name === '') {
    throw new Error('invalid code or empty name');
  }

  const exDate = parseDate(rawPayload.exDate);
  if (exDate === null) throw new Error('ex-date is pending');
  const baseDate = parseDate(rawPayload.baseDate);
  const payDate = parseDate(rawPayload.payDate);
  const dividendMicros = parseDecimalToMicros(rawPayload.dividendPerUnit);
  const instrumentId = `twse:${rawPayload.code}`;

  return {
    eventKey: makeEventKey(instrumentId, exDate),
    instrumentId,
    sourceKind: 'etfortune_html',
    sourcePriority: 90,
    sourceUrl,
    code: rawPayload.code,
    fundUnifiedNo: null,
    exDate,
    baseDate,
    payDate,
    dividendMicros,
    observedAt,
    rawPayload,
  };
}

function validateSelection(selectedInstrumentIds: ReadonlySet<string>): void {
  for (const instrumentId of selectedInstrumentIds) {
    if (!/^twse:\d{4,6}$/.test(instrumentId)) {
      throw new EtfortuneParseError(`selected instrument ID must be market-qualified: ${instrumentId}`);
    }
  }
}

function validateThreshold(minRows: number, maxRows: number): void {
  if (!Number.isInteger(minRows) || !Number.isInteger(maxRows) || minRows < 1 || maxRows < minRows) {
    throw new EtfortuneParseError('invalid abnormal row count threshold');
  }
}

interface ParsedTableRow {
  kind: 'header' | 'data';
  cells: string[];
}

function findTableById(html: string, id: string): string {
  const tablePattern = /<table\b([^>]*)>([\s\S]*?)<\/table\s*>/gi;
  for (const match of html.matchAll(tablePattern)) {
    if (readAttribute(match[1] ?? '', 'id') === id) return match[2] ?? '';
  }
  throw new EtfortuneParseError(`e添富 table#${id} is missing`);
}

function readAttribute(attributes: string, name: string): string | null {
  const pattern = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const match = attributes.match(pattern);
  return match ? (match[1] ?? match[2] ?? match[3] ?? '') : null;
}

function parseTableRows(tableHtml: string): ParsedTableRow[] {
  const rows: ParsedTableRow[] = [];
  for (const rowMatch of tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)) {
    const rowHtml = rowMatch[1] ?? '';
    const headerCells = extractCells(rowHtml, 'th');
    const dataCells = extractCells(rowHtml, 'td');
    if (headerCells.length > 0 && dataCells.length === 0) rows.push({ kind: 'header', cells: headerCells });
    else if (dataCells.length > 0 && headerCells.length === 0) rows.push({ kind: 'data', cells: dataCells });
  }
  return rows;
}

function extractCells(rowHtml: string, tag: 'th' | 'td'): string[] {
  const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, 'gi');
  return [...rowHtml.matchAll(pattern)].map((match) => normalizeCell(match[1] ?? ''));
}

function normalizeCell(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  };
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    }
    if (body.startsWith('#')) return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
    return named[body.toLowerCase()] ?? entity;
  });
}

function sameStrings(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function sameObservation(left: EtfortuneObservation, right: EtfortuneObservation): boolean {
  return (
    left.instrumentId === right.instrumentId &&
    left.exDate === right.exDate &&
    left.baseDate === right.baseDate &&
    left.payDate === right.payDate &&
    left.dividendMicros === right.dividendMicros &&
    sameStrings(Object.values(left.rawPayload), Object.values(right.rawPayload))
  );
}
