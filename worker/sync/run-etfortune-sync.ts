/** Low-frequency, selected-only synchronization for the authorized TWSE e添富 yearly table. */
import { upsertSourceStatus } from '../db/queries';
import { hashPayload } from '../domain/reconciliation';
import { SourceFetchError } from '../sources/types';
import { fetchWithRetry } from '../sources/source-client';
import {
  ETFORTUNE_PARSER_VERSION,
  ETFORTUNE_SOURCE_URL,
  parseTwseEtfortuneHtml,
} from '../sources/twse-etfortune-html';
import { applyObservationGroups } from './apply-observations';

export interface EtfortuneSyncResult {
  outcome: 'empty_selection' | 'success' | 'rejected';
  selected: number;
  selectedRows: number;
  observationsApplied: number;
  eventsChanged: number;
  error: string | null;
}

export interface EtfortuneSyncDependencies {
  fetchImpl: typeof fetch;
  now: () => string;
  applyObservationGroups: typeof applyObservationGroups;
  upsertSourceStatus: typeof upsertSourceStatus;
}

const defaultDependencies: EtfortuneSyncDependencies = {
  fetchImpl: (input, init) => fetch(input, init),
  now: () => new Date().toISOString(),
  applyObservationGroups,
  upsertSourceStatus,
};

async function selectedEtfIds(db: D1Database): Promise<Set<string>> {
  const result = await db.prepare(
    `SELECT DISTINCT i.instrument_id
     FROM watchlist AS w
     JOIN instruments AS i ON i.instrument_id = w.instrument_id
     WHERE w.enabled = 1 AND w.archived_at IS NULL AND i.active = 1
       AND i.market = 'twse' AND i.kind = 'etf'
     ORDER BY i.code`,
  ).all<{ instrument_id: string }>();
  return new Set((result.results ?? []).map((row) => row.instrument_id));
}

async function priorSelectedCoverage(
  db: D1Database,
  selected: ReadonlySet<string>,
): Promise<number> {
  const ids = [...selected];
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => '?').join(', ');
  const row = await db.prepare(
    `SELECT COUNT(DISTINCT e.event_key) AS count
     FROM dividend_events AS e
     JOIN dividend_observations AS o ON o.event_key = e.event_key
     WHERE o.source_kind = 'etfortune_html'
       AND e.instrument_id IN (${placeholders})`,
  ).bind(...ids).first<{ count: number }>();
  return row?.count ?? 0;
}

function rejection(message: string, selected: number, selectedRows: number): EtfortuneSyncResult {
  return {
    outcome: 'rejected',
    selected,
    selectedRows,
    observationsApplied: 0,
    eventsChanged: 0,
    error: message,
  };
}

export async function runEtfortuneYearlySync(
  env: Env,
  overrides: Partial<EtfortuneSyncDependencies> = {},
): Promise<EtfortuneSyncResult> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const db = env.DB;
  const selected = await selectedEtfIds(db);
  if (selected.size === 0) {
    return {
      outcome: 'empty_selection',
      selected: 0,
      selectedRows: 0,
      observationsApplied: 0,
      eventsChanged: 0,
      error: null,
    };
  }

  const observedAt = dependencies.now();
  let httpStatus: number | null = null;
  let selectedRows = 0;
  try {
    const response = await fetchWithRetry(ETFORTUNE_SOURCE_URL, {
      method: 'GET',
      headers: { accept: 'text/html,application/xhtml+xml' },
      timeoutMs: 15_000,
      fetchImpl: dependencies.fetchImpl,
    });
    httpStatus = response.status;
    if (!response.ok) throw new SourceFetchError(`e添富 returned HTTP ${response.status}`, response.status);

    // The full-market HTML exists only in this local variable and is discarded after selected parsing.
    const parsed = parseTwseEtfortuneHtml(response.text, selected, { observedAt });
    selectedRows = parsed.observations.length;
    if (selectedRows === 0) throw new Error('e添富 selected coverage is empty');
    if (parsed.observations.some((observation) => !selected.has(observation.instrumentId))) {
      throw new Error('e添富 parser returned a non-selected observation');
    }

    const previousRows = await priorSelectedCoverage(db, selected);
    if (previousRows > 0 && selectedRows < previousRows) {
      throw new Error(`e添富 abnormal drop: ${selectedRows} selected rows, previously ${previousRows}`);
    }

    const applied = await dependencies.applyObservationGroups(db, parsed.observations);
    const selectedPayloadSha256 = await hashPayload({
      parserVersion: ETFORTUNE_PARSER_VERSION,
      observations: parsed.observations.map((observation) => observation.rawPayload),
    });
    await dependencies.upsertSourceStatus(db, {
      sourceKind: 'etfortune_html',
      lastAttemptAt: observedAt,
      lastSuccessAt: observedAt,
      lastHttpStatus: httpStatus,
      lastPayloadSha256: selectedPayloadSha256,
      newestSourceDate: parsed.latestPayDate,
      status: 'ok',
      errorMessage: null,
    });
    return {
      outcome: 'success',
      selected: selected.size,
      selectedRows,
      observationsApplied: applied.observationsApplied,
      eventsChanged: applied.eventsChanged,
      error: null,
    };
  } catch (error) {
    if (error instanceof SourceFetchError && error.httpStatus !== undefined) {
      httpStatus = error.httpStatus;
    }
    const message = error instanceof Error ? error.message : String(error);
    await dependencies.upsertSourceStatus(db, {
      sourceKind: 'etfortune_html',
      lastAttemptAt: observedAt,
      lastHttpStatus: httpStatus,
      status: 'error',
      errorMessage: message,
    });
    return rejection(message, selected.size, selectedRows);
  }
}
