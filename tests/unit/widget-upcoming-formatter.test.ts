import { describe, expect, it } from 'vitest';

import {
  WIDGET_API_PATH,
  parseUpcomingWidgetPayload,
} from '../../widget-src/api';
import { compactLockScreenYuan } from '../../web/lib/compact-amount';
import {
  buildUpcomingSummaries,
  compactAmount,
  compactYuanAmount,
  fullAmount,
  markUpcomingPayloadStale,
  type UpcomingWidgetResponse,
  type WidgetResponse,
} from '../../widget-src/formatter';

function period(
  month: number,
  overrides: Partial<WidgetResponse> = {},
): WidgetResponse {
  return {
    status: 'ok',
    period: { year: 2026, month, timezone: 'Asia/Taipei' },
    items: [],
    totalGrossAmount: '0',
    display: {
      title: `${month}月預計配息`,
      total: '$0',
      lines: [],
      compact: null,
    },
    freshness: { stale: false, lastSuccessfulSync: '2026-08-11T00:00:00.000Z' },
    generatedAt: '2026-08-11T01:00:00.000Z',
    ...overrides,
  };
}

function payload(
  current: WidgetResponse = period(8),
  next: WidgetResponse = period(9),
): UpcomingWidgetResponse {
  return {
    periods: [current, next],
    generatedAt: '2026-08-11T01:00:00.000Z',
  };
}

describe('upcoming widget API model', () => {
  it('uses the real two-period endpoint', () => {
    expect(WIDGET_API_PATH).toBe('/api/v1/widget/upcoming');
  });

  it('accepts exactly two consecutive explicit periods', () => {
    const value = payload(period(12, {
      period: { year: 2026, month: 12, timezone: 'Asia/Taipei' },
    }), period(1, {
      period: { year: 2027, month: 1, timezone: 'Asia/Taipei' },
    }));

    value.appearance = {
      theme: 'ocean', mode: 'gradient', startColor: '#123ABC', endColor: '#FEDCBA',
      updatedAt: '2026-08-11T01:00:00.000Z',
    };
    expect(parseUpcomingWidgetPayload(value)).toEqual(value);
  });

  it('rejects missing, non-consecutive, and malformed periods', () => {
    expect(() => parseUpcomingWidgetPayload({ periods: [period(8)] })).toThrow('two periods');
    expect(() => parseUpcomingWidgetPayload(payload(period(8), period(10)))).toThrow('consecutive');
    expect(() => parseUpcomingWidgetPayload(payload(period(8), period(9, {
      status: 'unknown' as WidgetResponse['status'],
    })))).toThrow('status');
    expect(() => parseUpcomingWidgetPayload({
      ...payload(), appearance: { theme: 'unknown', updatedAt: null },
    })).toThrow('appearance');
    expect(() => parseUpcomingWidgetPayload({
      ...payload(),
      appearance: {
        theme: 'ocean', mode: 'gradient', startColor: 'blue', endColor: '#123456',
        updatedAt: null,
      },
    })).toThrow('appearance');
  });
});

describe('two-period widget formatting', () => {
  it('preserves amounts larger than Number.MAX_SAFE_INTEGER', () => {
    expect(fullAmount('9007199254740993.25')).toBe('$9,007,199,254,740,993.25');
  });

  it('uses compact English units for Lock Screen totals without losing decimal-string precision', () => {
    expect(compactYuanAmount('999')).toBe('999元');
    expect(compactYuanAmount('1000')).toBe('1K元');
    expect(compactYuanAmount('10400')).toBe('10.4K元');
    expect(compactYuanAmount('999950')).toBe('1M元');
    expect(compactYuanAmount('1250000')).toBe('1.3M元');
    expect(compactYuanAmount('2300000000')).toBe('2.3B元');
    expect(compactYuanAmount('4500000000000')).toBe('4.5T元');
    expect(compactAmount('9007199254740993.25')).toBe('$9007.2T');
  });

  it('keeps the web Lock Screen preview aligned with K/M/B/T formatting', () => {
    expect(compactLockScreenYuan('999')).toBe('999元');
    expect(compactLockScreenYuan('10000')).toBe('10K元');
    expect(compactLockScreenYuan('999950')).toBe('1M元');
    expect(compactLockScreenYuan('2300000000')).toBe('2.3B元');
    expect(compactLockScreenYuan('4500000000000')).toBe('4.5T元');
    expect(compactLockScreenYuan(null)).toBe('待公告');
  });

  it('distinguishes zero, pending, no data, stale, and errors by period', () => {
    const zeroAndPending = buildUpcomingSummaries(payload(
      period(8),
      period(9, {
        status: 'pending_amount',
        totalGrossAmount: null,
        display: { title: '9月預計配息', total: null, lines: [], compact: null },
      }),
    ));
    expect(zeroAndPending).toEqual([
      { month: '8月', total: '$0', status: null, count: '0筆' },
      { month: '9月', total: '待公告', status: '金額待公告', count: '0筆' },
    ]);

    const noDataAndError = buildUpcomingSummaries(payload(
      period(8, {
        status: 'no_announced_payout',
        totalGrossAmount: null,
        display: { title: '8月預計配息', total: null, lines: [], compact: null },
      }),
      period(9, {
        status: 'source_error',
        totalGrossAmount: null,
        display: { title: '9月預計配息', total: null, lines: [], compact: null },
      }),
    ));
    expect(noDataAndError[0]).toMatchObject({ total: '尚無配息', status: '尚無已公告配息' });
    expect(noDataAndError[1]).toMatchObject({ total: '無法取得', status: '暫時無法取得' });

    const stale = buildUpcomingSummaries(payload(period(8, { status: 'source_stale' }), period(9)));
    expect(stale[0]?.status).toBe('資料可能過期');
  });

  it('marks every cached period stale without hiding pending or error status', () => {
    const cachedAt = '2026-08-11T02:00:00.000Z';
    const stale = markUpcomingPayloadStale(payload(
      period(8),
      period(9, { status: 'pending_amount' }),
    ), cachedAt);

    expect(stale.periods.map((entry) => entry.status)).toEqual(['source_stale', 'pending_amount']);
    expect(stale.periods.every((entry) => entry.freshness?.stale)).toBe(true);
    expect(stale.periods[0]?.freshness?.lastSuccessfulSync).toBe(cachedAt);
  });
});
