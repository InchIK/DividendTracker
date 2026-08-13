import { describe, expect, it } from 'vitest';

import { buildWidgetResponse, type PortfolioEntry, type WidgetPriceEntry } from '../../worker/domain/widget-response';
import type { CanonicalEvent } from '../../worker/domain/reconciliation';

const period = { year: 2026, month: 8 };

const portfolio: PortfolioEntry[] = [
  { instrumentId: 'twse:A', code: 'A', displayName: 'Alpha', currentShares: 10, enabled: true },
  { instrumentId: 'twse:B', code: 'B', displayName: 'Beta', currentShares: 10, enabled: true },
  { instrumentId: 'twse:C', code: 'C', displayName: 'Gamma', currentShares: 10, enabled: true },
  { instrumentId: 'twse:D', code: 'D', displayName: 'Delta', currentShares: 10, enabled: true },
];

function event(
  instrumentId: string,
  code: string,
  payDate: string,
  dividendMicros: bigint | null,
): CanonicalEvent {
  return {
    eventKey: `${instrumentId}:2026-07-01`,
    instrumentId,
    code,
    exDate: '2026-07-01',
    baseDate: null,
    payDate,
    dividendMicros,
    status: dividendMicros === null ? 'pending_amount' : 'announced',
    canonicalSourceKind: 'sitca_open_data',
    canonicalSourcePriority: 80,
    manualLocked: false,
    manualNote: null,
  };
}

const events: CanonicalEvent[] = [
  event('twse:A', 'A', '2026-08-20', 2_000_000n),
  event('twse:B', 'B', '2026-08-10', 1_000_000n),
  event('twse:C', 'C', '2026-08-05', null),
];

const prices: WidgetPriceEntry[] = [
  { instrumentId: 'twse:A', latestPriceMicros: '100000000', previousCloseMicros: '90000000', tradeDate: null, tradeTime: null, status: null, stale: false },
  { instrumentId: 'twse:B', latestPriceMicros: null, previousCloseMicros: '120000000', tradeDate: null, tradeTime: null, status: null, stale: false },
  { instrumentId: 'twse:C', latestPriceMicros: null, previousCloseMicros: null, tradeDate: null, tradeTime: null, status: null, stale: false },
];

function build(options: Parameters<typeof buildWidgetResponse>[7] = {}) {
  return buildWidgetResponse(events, portfolio, period.year, period.month, false, null, prices, options);
}

describe('widget ordering preferences', () => {
  it('sorts dividend amounts descending, keeps null amounts last, and maps display amounts', () => {
    const response = build({ sortMode: 'dividend_desc' });
    expect(response.items.map((item) => item.code)).toEqual(['A', 'B', 'C']);
    expect(response.items.map((item) => item.estimatedGrossAmount)).toEqual(['20', '10', null]);
    expect(response.display.lines[0]).toContain('A');
    expect(response.display.lines[0]).toContain('20');
    expect(response.display.lines[1]).toContain('B');
    expect(response.display.lines[1]).toContain('10');
    expect(response.display.compact).toBeNull();
  });

  it('sorts by latest trade, then previous close, with missing prices last', () => {
    const response = build({ sortMode: 'price_desc' });
    expect(response.items.map((item) => item.code)).toEqual(['B', 'A', 'C']);
    expect(response.items.map((item) => item.currentTrade)).toEqual([null, '100', null]);
    expect(response.items.map((item) => item.previousClose)).toEqual(['120', '90', null]);
  });

  it('puts an existing featured instrument first and falls back to dividend ordering', () => {
    expect(build({ sortMode: 'featured', featuredInstrumentId: 'twse:B' }).items.map((item) => item.code))
      .toEqual(['B', 'A', 'C']);
    expect(build({ sortMode: 'featured', featuredInstrumentId: 'twse:missing' }).items.map((item) => item.code))
      .toEqual(['A', 'B', 'C']);
  });

  it('uses injectable Fisher-Yates randomness and deterministic tie breakers', () => {
    const randomValues = [0, 0];
    const random = () => randomValues.shift() ?? 0;
    expect(build({ sortMode: 'random', random }).items.map((item) => item.code)).toEqual(['B', 'C', 'A']);

    const tieEvents = [
      event('twse:D', 'D', '2026-08-20', 1_000_000n),
      event('twse:B', 'B', '2026-08-10', 1_000_000n),
      event('twse:A', 'A', '2026-08-10', 1_000_000n),
    ];
    const tieResponse = buildWidgetResponse(
      tieEvents,
      portfolio,
      period.year,
      period.month,
      false,
      null,
      [],
      { sortMode: 'dividend_desc' },
    );
    expect(tieResponse.items.map((item) => item.code)).toEqual(['A', 'B', 'D']);
    expect(tieResponse.display.lines[0]).toContain('A');
    expect(tieResponse.display.lines[1]).toContain('B');
    expect(tieResponse.display.compact).toMatch(/A \$10.*B \$10.*D \$10/);
  });
});
