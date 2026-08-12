import { upsertSourceStatus } from '../db/queries';
import type { WatchlistItemRow } from '../db/types';
import { toIsoDateInTaipei } from '../domain/date';
import { hashPayload } from '../domain/reconciliation';
import { fetchFinmindDividendHistory } from '../sources/finmind-dividends';
import { applyObservationGroups } from './apply-observations';

export interface FinmindDividendSyncResult {
  outcome: 'empty_selection' | 'success' | 'partial' | 'rejected';
  selected: number;
  rowsRead: number;
  observationsApplied: number;
  eventsChanged: number;
  errors: string[];
}

export interface FinmindDividendSyncOptions {
  instrumentIds?: ReadonlySet<string>;
  now?: () => Date;
  fetchImpl?: typeof fetch;
}

function offsetDate(date: Date, days: number): string {
  const copy = new Date(date.getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  return toIsoDateInTaipei(copy);
}

export async function runFinmindDividendSync(
  env: Env,
  options: FinmindDividendSyncOptions = {},
): Promise<FinmindDividendSyncResult> {
  const now = options.now?.() ?? new Date();
  const observedAt = now.toISOString();
  const startDate = offsetDate(now, -370);
  const endDate = offsetDate(now, 370);
  const selected = await env.DB.prepare(
    `SELECT DISTINCT i.instrument_id, i.code, i.market, i.kind
     FROM watchlist AS w
     JOIN instruments AS i ON i.instrument_id = w.instrument_id
     WHERE w.enabled = 1 AND w.archived_at IS NULL AND i.active = 1
     ORDER BY i.market, i.code`,
  ).all<Pick<WatchlistItemRow, 'instrument_id' | 'code' | 'market' | 'kind'>>();
  const items = (selected.results ?? []).filter((item) =>
    options.instrumentIds === undefined || options.instrumentIds.has(item.instrument_id));
  if (items.length === 0) {
    return {
      outcome: 'empty_selection', selected: 0, rowsRead: 0,
      observationsApplied: 0, eventsChanged: 0, errors: [],
    };
  }

  const results = [];
  for (const item of items) {
    results.push(await fetchFinmindDividendHistory(
      item,
      startDate,
      endDate,
      observedAt,
      options.fetchImpl,
    ));
  }
  const errors = results.flatMap((result) =>
    result.error ? [`${result.instrumentId}: ${result.error}`] : []);
  const successful = results.filter((result) => result.error === null);
  const observations = successful.flatMap((result) => result.observations);
  const rowsRead = successful.reduce((sum, result) => sum + result.rowsRead, 0);

  if (successful.length === 0) {
    await upsertSourceStatus(env.DB, {
      sourceKind: 'finmind_dividend',
      lastAttemptAt: observedAt,
      status: 'error',
      errorMessage: errors.join('; '),
    });
    return {
      outcome: 'rejected', selected: items.length, rowsRead: 0,
      observationsApplied: 0, eventsChanged: 0, errors,
    };
  }

  const applied = await applyObservationGroups(env.DB, observations);
  const newestSourceDate = observations
    .map((observation) => observation.payDate ?? observation.exDate)
    .filter((value): value is string => value !== null)
    .sort()
    .at(-1) ?? null;
  await upsertSourceStatus(env.DB, {
    sourceKind: 'finmind_dividend',
    lastAttemptAt: observedAt,
    lastSuccessAt: observedAt,
    lastHttpStatus: 200,
    lastPayloadSha256: await hashPayload(observations.map((item) => item.rawPayload)),
    newestSourceDate,
    status: errors.length > 0 ? 'error' : 'ok',
    errorMessage: errors.join('; ') || null,
  });
  return {
    outcome: errors.length > 0 ? 'partial' : 'success',
    selected: items.length,
    rowsRead,
    observationsApplied: applied.observationsApplied,
    eventsChanged: applied.eventsChanged,
    errors,
  };
}
