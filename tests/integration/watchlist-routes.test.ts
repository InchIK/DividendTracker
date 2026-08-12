import { env, reset } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import worker from '../../worker/index';
import { applyMultiUserMigrations, seedAuthenticatedUser, seedMarketFixtures, sessionHeaders, testEnv } from '../helpers/multi-user';

async function request(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  for (const [key, value] of Object.entries(sessionHeaders())) headers.set(key, value);
  if (init?.body) headers.set('Content-Type', 'application/json');
  if ((init?.method ?? 'GET').toUpperCase() !== 'GET') headers.set('Origin', 'https://example.test');
  return worker.fetch(new Request(`https://example.test${path}`, { ...init, headers }), testEnv(env.DB));
}

async function jsonRequest(path: string, method: string, body: unknown): Promise<Response> {
  return request(path, { method, body: JSON.stringify(body) });
}

async function refreshFetch(input: string | URL | Request): Promise<Response> {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.hostname === 'api.finmindtrade.com') {
    const code = url.searchParams.get('data_id') ?? '';
    return new Response(JSON.stringify({
      status: 200,
      msg: 'success',
      data: [{
        date: '2026-06-12', stock_id: code, year: '115',
        CashEarningsDistribution: '5', CashStatutorySurplus: '0',
        CashExDividendTradingDate: '2026-06-11',
        CashDividendPaymentDate: '2026-07-10',
        AnnouncementDate: '2026-05-15', AnnouncementTime: '12:00:00',
      }],
    }), { status: 200 });
  }
  if (url.hostname === 'www.tpex.org.tw') {
    return new Response(JSON.stringify([{
      Date: '1150811', SecuritiesCompanyCode: '6488', CompanyName: '環球晶', Close: '500',
    }]), { status: 200 });
  }
  if (url.pathname.includes('STOCK_DAY_ALL')) {
    return new Response(JSON.stringify([
      { Code: '2330', Name: '台積電', ClosingPrice: '1000' },
    ]), { status: 200 });
  }
  if (url.hostname === 'mis.twse.com.tw') {
    const channels = decodeURIComponent(url.searchParams.get('ex_ch') ?? '').split('|').filter(Boolean);
    return new Response(JSON.stringify({
      rtcode: '0000',
      msgArray: channels.map((channel) => {
        const [exchange, codeWithSuffix] = channel.split('_');
        const code = codeWithSuffix?.split('.')[0] ?? '';
        return {
          ex: exchange === 'otc' ? 'otc' : 'tse', ch: channel, c: code, n: code,
          z: code === '6488' ? '505' : '1010', y: code === '6488' ? '500' : '1000',
          d: '20260811', t: '13:30:00', tlong: String(Date.parse('2026-08-11T05:30:00.000Z')),
        };
      }),
    }), { status: 200 });
  }
  return new Response(JSON.stringify([]), { status: 200 });
}

describe('dynamic watchlist routes', () => {
  beforeEach(async () => {
    await reset();
    await applyMultiUserMigrations(env.DB);
    await seedAuthenticatedUser(env.DB);
    await seedMarketFixtures(env.DB);
    vi.stubGlobal('fetch', vi.fn(refreshFetch));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('adds only an explicitly requested symbol as pending validation and lists it', async () => {
    const response = await jsonRequest('/api/v1/watchlist', 'POST', {
      market: 'tpex',
      code: '6488',
      kind: 'stock',
      displayName: '環球晶',
      shares: '12,345',
      enabled: true,
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      status: 'pending_validation',
      refresh: {
        status: 'success',
        dividend: { selected: 1, rowsRead: 1, eventsChanged: 1 },
        prices: { selected: 1, persisted: 1 },
      },
      item: {
        instrumentId: 'tpex:6488',
        market: 'tpex',
        code: '6488',
        kind: 'stock',
        displayName: '環球晶',
        shares: 12345,
        enabled: true,
        status: 'pending_validation',
      },
    });

    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM instruments').first()).toEqual({ count: 5 });
    expect(
      await env.DB.prepare(`SELECT metadata_source FROM instruments WHERE instrument_id = 'tpex:6488'`).first(),
    ).toEqual({ metadata_source: 'user_pending_validation' });
    expect(
      await env.DB.prepare(
        `SELECT pay_date, dividend_micros FROM dividend_events WHERE instrument_id = 'tpex:6488'`,
      ).first(),
    ).toEqual({ pay_date: '2026-07-10', dividend_micros: 5_000_000 });
    expect(
      await env.DB.prepare(
        `SELECT price_micros, previous_close_micros FROM latest_prices WHERE instrument_id = 'tpex:6488'`,
      ).first(),
    ).toEqual({ price_micros: 505_000_000, previous_close_micros: 500_000_000 });

    const listed = await request('/api/v1/watchlist');
    expect(listed.status).toBe(200);
    const body = await listed.json<{ items: { instrumentId: string }[] }>();
    expect(body.items.map((item) => item.instrumentId)).toContain('tpex:6488');
  });

  it('rejects non-canonical codes and searches official stocks and ETFs', async () => {
    const invalid = await jsonRequest('/api/v1/watchlist', 'POST', {
      market: 'twse',
      code: '2330.tw',
      kind: 'stock',
      displayName: '台積電',
      shares: 1,
      enabled: true,
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: '請求格式錯誤' });

    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('t187ap03_L')) return new Response(JSON.stringify([
        { 公司代號: '2330', 公司簡稱: '台積電' },
        { 公司代號: '2317', 公司簡稱: '鴻海' },
      ]), { status: 200 });
      if (url.includes('t187ap47_L')) return new Response(JSON.stringify([
        { 基金代號: '0050', 基金簡稱: '元大台灣50' },
      ]), { status: 200 });
      return new Response(JSON.stringify([
        { SecuritiesCompanyCode: '6488', CompanyAbbreviation: '環球晶' },
      ]), { status: 200 });
    }));

    const stockSearch = await request('/api/v1/instruments/search?query=2330');
    expect(stockSearch.status).toBe(200);
    expect(await stockSearch.json()).toMatchObject({ items: [{
      instrumentId: 'twse:2330', market: 'twse', code: '2330', kind: 'stock', displayName: '台積電',
    }] });

    const etfSearch = await request('/api/v1/instruments/search?query=0050');
    expect(etfSearch.status).toBe(200);
    expect(await etfSearch.json()).toMatchObject({ items: [{
      instrumentId: 'twse:0050', market: 'twse', code: '0050', kind: 'etf', displayName: '元大台灣50',
    }] });

    const tpexSearch = await request('/api/v1/instruments/search?query=環球晶');
    expect(tpexSearch.status).toBe(200);
    expect(await tpexSearch.json()).toMatchObject({ items: [{
      instrumentId: 'tpex:6488', market: 'tpex', code: '6488', kind: 'stock', displayName: '環球晶',
    }] });

    const shortQuery = await request('/api/v1/instruments/search?query=0');
    expect(shortQuery.status).toBe(400);
  });

  it('returns partial official results when one catalog is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('t187ap47_L')) return new Response('unavailable', { status: 404 });
      if (url.includes('t187ap03_L')) return new Response(JSON.stringify([
        { 公司代號: '2330', 公司簡稱: '台積電' },
      ]), { status: 200 });
      return new Response(JSON.stringify([]), { status: 200 });
    }));

    const search = await request('/api/v1/instruments/search?query=2330');
    expect(search.status).toBe(200);
    expect(await search.json()).toMatchObject({
      partial: true,
      unavailableSources: ['twse_etf_master'],
      items: [{ instrumentId: 'twse:2330' }],
    });
  });

  it('updates, archives without deleting history, and restores the same instrument', async () => {
    await jsonRequest('/api/v1/watchlist', 'POST', {
      market: 'twse',
      code: '2330',
      kind: 'stock',
      displayName: '台積電',
      shares: 1000,
      enabled: true,
    });
    await env.DB.prepare(
      `UPDATE dividend_events
       SET status = 'verified', canonical_source_kind = 'manual_verified',
           canonical_source_priority = 100, manual_locked = 1, updated_at = datetime('now')
       WHERE event_key = 'twse:2330:2026-06-11'`,
    ).run();

    const patched = await jsonRequest('/api/v1/watchlist/twse%3A2330', 'PATCH', {
      shares: '2,500',
      enabled: false,
      displayName: '台灣積體電路製造',
    });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({
      status: 'pending_validation',
      item: { shares: 2500, enabled: false, displayName: '台灣積體電路製造' },
    });
    expect(
      await env.DB.prepare(
        `SELECT current_shares, enabled FROM watchlist WHERE instrument_id = 'twse:2330'`,
      ).first(),
    ).toEqual({ current_shares: 2500, enabled: 0 });

    const reloaded = await request('/api/v1/watchlist');
    const reloadedBody = await reloaded.json() as {
      items: { instrumentId: string; shares: number; enabled: boolean }[];
    };
    expect(reloadedBody.items.find((item) => item.instrumentId === 'twse:2330')).toMatchObject({
      shares: 2500,
      enabled: false,
    });

    const archived = await request('/api/v1/watchlist/twse%3A2330', { method: 'DELETE' });
    expect(archived.status).toBe(200);
    expect(await archived.json()).toEqual({ instrumentId: 'twse:2330', status: 'archived' });
    expect(
      await env.DB.prepare(`SELECT enabled, archived_at IS NOT NULL AS archived FROM watchlist WHERE instrument_id = 'twse:2330'`).first(),
    ).toEqual({ enabled: 0, archived: 1 });
    expect(
      await env.DB.prepare(`SELECT COUNT(*) AS count FROM dividend_events WHERE instrument_id = 'twse:2330'`).first(),
    ).toEqual({ count: 1 });

    const active = await request('/api/v1/watchlist');
    const activeBody = await active.json<{ items: { instrumentId: string }[] }>();
    expect(activeBody.items.map((item) => item.instrumentId)).not.toContain('twse:2330');

    const restored = await jsonRequest('/api/v1/watchlist', 'POST', {
      market: 'twse',
      code: '2330',
      kind: 'stock',
      displayName: '台積電（待驗證）',
      shares: 3000,
      enabled: true,
    });
    expect(restored.status).toBe(200);
    expect(await restored.json()).toMatchObject({
      status: 'pending_validation',
      restored: true,
      item: { instrumentId: 'twse:2330', shares: 3000, enabled: true },
    });
    expect(
      await env.DB.prepare(`SELECT COUNT(*) AS count FROM instruments WHERE instrument_id = 'twse:2330'`).first(),
    ).toEqual({ count: 1 });
    expect(
      await env.DB.prepare(`SELECT COUNT(*) AS count FROM dividend_events WHERE instrument_id = 'twse:2330'`).first(),
    ).toEqual({ count: 1 });
  });
});
