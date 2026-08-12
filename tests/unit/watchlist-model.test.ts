import { describe, expect, it } from 'vitest';

import {
  buildWatchlistPatch,
  parseSharesInput,
  validateWatchlistDraft,
  watchlistStatusLabel,
  type EditableWatchlistItem,
} from '../../web/pages/watchlist-model';

const original: EditableWatchlistItem = {
  instrumentId: 'twse:0050',
  market: 'twse',
  code: '0050',
  kind: 'etf',
  displayName: '元大台灣50',
  shares: 12000,
  sharesText: '12,000',
  enabled: true,
  status: 'validated',
  updatedAt: '2026-08-11T00:00:00.000Z',
};

describe('watchlist form model', () => {
  it('accepts non-negative whole shares with comma separators', () => {
    expect(parseSharesInput('12,345')).toBe(12345);
    expect(parseSharesInput('0')).toBe(0);
    expect(parseSharesInput('12,34')).toBeNull();
    expect(parseSharesInput('-1')).toBeNull();
    expect(parseSharesInput('1.5')).toBeNull();
  });

  it('validates the required manual instrument fields in plain wording', () => {
    expect(validateWatchlistDraft({
      market: 'twse',
      code: '2330.TW',
      kind: 'stock',
      displayName: '',
      sharesText: '1.5',
      enabled: true,
    })).toEqual({
      code: '代碼需為 4 至 6 碼英數字，第一碼必須是數字。',
      displayName: '請輸入名稱。',
      sharesText: '股數請輸入 0 以上的整數，可使用千分位逗號。',
    });
  });

  it('builds only changed editable fields for a row save', () => {
    expect(buildWatchlistPatch(original, {
      ...original,
      displayName: '元大台灣 50',
      shares: 25000,
      sharesText: '25,000',
      enabled: false,
    })).toEqual({ displayName: '元大台灣 50', shares: 25000, enabled: false });
    expect(buildWatchlistPatch(original, { ...original })).toEqual({});
  });

  it('describes pending validation without exposing a technical status', () => {
    expect(watchlistStatusLabel('pending_validation')).toBe('等待資料來源確認');
    expect(watchlistStatusLabel('validated')).toBe('資料來源已確認');
  });
});
