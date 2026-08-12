import { describe, expect, it } from 'vitest';

import { buildUpcomingWidgetResponse } from '../../worker/domain/upcoming-widget';
import type { CanonicalEvent } from '../../worker/domain/reconciliation';

const portfolio = [
  { code: '0056', displayName: '元大高股息', currentShares: 7450, enabled: true },
];

function event(payDate: string, micros: bigint | null = 1_000_000n): CanonicalEvent {
  return {
    eventKey: `twse:0056:${payDate}`,
    code: '0056',
    exDate: '2026-07-01',
    baseDate: null,
    payDate,
    dividendMicros: micros,
    status: micros === null ? 'pending_amount' : 'announced',
    canonicalSourceKind: 'sitca_open_data',
    canonicalSourcePriority: 80,
    manualLocked: false,
    manualNote: null,
  };
}

describe('buildUpcomingWidgetResponse', () => {
  it('returns independent current and next month periods', () => {
    const result = buildUpcomingWidgetResponse(
      [event('2026-08-20'), event('2026-09-15', null)],
      portfolio,
      { year: 2026, month: 8 },
      false,
      '2026-08-11T00:00:00.000Z',
    );

    expect(result.periods).toHaveLength(2);
    expect(result.periods[0]?.period).toMatchObject({ year: 2026, month: 8 });
    expect(result.periods[0]?.status).toBe('ok');
    expect(result.periods[0]?.items).toHaveLength(1);
    expect(result.periods[1]?.period).toMatchObject({ year: 2026, month: 9 });
    expect(result.periods[1]?.status).toBe('pending_amount');
    expect(result.periods[1]?.items).toHaveLength(1);
  });

  it('rolls December into January of the next year', () => {
    const result = buildUpcomingWidgetResponse(
      [event('2026-12-20'), event('2027-01-15')],
      portfolio,
      { year: 2026, month: 12 },
    );

    expect(result.periods.map((period) => period.period)).toEqual([
      { year: 2026, month: 12, timezone: 'Asia/Taipei' },
      { year: 2027, month: 1, timezone: 'Asia/Taipei' },
    ]);
  });

  it('does not turn an empty next month into a zero payout', () => {
    const result = buildUpcomingWidgetResponse(
      [event('2026-08-20')],
      portfolio,
      { year: 2026, month: 8 },
    );

    expect(result.periods[1]?.status).toBe('no_announced_payout');
    expect(result.periods[1]?.items).toEqual([]);
    expect(result.periods[1]?.totalGrossAmount).toBeNull();
  });
});
