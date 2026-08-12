/**
 * Reconciliation engine — merges observations into canonical events.
 *
 * Priority levels:
 *   manual_verified (locked) = 100
 *   sitca_open_data           = 80
 *   twse_ex_schedule          = 20
 *
 * Rules:
 *   1. Manual locked events are never overwritten by auto sync.
 *   2. Higher priority non-null fields override lower priority.
 *   3. Conflicts between two high-trust sources set status = 'conflict'.
 *   4. Deleting from CSV does NOT delete existing events.
 */

export interface SourceObservation {
  sourceKind: 'twse_fund_mapping' | 'twse_ex_schedule' | 'sitca_open_data' | 'etfortune_html' | 'finmind_dividend' | 'manual_verified';
  sourcePriority: number;
  sourceUrl: string | null;
  /** Market-qualified ID. Legacy TWSE observations may omit it. */
  instrumentId?: string;
  code: string;
  fundUnifiedNo: string | null;
  exDate: string | null;
  baseDate: string | null;
  payDate: string | null;
  dividendMicros: bigint | null;
  observedAt: string;
  rawPayload: unknown;
}

export interface CanonicalEvent {
  eventKey: string;
  instrumentId?: string;
  code: string;
  exDate: string;
  baseDate: string | null;
  payDate: string | null;
  dividendMicros: bigint | null;
  status: 'schedule_only' | 'pending_amount' | 'announced' | 'verified' | 'paid' | 'cancelled' | 'conflict';
  canonicalSourceKind: string;
  canonicalSourcePriority: number;
  eligibleSharesOverride?: number | null;
  manualLocked: boolean;
  manualNote: string | null;
}

export const PRIORITY = {
  MANUAL_VERIFIED: 100,
  ETFORTUNE_HTML: 90,
  SITCA_OPEN_DATA: 80,
  FINMIND_DIVIDEND: 70,
  TWSE_EX_SCHEDULE: 20,
} as const;

/** Create a stable market-qualified event key from an instrument ID (or legacy TWSE code). */
export function makeEventKey(instrumentIdOrCode: string, exDate: string): string {
  const instrumentId = instrumentIdOrCode.includes(':')
    ? instrumentIdOrCode
    : `twse:${instrumentIdOrCode}`;
  return `${instrumentId}:${exDate}`;
}

/**
 * Determine event status based on available fields.
 */
export function determineStatus(
  payDate: string | null,
  dividendMicros: bigint | null,
  manualLocked: boolean,
  hasConflict: boolean,
): CanonicalEvent['status'] {
  if (hasConflict) return 'conflict';
  if (manualLocked) return 'verified';
  if (payDate === null && dividendMicros === null) return 'schedule_only';
  if (payDate !== null && dividendMicros === null) return 'pending_amount';
  return 'announced';
}

/**
 * Reconcile observations for a single event into a canonical event.
 * Assumes all observations share the same code + exDate.
 */
export function reconcileObservations(
  code: string,
  exDate: string,
  observations: SourceObservation[],
  existing?: CanonicalEvent | null,
  instrumentIdOrCode: string = code,
): CanonicalEvent {
  const eventKey = makeEventKey(instrumentIdOrCode, exDate);
  const instrumentId = instrumentIdOrCode.includes(':')
    ? instrumentIdOrCode
    : `twse:${code}`;

  // If existing event is manually locked, preserve its locked fields
  const manualLocked = existing?.manualLocked ?? false;

  // Sort observations by priority descending
  const sorted = [...observations].sort((a, b) => b.sourcePriority - a.sourcePriority);

  // Pick canonical fields by priority (highest non-null wins)
  let canonicalSourceKind = existing?.canonicalSourceKind ?? sorted[0]?.sourceKind ?? 'unknown';
  let canonicalSourcePriority = existing?.canonicalSourcePriority ?? sorted[0]?.sourcePriority ?? 0;

  let payDate: string | null = existing?.payDate ?? null;
  let baseDate: string | null = existing?.baseDate ?? null;
  let dividendMicros: bigint | null = existing?.dividendMicros ?? null;
  let payDatePriority = existing?.canonicalSourcePriority ?? -1;
  let baseDatePriority = existing?.canonicalSourcePriority ?? -1;
  let amountPriority = existing?.canonicalSourcePriority ?? -1;

  // Track high-trust source values for conflict detection
  const payDateByHighTrust = new Map<string, string>();
  const amountByHighTrust = new Map<string, bigint>();

  if (!manualLocked && existing && existing.canonicalSourcePriority >= PRIORITY.SITCA_OPEN_DATA) {
    if (existing.payDate !== null) {
      payDateByHighTrust.set(existing.canonicalSourceKind, existing.payDate);
    }
    if (existing.dividendMicros !== null) {
      amountByHighTrust.set(existing.canonicalSourceKind, existing.dividendMicros);
    }
  }

  if (!manualLocked) {
    for (const obs of sorted) {
      if (obs.payDate !== null) {
        if (payDate === null || obs.sourcePriority >= payDatePriority) {
          payDate = obs.payDate;
          payDatePriority = obs.sourcePriority;
          if (obs.sourcePriority >= canonicalSourcePriority) {
            canonicalSourceKind = obs.sourceKind;
            canonicalSourcePriority = obs.sourcePriority;
          }
        }
        if (obs.sourcePriority >= PRIORITY.SITCA_OPEN_DATA) {
          payDateByHighTrust.set(obs.sourceKind, obs.payDate);
        }
      }
      if (obs.baseDate !== null && (baseDate === null || obs.sourcePriority >= baseDatePriority)) {
        baseDate = obs.baseDate;
        baseDatePriority = obs.sourcePriority;
      }
      if (obs.dividendMicros !== null) {
        if (dividendMicros === null || obs.sourcePriority >= amountPriority) {
          dividendMicros = obs.dividendMicros;
          amountPriority = obs.sourcePriority;
          if (obs.sourcePriority >= canonicalSourcePriority) {
            canonicalSourceKind = obs.sourceKind;
            canonicalSourcePriority = obs.sourcePriority;
          }
        }
        if (obs.sourcePriority >= PRIORITY.SITCA_OPEN_DATA) {
          amountByHighTrust.set(obs.sourceKind, obs.dividendMicros);
        }
      }
    }
  }

  // Conflict detection: different high-trust sources disagree
  const payDateValues = new Set(payDateByHighTrust.values());
  const amountValues = new Set(amountByHighTrust.values());
  const hasConflict =
    (payDateByHighTrust.size > 1 && payDateValues.size > 1) ||
    (amountByHighTrust.size > 1 && amountValues.size > 1);

  const status = determineStatus(payDate, dividendMicros, manualLocked, hasConflict);

  return {
    eventKey,
    instrumentId,
    code,
    exDate,
    baseDate,
    payDate,
    dividendMicros,
    status,
    canonicalSourceKind,
    canonicalSourcePriority,
    manualLocked,
    manualNote: existing?.manualNote ?? null,
  };
}

/**
 * Compute SHA-256 hash of a payload for deduplication.
 */
export async function hashPayload(payload: unknown): Promise<string> {
  const text = JSON.stringify(payload);
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
