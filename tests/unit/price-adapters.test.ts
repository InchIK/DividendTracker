import { describe, expect, it, vi } from 'vitest';

import { fetchTwstockRealtimePrices } from '../../worker/sources/twstock-realtime-prices';
import { fetchTpexPrices } from '../../worker/sources/tpex-prices';
import { fetchTwsePrices } from '../../worker/sources/twse-prices';

const observedAt = '2026-08-11T06:00:00.000Z';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('TWSE STOCK_DAY_ALL prices', () => {
  it('filters before returning records and converts the selected close exactly', async () => {
    const fetcher = vi.fn(async () => jsonResponse([
      { Code: '0050', Name: '元大台灣50', ClosingPrice: '201.123456' },
      { Code: '2330', Name: '台積電', ClosingPrice: '1,234.5' },
    ]));

    const result = await fetchTwsePrices(new Set(['twse:0050']), fetcher, {
      observedAt,
      tradeDate: '2026-08-10',
    });

    expect(result).toMatchObject({ outcome: 'ok', httpStatus: 200, error: null });
    expect(result.records).toEqual([{
      instrumentId: 'twse:0050',
      priceMicros: null,
      previousCloseMicros: 201_123_456n,
      tradeDate: '2026-08-10',
      tradeTime: null,
      marketState: 'closed',
      status: 'partial',
      source: 'twse_stock_day_all',
      observedAt,
      stale: false,
      errorMessage: null,
      rawPayload: { Code: '0050', Name: '元大台灣50', ClosingPrice: '201.123456' },
    }]);
  });

  it('uses null rather than zero for a selected no-trade row', async () => {
    const result = await fetchTwsePrices(
      new Set(['twse:0050']),
      async () => jsonResponse([{ Code: '0050', Name: '元大台灣50', ClosingPrice: '--' }]),
      { observedAt, tradeDate: '2026-08-10' },
    );

    expect(result.records[0]).toMatchObject({
      previousCloseMicros: null,
      marketState: 'no_trade',
      status: 'not_covered',
    });
  });

  it('distinguishes an empty selection without making a request', async () => {
    const fetcher = vi.fn();
    const result = await fetchTwsePrices(new Set(), fetcher, {
      observedAt,
      tradeDate: '2026-08-10',
    });

    expect(result).toEqual({ outcome: 'empty_selection', records: [], httpStatus: null, error: null });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects a malformed selected row instead of partially parsing it', async () => {
    const result = await fetchTwsePrices(
      new Set(['twse:0050']),
      async () => jsonResponse([{ Code: '0050', Name: '元大台灣50', ClosingPrice: 201.5 }]),
      { observedAt, tradeDate: '2026-08-10' },
    );

    expect(result).toMatchObject({ outcome: 'schema_error', records: [], httpStatus: 200 });
  });
});

describe('TPEx tpex_mainboard_quotes prices', () => {
  it('selects market-qualified IDs and parses ROC trade dates and exact close decimals', async () => {
    const result = await fetchTpexPrices(
      new Set(['tpex:00679B']),
      async () => jsonResponse([
        { Date: '1150810', SecuritiesCompanyCode: '00679B', CompanyName: '元大美債20年', Close: '27.010001' },
        { Date: '1150810', SecuritiesCompanyCode: '6488', CompanyName: '環球晶', Close: '450.00' },
      ]),
      { observedAt },
    );

    expect(result).toMatchObject({ outcome: 'ok', httpStatus: 200, error: null });
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      instrumentId: 'tpex:00679B',
      priceMicros: null,
      previousCloseMicros: 27_010_001n,
      tradeDate: '2026-08-10',
      tradeTime: null,
      marketState: 'closed',
      status: 'partial',
      source: 'tpex_mainboard_quotes',
      observedAt,
    });
  });

  it('reports malformed roots and preserves empty-selection as a separate outcome', async () => {
    const malformed = await fetchTpexPrices(
      new Set(['tpex:00679B']),
      async () => jsonResponse({ rows: [] }),
      { observedAt },
    );
    expect(malformed.outcome).toBe('schema_error');

    const fetcher = vi.fn();
    const empty = await fetchTpexPrices(new Set(), fetcher, { observedAt });
    expect(empty.outcome).toBe('empty_selection');
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('twstock-compatible TWSE MIS realtime prices', () => {
  const payload = {
    rtcode: '0000',
    rtmessage: 'OK',
    msgArray: [
      { ex: 'tse', ch: '0050.tw', c: '0050', n: '元大台灣50', z: '104.600001', y: '104.25', d: '20260811', t: '13:30:00', tlong: '1786426200000' },
      { ex: 'otc', ch: '6488.tw', c: '6488', n: '環球晶', z: '849.000001', y: '854', d: '20260811', t: '13:30:00', tlong: '1786426200000' },
      { ex: 'tse', ch: '2330.tw', c: '2330', n: '台積電', z: '1234', y: '1220', d: '20260811', t: '13:30:00', tlong: '1786426200000' },
    ],
  };

  it('batches selected listed and OTC channels and filters unselected rows', async () => {
    const fetcher = vi.fn(async () => jsonResponse(payload));
    const result = await fetchTwstockRealtimePrices(
      new Set(['twse:0050', 'tpex:6488']),
      fetcher,
      { observedAt, staleAfterMs: 90 * 60 * 1000 },
    );

    expect(result.outcome).toBe('ok');
    expect(result.records).toHaveLength(2);
    expect(result.records[0]).toMatchObject({
      instrumentId: 'twse:0050',
      priceMicros: 104_600_001n,
      previousCloseMicros: 104_250_000n,
      tradeDate: '2026-08-11',
      tradeTime: '13:30:00',
      marketState: 'closed',
      status: 'complete',
      source: 'twstock_twse_mis',
      stale: false,
    });
    expect(result.records[1]?.instrumentId).toBe('tpex:6488');
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toContain('ex_ch=tse_0050.tw%7Cotc_6488.tw');
    expect(init?.headers).toEqual({ Accept: 'application/json' });
  });

  it('does no request for an empty selection', async () => {
    const fetcher = vi.fn();
    const result = await fetchTwstockRealtimePrices(new Set(), fetcher, { observedAt });
    expect(result.outcome).toBe('empty_selection');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('keeps missing latest trade as null and never fabricates zero', async () => {
    const result = await fetchTwstockRealtimePrices(
      new Set(['twse:0050']),
      async () => jsonResponse({ ...payload, msgArray: [{ ...payload.msgArray[0], z: '-' }] }),
      { observedAt },
    );
    expect(result.records[0]).toMatchObject({
      priceMicros: null,
      previousCloseMicros: 104_250_000n,
      marketState: 'no_trade',
      status: 'partial',
    });
  });

  it('reports rate limits, upstream errors, and schema drift explicitly', async () => {
    const selected = new Set(['twse:0050']);
    expect(await fetchTwstockRealtimePrices(selected, async () => jsonResponse({}, 429), { observedAt }))
      .toMatchObject({ outcome: 'rate_limited', records: [], httpStatus: 429 });
    expect(await fetchTwstockRealtimePrices(selected, async () => jsonResponse({}, 503), { observedAt }))
      .toMatchObject({ outcome: 'http_error', records: [], httpStatus: 503 });
    expect(await fetchTwstockRealtimePrices(selected, async () => jsonResponse({ rtcode: '5000' }), { observedAt }))
      .toMatchObject({ outcome: 'schema_error', records: [], httpStatus: 200 });
  });

  it('marks an old last trade stale during market hours rather than current', async () => {
    const tradingObservedAt = '2026-08-11T02:00:00.000Z';
    const result = await fetchTwstockRealtimePrices(
      new Set(['twse:0050']),
      async () => jsonResponse({
        ...payload,
        msgArray: [{
          ...payload.msgArray[0],
          t: '10:00:00',
          tlong: String(Date.parse('2026-08-11T00:00:00.000Z')),
        }],
      }),
      { observedAt: tradingObservedAt, staleAfterMs: 90 * 60 * 1000 },
    );
    expect(result.records[0]).toMatchObject({ status: 'stale', stale: true });
  });
});
