import { z } from 'zod';

import { fetchWithRetry } from './source-client';
import { fetchTwstockRealtimePrices } from './twstock-realtime-prices';

export interface InstrumentQuotePreview {
  latestPriceMicros: string | null;
  previousCloseMicros: string | null;
  tradeDate: string | null;
  tradeTime: string | null;
  marketState: string;
  status: string;
  observedAt: string;
  stale: boolean;
  errorMessage: string | null;
}

export type InstrumentMarket = 'twse' | 'tpex';
export type InstrumentKind = 'stock' | 'etf';

export interface OfficialInstrumentSearchItem {
  instrumentId: string;
  market: InstrumentMarket;
  code: string;
  kind: InstrumentKind;
  displayName: string;
  metadataSource: string;
  quote: InstrumentQuotePreview | null;
}

export interface OfficialInstrumentSearchResult {
  items: OfficialInstrumentSearchItem[];
  partial: boolean;
  unavailableSources: string[];
}

const twseStocksSchema = z.array(z.object({
  公司代號: z.string(),
  公司簡稱: z.string(),
}).passthrough());

const twseEtfsSchema = z.array(z.object({
  基金代號: z.string(),
  基金簡稱: z.string(),
}).passthrough());

const tpexStocksSchema = z.array(z.object({
  SecuritiesCompanyCode: z.string(),
  CompanyAbbreviation: z.string(),
}).passthrough());

const sources = [
  {
    name: 'twse_stock_master',
    url: 'https://openapi.twse.com.tw/v1/opendata/t187ap03_L',
    parse: (value: unknown): OfficialInstrumentSearchItem[] => twseStocksSchema.parse(value).map((row) => ({
      instrumentId: `twse:${row.公司代號.trim()}`,
      market: 'twse',
      code: row.公司代號.trim(),
      kind: 'stock',
      displayName: row.公司簡稱.trim(),
      metadataSource: 'twse_t187ap03_L',
      quote: null,
    })),
  },
  {
    name: 'twse_etf_master',
    url: 'https://openapi.twse.com.tw/v1/opendata/t187ap47_L',
    parse: (value: unknown): OfficialInstrumentSearchItem[] => twseEtfsSchema.parse(value).map((row) => ({
      instrumentId: `twse:${row.基金代號.trim()}`,
      market: 'twse',
      code: row.基金代號.trim(),
      kind: 'etf',
      displayName: row.基金簡稱.trim(),
      metadataSource: 'twse_t187ap47_L',
      quote: null,
    })),
  },
  {
    name: 'tpex_stock_master',
    url: 'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O',
    parse: (value: unknown): OfficialInstrumentSearchItem[] => tpexStocksSchema.parse(value).map((row) => ({
      instrumentId: `tpex:${row.SecuritiesCompanyCode.trim()}`,
      market: 'tpex',
      code: row.SecuritiesCompanyCode.trim(),
      kind: 'stock',
      displayName: row.CompanyAbbreviation.trim(),
      metadataSource: 'tpex_mopsfin_t187ap03_O',
      quote: null,
    })),
  },
] as const;

function matches(item: OfficialInstrumentSearchItem, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase('zh-TW');
  return item.code.toLocaleLowerCase('zh-TW').includes(needle)
    || item.displayName.toLocaleLowerCase('zh-TW').includes(needle);
}

export async function searchOfficialInstruments(query: string): Promise<OfficialInstrumentSearchResult> {
  const settled = await Promise.allSettled(sources.map(async (source) => {
    const response = await fetchWithRetry(source.url, { accept: 'application/json' });
    if (!response.ok) throw new Error(`${source.name} returned HTTP ${response.status}`);
    return source.parse(response.json<unknown>()).filter((item) => matches(item, query));
  }));

  const unavailableSources: string[] = [];
  const found: OfficialInstrumentSearchItem[] = [];
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') found.push(...result.value);
    else {
      const source = sources[index];
      if (source) unavailableSources.push(source.name);
    }
  });
  if (unavailableSources.length === sources.length) {
    throw new Error('所有官方標的來源目前皆無法使用');
  }

  const unique = new Map(found.map((item) => [item.instrumentId, item]));
  let items = Array.from(unique.values())
    .sort((left, right) => left.code.localeCompare(right.code, 'zh-TW'))
    .slice(0, 20);
  if (items.length > 0) {
    const observedAt = new Date().toISOString();
    const quotes = await fetchTwstockRealtimePrices(
      new Set(items.map((item) => item.instrumentId)),
      (input, init) => fetch(input, init),
      { observedAt },
    );
    const byId = new Map(quotes.records.map((record) => [record.instrumentId, record]));
    items = items.map((item) => {
      const quote = byId.get(item.instrumentId);
      return {
        ...item,
        quote: quote ? {
          latestPriceMicros: quote.priceMicros?.toString() ?? null,
          previousCloseMicros: quote.previousCloseMicros?.toString() ?? null,
          tradeDate: quote.tradeDate,
          tradeTime: quote.tradeTime,
          marketState: quote.marketState,
          status: quote.status,
          observedAt: quote.observedAt,
          stale: quote.stale,
          errorMessage: quote.errorMessage,
        } : null,
      };
    });
  }
  return { items, partial: unavailableSources.length > 0, unavailableSources };
}
