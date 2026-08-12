import { describe, expect, it, vi } from 'vitest';

import {
  applyObservationGroups,
  runSync,
  type SyncObservationQueries,
} from '../../worker/sync/run-sync';
import type { SourceObservation } from '../../worker/domain/reconciliation';

const observation: SourceObservation = {
  sourceKind: 'sitca_open_data',
  sourcePriority: 80,
  sourceUrl: 'https://example.test/dividends.csv',
  code: '0056',
  fundUnifiedNo: '12345678',
  exDate: '2026-08-11',
  baseDate: '2026-08-12',
  payDate: '2026-09-11',
  dividendMicros: 1n,
  observedAt: '2026-08-11T12:00:00.000Z',
  rawPayload: { amount: '0.000001' },
};

describe('sync parent/observation integrity', () => {
  it('upserts the canonical parent before inserting any child observation', async () => {
    let parentExists = false;
    const calls: string[] = [];
    const queries: SyncObservationQueries = {
      async getDividendEvent() {
        return null;
      },
      async upsertDividendEvent(_db, event) {
        calls.push(`parent:${event.eventKey}`);
        parentExists = true;
        return true;
      },
      async insertObservation(_db, child) {
        if (!parentExists) throw new Error('foreign key: observation preceded parent');
        calls.push(`observation:${child.eventKey}`);
      },
    };

    const result = await applyObservationGroups(
      {} as D1Database,
      [observation],
      queries,
    );

    expect(result).toEqual({ observationsApplied: 1, eventsChanged: 1 });
    expect(calls).toEqual([
      'parent:twse:0056:2026-08-11',
      'observation:twse:0056:2026-08-11',
    ]);
  });

  it('preserves a manually locked canonical parent while still recording observations', async () => {
    const upsert = vi.fn(async () => false);
    const insert = vi.fn(async () => undefined);
    const queries: SyncObservationQueries = {
      async getDividendEvent() {
        return {
          event_key: 'twse:0056:2026-08-11',
          instrument_id: 'twse:0056',
          code: '0056',
          ex_date: '2026-08-11',
          base_date: '2026-08-12',
          pay_date: '2026-09-20',
          dividend_micros: 2_000_000,
          eligible_shares_override: null,
          status: 'verified',
          canonical_source_kind: 'manual_verified',
          canonical_source_priority: 100,
          manual_locked: 1,
          manual_note: 'locked',
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        };
      },
      upsertDividendEvent: upsert,
      insertObservation: insert,
    };

    await applyObservationGroups({} as D1Database, [observation], queries);

    expect(upsert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        dividendMicros: 2_000_000,
        manualLocked: true,
        manualNote: 'locked',
      }),
    );
    expect(insert).toHaveBeenCalledOnce();
  });
});

describe('sync run failure closure', () => {
  it('marks a created sync run failed with finished_at and the unexpected error, then rethrows', async () => {
    const updateSyncRun = vi.fn(async () => undefined);
    const env = { DB: {} as D1Database } as Env;

    await expect(
      runSync(env, 'manual', {
        createSyncRun: async () => 42,
        updateSyncRun,
        fetchTwseFundMapping: async () => {
          throw new Error('unexpected source crash');
        },
      }),
    ).rejects.toThrow('unexpected source crash');

    expect(updateSyncRun).toHaveBeenCalledWith(
      env.DB,
      42,
      expect.objectContaining({
        status: 'failed',
        finished_at: expect.any(String),
        error_message: 'unexpected source crash',
      }),
    );
  });
});
