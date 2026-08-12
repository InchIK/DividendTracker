import { afterEach, describe, expect, it, vi } from 'vitest';

import { WidgetApiError, fetchWidgetPayload, parseUpcomingWidgetPayload } from '../../widget-src/api';
import type { UpcomingWidgetResponse } from '../../widget-src/formatter';
import {
  KEY_BASE_URL,
  KEY_INSTALLATION_ID,
  KEY_WIDGET_TOKEN,
  clearConfig,
  loadConfig,
  loadConfigForEmbedded,
  saveConfig,
} from '../../widget-src/config';
import { cacheFilename, readCache, writeCache } from '../../widget-src/cache';

const installationId = '00000000-0000-4000-8000-000000000000';
const payload: UpcomingWidgetResponse = {
  periods: [
    { status: 'ok', period: { year: 2026, month: 8, timezone: 'Asia/Taipei' }, items: [], totalGrossAmount: '0', display: { title: '本月', total: '$0', lines: [], compact: null }, generatedAt: '2026-08-11T05:35:00.000Z' },
    { status: 'no_announced_payout', period: { year: 2026, month: 9, timezone: 'Asia/Taipei' }, items: [], totalGrossAmount: null, display: { title: '下月', total: null, lines: [], compact: null }, generatedAt: '2026-08-11T05:35:00.000Z' },
  ],
  generatedAt: '2026-08-11T05:35:00.000Z',
};

afterEach(() => vi.unstubAllGlobals());

describe('Scriptable native runtime integration', () => {
  it('uses native Request with the embedded read-only bearer token', async () => {
    const created: MockRequest[] = [];
    class MockRequest {
      method = '';
      headers: Record<string, string> = {};
      timeoutInterval = 0;
      response: { statusCode: number } | null = null;
      constructor(readonly url: string) { created.push(this); }
      async loadString() { this.response = { statusCode: 200 }; return JSON.stringify(payload); }
    }
    vi.stubGlobal('Request', MockRequest);
    expect(await fetchWidgetPayload('https://worker.example.test/', 'widget-read-token')).toEqual(payload);
    expect(created[0]).toMatchObject({ url: 'https://worker.example.test/api/v1/widget/upcoming', method: 'GET', timeoutInterval: 12, headers: { Authorization: 'Bearer widget-read-token', Accept: 'application/json' } });
  });

  it('surfaces Scriptable HTTP authentication failures with the response body', async () => {
    class MockRequest {
      method = '';
      headers: Record<string, string> = {};
      timeoutInterval = 0;
      response: { statusCode: number } | null = null;
      constructor(readonly url: string) {}
      async loadString() { this.response = { statusCode: 403 }; return '{"error":"forbidden"}'; }
    }
    vi.stubGlobal('Request', MockRequest);
    const error = await fetchWidgetPayload('https://worker.example.test', 'wrong-token').catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(WidgetApiError);
    expect(error).toMatchObject({ status: 403, bodyText: '{"error":"forbidden"}' });
  });

  it('uses the embedded loadConfig branch without any Keychain access', () => {
    const keychain = {
      contains: vi.fn(() => true),
      get: vi.fn(() => 'legacy-value'),
      set: vi.fn(),
      remove: vi.fn(),
    };
    vi.stubGlobal('Keychain', keychain);
    const embedded = { baseUrl: 'https://new.example.test', widgetToken: 'fresh-token', installationId };
    expect(loadConfigForEmbedded(embedded)).toEqual(embedded);
    expect(keychain.contains).not.toHaveBeenCalled();
    expect(keychain.get).not.toHaveBeenCalled();
    expect(keychain.set).not.toHaveBeenCalled();
    expect(keychain.remove).not.toHaveBeenCalled();
  });

  it('ignores old manual keys and persists only isolated v2 keys', () => {
    const values = new Map<string, string>();
    const keychain = {
      contains: vi.fn((key: string) => values.has(key)),
      get: vi.fn((key: string) => values.get(key)),
      set: vi.fn((key: string, value: string) => { values.set(key, value); }),
      remove: vi.fn((key: string) => { values.delete(key); }),
    };
    vi.stubGlobal('Keychain', keychain);
    values.set('dividendTracker.baseUrl', 'old-base');
    values.set('dividendTracker.widgetToken', 'old-token');
    values.set('etfDividendHub.baseUrl', 'legacy-base');
    values.set('etfDividendHub.widgetToken', 'legacy-token');
    expect(loadConfig()).toBeNull();
    expect(keychain.contains).not.toHaveBeenCalledWith('dividendTracker.baseUrl');
    expect(keychain.contains).not.toHaveBeenCalledWith('dividendTracker.widgetToken');
    expect(keychain.contains).not.toHaveBeenCalledWith('etfDividendHub.baseUrl');
    expect(keychain.contains).not.toHaveBeenCalledWith('etfDividendHub.widgetToken');
    saveConfig({ baseUrl: 'https://worker.example.test', widgetToken: 'widget-read-token', installationId });
    expect(loadConfig()).toEqual({ baseUrl: 'https://worker.example.test', widgetToken: 'widget-read-token', installationId });
    clearConfig();
    expect(values.has(KEY_BASE_URL)).toBe(false);
    expect(values.has(KEY_WIDGET_TOKEN)).toBe(false);
    expect(values.has(KEY_INSTALLATION_ID)).toBe(false);
  });

  it('reads and writes only the same installation cache filename', () => {
    const files = new Map<string, string>();
    const fm = {
      documentsDirectory: () => '/docs',
      joinPath: (root: string, name: string) => `${root}/${name}`,
      fileExists: (path: string) => files.has(path),
      writeString: (path: string, value: string) => { files.set(path, value); },
      readString: (path: string) => files.get(path) ?? '',
      remove: (path: string) => { files.delete(path); },
    };
    vi.stubGlobal('FileManager', { local: () => fm });
    writeCache(installationId, payload);
    expect(files.has(`/docs/${cacheFilename(installationId)}`)).toBe(true);
    expect(readCache(installationId)?.payload).toEqual(payload);
    expect(readCache('11111111-1111-4111-8111-111111111111')).toBeNull();
    expect(files.has('/docs/etf-dividend-widget-cache.json')).toBe(false);
  });

  it('rejects malformed items, compact display values, and freshness values', () => {
    const badItem = {
      ...payload,
      periods: [
        { ...payload.periods[0], items: [{ code: 123 }] },
        payload.periods[1],
      ],
    };
    expect(() => parseUpcomingWidgetPayload(badItem)).toThrow(/required text fields/);

    const badCompact = {
      ...payload,
      periods: [
        { ...payload.periods[0], display: { ...payload.periods[0].display, compact: 7 } },
        payload.periods[1],
      ],
    };
    expect(() => parseUpcomingWidgetPayload(badCompact)).toThrow(/invalid display/);

    const badFreshness = {
      ...payload,
      periods: [
        { ...payload.periods[0], freshness: { stale: 'yes', lastSuccessfulSync: null } },
        payload.periods[1],
      ],
    };
    expect(() => parseUpcomingWidgetPayload(badFreshness)).toThrow(/invalid freshness/);
  });
});
