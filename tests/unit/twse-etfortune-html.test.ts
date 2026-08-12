import { describe, expect, it } from 'vitest';

import fixture from '../fixtures/etfortune-dividend-list.html?raw';
import {
  ETFORTUNE_PARSER_VERSION,
  ETFORTUNE_SOURCE_URL,
  parseTwseEtfortuneHtml,
} from '../../worker/sources/twse-etfortune-html';
const selected = new Set(['twse:0056', 'twse:00878']);
const observedAt = '2026-08-11T00:00:00.000Z';

function parse(html = fixture, selection = selected) {
  return parseTwseEtfortuneHtml(html, selection, { observedAt });
}

function appendRow(html: string, cells: string[]): string {
  const row = `<tr>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`;
  return html.replace('</tbody>', `${row}</tbody>`);
}

describe('parseTwseEtfortuneHtml', () => {
  it('returns only selected ETFs with parsed ROC/CE values and bounded raw rows', () => {
    const result = parse();

    expect(result).toMatchObject({
      sourceUrl: ETFORTUNE_SOURCE_URL,
      parserVersion: ETFORTUNE_PARSER_VERSION,
      totalRows: 4,
      selectedRows: 2,
      earliestPayDate: '2026-08-07',
      latestPayDate: '2026-08-07',
    });
    expect(result.observations).toHaveLength(2);
    expect(result.observations[0]).toMatchObject({
      eventKey: 'twse:0056:2026-07-21',
      instrumentId: 'twse:0056',
      sourceKind: 'etfortune_html',
      sourcePriority: 90,
      sourceUrl: ETFORTUNE_SOURCE_URL,
      code: '0056',
      exDate: '2026-07-21',
      baseDate: '2026-07-27',
      payDate: '2026-08-07',
      dividendMicros: 866_000n,
      observedAt,
      rawPayload: {
        code: '0056',
        name: '元大高股息',
        exDate: '115/07/21',
        baseDate: '115/07/27',
        payDate: '2026/08/07',
        dividendPerUnit: '0.866',
      },
    });
    expect(JSON.stringify(result.observations[0]?.rawPayload)).not.toContain('<html');
    expect(result.observations.map((observation) => observation.instrumentId)).not.toContain(
      'twse:0050',
    );
  });

  it('preserves pending selected dates and amounts as null', () => {
    expect(resultFor('twse:00878')).toMatchObject({
      eventKey: 'twse:00878:2026-08-18',
      baseDate: '2026-08-24',
      payDate: null,
      dividendMicros: null,
    });
  });

  it('accepts the current eight-column TWSE table while keeping raw payload bounded', () => {
    const current = fixture
      .replace('證券名稱', '證券簡稱')
      .replace('每受益權單位配發金額', '收益分配金額 (每1受益權益單位)</th><th>收益分配金標準 (102年度起啟用)</th><th>公告年度')
      .replace(/(<tbody>[\s\S]*?<\/tbody>)/, (tbody) => tbody.replace(/<\/tr>/g, '<td>標準</td><td>115</td></tr>'));

    const result = parse(current);
    expect(result.parserVersion).toBe('2');
    expect(result.observations).toHaveLength(2);
    expect(result.observations[0]?.rawPayload).toEqual({
      code: '0056', name: '元大高股息', exDate: '115/07/21',
      baseDate: '115/07/27', payDate: '2026/08/07', dividendPerUnit: '0.866',
    });
  });

  it('ignores malformed unselected rows after reading their instrument code', () => {
    expect(() => parse()).not.toThrow();
  });

  it.each([
    ['', /empty payload/i],
    ['<table id="other"><tr><th>證券代號</th></tr></table>', /table#myTable/i],
    [fixture.replace('收益分配發放日', '付款日期'), /header/i],
    [fixture.replace(/<tbody>[\s\S]*?<\/tbody>/, '<tbody></tbody>'), /no data rows/i],
  ])('rejects missing payload structure', (html, message) => {
    expect(() => parse(html)).toThrow(message);
  });

  it.each([
    ['bad selected ex-date', 2, 'not-a-date'],
    ['bad selected base-date', 3, 'not-a-date'],
    ['bad selected pay-date', 4, 'not-a-date'],
    ['bad selected amount', 5, 'not-money'],
    ['missing selected cell', 5, undefined],
  ])('rejects %s', (_name, cellIndex, replacement) => {
    const cells = ['0056', '元大高股息', '115/09/01', '115/09/02', '115/09/10', '1.25'];
    if (replacement === undefined) cells.splice(cellIndex, 1);
    else cells[cellIndex] = replacement;

    expect(() => parse(appendRow(fixture, cells))).toThrow(/malformed selected row/i);
  });

  it('rejects an identical duplicate stable event key', () => {
    const duplicate = ['0056', '元大高股息', '115/07/21', '115/07/27', '2026/08/07', '0.866'];

    expect(() => parse(appendRow(fixture, duplicate))).toThrow(/duplicate stable event key/i);
  });

  it('rejects a conflicting duplicate stable event key', () => {
    const conflict = ['0056', '元大高股息', '115/07/21', '115/07/27', '2026/08/08', '0.9'];

    expect(() => parse(appendRow(fixture, conflict))).toThrow(/conflicting duplicate/i);
  });

  it('rejects row counts outside the configured safety threshold', () => {
    expect(() =>
      parseTwseEtfortuneHtml(fixture, selected, {
        observedAt,
        minRows: 5,
        maxRows: 100,
      }),
    ).toThrow(/abnormal row count/i);
    expect(() =>
      parseTwseEtfortuneHtml(fixture, selected, {
        observedAt,
        minRows: 1,
        maxRows: 3,
      }),
    ).toThrow(/abnormal row count/i);
  });

  it('rejects invalid selected instrument IDs instead of widening selection', () => {
    expect(() => parse(fixture, new Set(['0056']))).toThrow(/market-qualified/i);
  });
});

function resultFor(instrumentId: string) {
  return parse().observations.find((observation) => observation.instrumentId === instrumentId);
}
