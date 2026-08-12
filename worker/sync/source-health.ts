/**
 * Source health checker — determines if sources are stale (> 48h since last success).
 */
import { getSourceStatus } from '../db/queries';
import type { SourceStatusRow } from '../db/types';

const STALE_THRESHOLD_HOURS = 48;

export interface SourceHealthResult {
  sourceKind: string;
  stale: boolean;
  lastSuccessAt: string | null;
  hoursSinceLastSuccess: number | null;
  status: SourceStatusRow['status'];
  errorMessage: string | null;
}

export async function checkSourceHealth(
  db: D1Database,
): Promise<{ sources: SourceHealthResult[]; anyStale: boolean }> {
  const statuses = await getSourceStatus(db);
  const now = Date.now();

  const sources: SourceHealthResult[] = statuses.map((s) => {
    let hoursSinceLast: number | null = null;
    let stale = true;

    if (s.last_success_at) {
      const last = new Date(s.last_success_at).getTime();
      hoursSinceLast = (now - last) / (1000 * 60 * 60);
      stale = hoursSinceLast > STALE_THRESHOLD_HOURS;
    }

    return {
      sourceKind: s.source_kind,
      stale,
      lastSuccessAt: s.last_success_at,
      hoursSinceLastSuccess: hoursSinceLast,
      status: s.status,
      errorMessage: s.error_message,
    };
  });

  const anyStale = sources.length === 0 || sources.some((s) => s.stale);

  return { sources, anyStale };
}

export async function isFreshnessStale(db: D1Database): Promise<boolean> {
  const { anyStale } = await checkSourceHealth(db);
  return anyStale;
}

export async function getLastSuccessfulSync(db: D1Database): Promise<string | null> {
  // Re-export from db/queries for convenience
  const { getLatestSuccessfulSync } = await import('../db/queries');
  return getLatestSuccessfulSync(db);
}