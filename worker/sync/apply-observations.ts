import {
  getDividendEvent,
  insertObservation,
  upsertDividendEvent,
} from '../db/queries';
import {
  hashPayload,
  makeEventKey,
  reconcileObservations,
} from '../domain/reconciliation';
import type { SourceObservation } from '../domain/reconciliation';

export interface SyncObservationQueries {
  getDividendEvent: typeof getDividendEvent;
  upsertDividendEvent: typeof upsertDividendEvent;
  insertObservation: typeof insertObservation;
}

const defaultQueries: SyncObservationQueries = {
  getDividendEvent,
  upsertDividendEvent,
  insertObservation,
};

function toCanonicalEvent(existing: Awaited<ReturnType<typeof getDividendEvent>>) {
  return existing
    ? {
        eventKey: existing.event_key,
        instrumentId: existing.instrument_id,
        code: existing.code,
        exDate: existing.ex_date,
        baseDate: existing.base_date,
        payDate: existing.pay_date,
        dividendMicros: existing.dividend_micros !== null ? BigInt(existing.dividend_micros) : null,
        status: existing.status as 'schedule_only' | 'pending_amount' | 'announced' | 'verified' | 'paid' | 'cancelled' | 'conflict',
        canonicalSourceKind: existing.canonical_source_kind,
        canonicalSourcePriority: existing.canonical_source_priority,
        manualLocked: existing.manual_locked === 1,
        manualNote: existing.manual_note,
      }
    : null;
}

export async function applyObservationGroups(
  db: D1Database,
  observations: SourceObservation[],
  queries: SyncObservationQueries = defaultQueries,
): Promise<{ observationsApplied: number; eventsChanged: number }> {
  const grouped = new Map<string, SourceObservation[]>();
  for (const observation of observations) {
    if (!observation.exDate) continue;
    const eventKey = makeEventKey(observation.instrumentId ?? observation.code, observation.exDate);
    const group = grouped.get(eventKey);
    if (group) group.push(observation);
    else grouped.set(eventKey, [observation]);
  }

  let observationsApplied = 0;
  let eventsChanged = 0;
  for (const [eventKey, group] of grouped) {
    const first = group[0]!;
    const existing = await queries.getDividendEvent(db, eventKey);
    const canonical = reconcileObservations(
      first.code,
      first.exDate!,
      group,
      toCanonicalEvent(existing),
      first.instrumentId ?? first.code,
    );

    const updated = await queries.upsertDividendEvent(db, {
      eventKey: canonical.eventKey,
      code: canonical.code,
      exDate: canonical.exDate,
      baseDate: canonical.baseDate,
      payDate: canonical.payDate,
      dividendMicros: canonical.dividendMicros !== null ? Number(canonical.dividendMicros) : null,
      status: canonical.status,
      canonicalSourceKind: canonical.canonicalSourceKind,
      canonicalSourcePriority: canonical.canonicalSourcePriority,
      manualLocked: canonical.manualLocked,
      manualNote: canonical.manualNote,
    });
    if (updated) eventsChanged++;

    for (const observation of group) {
      const observationKey = `${observation.sourceKind}:${eventKey}:${observation.observedAt}`;
      await queries.insertObservation(db, {
        observationKey,
        eventKey,
        sourceKind: observation.sourceKind,
        sourcePriority: observation.sourcePriority,
        sourceUrl: observation.sourceUrl,
        exDate: observation.exDate,
        baseDate: observation.baseDate,
        payDate: observation.payDate,
        dividendMicros: observation.dividendMicros !== null ? Number(observation.dividendMicros) : null,
        sourceObservedAt: observation.observedAt,
        payloadSha256: await hashPayload(observation.rawPayload),
        rawPayload: JSON.stringify(observation.rawPayload),
      });
      observationsApplied++;
    }
  }

  return { observationsApplied, eventsChanged };
}
