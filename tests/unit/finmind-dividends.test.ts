import { describe, expect, it, vi } from 'vitest';

import { reconcileObservations, type CanonicalEvent } from '../../worker/domain/reconciliation';
import { fetchFinmindDividendHistory } from '../../worker/sources/finmind-dividends';
import type { WatchlistItemRow } from '../../worker/db/types';

const instrument: WatchlistItemRow = {
  instrument_id: 'twse:2330', market: 'twse', code: '2330', kind: 'stock',
  display_name: '台積電', active: 1, metadata_source: 'twse_t187ap03_L',
  metadata_observed_at: '2026-08-11T00:00:00.000Z', current_shares: 100,
  enabled: 1, archived_at: null, created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-08-11T00:00:00.000Z',
};

describe('FinMind configured-symbol dividend history', () => {
  it('normalizes stock payment dates and keeps the latest same-date revision', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      status: 200,
      msg: 'success',
      data: [
        {
          date: '2026-06-12', stock_id: '2330', year: '115',
          CashEarningsDistribution: 4.5, CashStatutorySurplus: 0,
          CashExDividendTradingDate: '2026-06-11', CashDividendPaymentDate: '2026-07-10',
          AnnouncementDate: '2026-05-01', AnnouncementTime: '09:00:00',
        },
        {
          date: '2026-06-12', stock_id: '2330', year: '115',
          CashEarningsDistribution: 5, CashStatutorySurplus: 0.25,
          CashExDividendTradingDate: '2026-06-11', CashDividendPaymentDate: '2026-07-11',
          AnnouncementDate: '2026-05-02', AnnouncementTime: '09:00:00',
        },
      ],
    }), { status: 200 })) as typeof fetch;

    const result = await fetchFinmindDividendHistory(
      instrument,
      '2025-08-06',
      '2027-08-16',
      '2026-08-11T05:35:00.000Z',
      fetchImpl,
    );

    expect(result.error).toBeNull();
    expect(result.rowsRead).toBe(2);
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0]).toMatchObject({
      instrumentId: 'twse:2330', code: '2330', exDate: '2026-06-11',
      payDate: '2026-07-11', dividendMicros: 5_250_000n,
      sourceKind: 'finmind_dividend',
    });
    const requested = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(requested.searchParams.get('data_id')).toBe('2330');
    expect(requested.searchParams.get('start_date')).toBe('2025-08-06');
    const requestInit = fetchImpl.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(new Headers(requestInit?.headers).get('Authorization')).toBeNull();
  });

  it('sends a trimmed Bearer token when supplied', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      status: 200,
      msg: 'success',
      data: [],
    }), { status: 200 })) as typeof fetch;

    await fetchFinmindDividendHistory(
      instrument,
      '2025-08-06',
      '2027-08-16',
      '2026-08-11T05:35:00.000Z',
      fetchImpl,
      '  test-finmind-token  ',
    );

    const requestInit = fetchImpl.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(new Headers(requestInit?.headers).get('Authorization'))
      .toBe('Bearer test-finmind-token');
  });

  it('omits Authorization for a whitespace-only token', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      status: 200,
      msg: 'success',
      data: [],
    }), { status: 200 })) as typeof fetch;

    await fetchFinmindDividendHistory(
      instrument,
      '2025-08-06',
      '2027-08-16',
      '2026-08-11T05:35:00.000Z',
      fetchImpl,
      '   ',
    );

    const requestInit = fetchImpl.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(new Headers(requestInit?.headers).get('Authorization')).toBeNull();
  });

  it('supplements a higher-priority ETF record without lowering its canonical trust', () => {
    const existing: CanonicalEvent = {
      eventKey: 'twse:0056:2026-06-11', instrumentId: 'twse:0056', code: '0056',
      exDate: '2026-06-11', baseDate: null, payDate: null, dividendMicros: 1_000_000n,
      status: 'announced', canonicalSourceKind: 'etfortune_html',
      canonicalSourcePriority: 90, manualLocked: false, manualNote: null,
    };
    const reconciled = reconcileObservations('0056', '2026-06-11', [{
      sourceKind: 'finmind_dividend', sourcePriority: 70, sourceUrl: null,
      instrumentId: 'twse:0056', code: '0056', fundUnifiedNo: null,
      exDate: '2026-06-11', baseDate: '2026-06-12', payDate: '2026-07-10',
      dividendMicros: 999_000n, observedAt: '2026-08-11T05:35:00.000Z', rawPayload: {},
    }], existing, 'twse:0056');

    expect(reconciled.payDate).toBe('2026-07-10');
    expect(reconciled.dividendMicros).toBe(1_000_000n);
    expect(reconciled.canonicalSourceKind).toBe('etfortune_html');
    expect(reconciled.canonicalSourcePriority).toBe(90);
  });
});
