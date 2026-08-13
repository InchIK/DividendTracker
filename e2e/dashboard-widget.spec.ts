import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const dashboard = {
  period: { year: 2026, month: 7 },
  summary: {
    totalGrossAmount: '500', totalGrossAmountDisplay: '500', instrumentCount: 1, etfCount: 1,
    pendingCount: 0, conflictCount: 0, lastSuccessfulSync: '2026-08-11T05:35:00.000Z',
  },
  items: [{
    eventKey: 'twse:2330:2026-06-11', instrumentId: 'twse:2330', market: 'twse', kind: 'stock', code: '2330', displayName: '台積電',
    exDate: '2026-06-11', baseDate: '2026-06-12', payDate: '2026-07-10', shares: 100, sharesBasis: 'current_portfolio_estimate',
    dividendPerUnit: '5', formula: '100 × 5', estimatedGrossAmount: '500', estimatedGrossAmountDisplay: '500', previousClose: '1000',
    currentTrade: '1010', tradeDate: '2026-08-11', tradeTime: '13:30:00', priceStatus: 'complete', priceStale: false,
    status: 'announced', source: 'finmind_dividend', sourceKind: 'finmind_dividend', sourceLabel: 'FinMind（TWSE/MOPS）', manualLocked: false, manualNote: null,
  }],
  sources: [], freshness: { stale: false, lastSuccessfulSync: '2026-08-11T05:35:00.000Z' },
};

const widget = {
  status: 'ok', period: { year: 2026, month: 7, timezone: 'Asia/Taipei' },
  items: [{
    instrumentId: 'twse:2330', market: 'twse', kind: 'stock', code: '2330', name: '台積電', shares: '2000', sharesBasis: 'current_portfolio_estimate',
    dividendPerUnit: '5', payDate: '2026-07-10', estimatedGrossAmount: '10000', previousClose: '1000', currentTrade: '1010', tradeDate: '2026-08-11',
    tradeTime: '13:30:00', priceStatus: 'complete', priceStale: false, source: { kind: 'finmind_dividend', label: 'FinMind（TWSE/MOPS）' }, hasConflict: false,
  }],
  totalGrossAmount: '10000', display: { title: '7月預計配息', total: '$10,000', lines: ['2330 2026-07-10｜2,000股 ×5＝10,000｜昨1000 今1010'], compact: null },
  freshness: { stale: false, lastSuccessfulSync: '2026-08-11T05:35:00.000Z' }, generatedAt: '2026-08-11T05:35:00.000Z',
  appearance: {
    theme: 'ocean', mode: 'gradient', startColor: '#071426', endColor: '#0F766E',
    sortMode: 'dividend_desc', featuredInstrumentId: null, refreshMinutes: 180, updatedAt: null,
  },
};

let rotatePasswords: string[] = [];

test.beforeEach(async ({ page }) => {
  rotatePasswords = [];
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: { user: { userId: 'usr_test', username: 'tester', displayName: '測試者', role: 'owner', hasPassword: true } } }));
  await page.route('**/api/v1/auth/widget-token', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { maskedToken: 'dtw_••••••token', rotatedAt: '2026-08-12T00:00:00.000Z' } });
      return;
    }
    await route.fallback();
  });
  await page.route('**/api/v1/auth/widget-token/rotate', async (route) => {
    rotatePasswords.push((route.request().postDataJSON() as { password?: string }).password ?? '');
    await route.fulfill({ json: { token: `widget-fresh-token-${rotatePasswords.length}` } });
  });
  await page.route('**/api/v1/auth/widget-token/reveal', (route) => route.fulfill({ json: { token: 'widget-read-only-test-token' } }));
  await page.route('**/api/v1/dashboard**', (route) => route.fulfill({ json: dashboard }));
  await page.route('**/api/v1/sources/status', (route) => route.fulfill({ json: { sources: [], anyStale: false } }));
  await page.route('**/api/v1/watchlist', (route) => route.fulfill({ json: {
    items: [{
      instrumentId: 'twse:2330', market: 'twse', code: '2330', kind: 'stock',
      displayName: 'Test Stock', shares: 100, enabled: true, status: 'validated', updatedAt: '2026-08-11T05:35:00.000Z',
    }],
  } }));
  await page.route('**/api/v1/widget/current**', (route) => route.fulfill({ json: widget }));
  await page.route('**/api/v1/widget/settings', async (route) => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON() as {
        mode: 'solid' | 'gradient'; startColor: string; endColor: string;
        sortMode: 'dividend_desc' | 'random' | 'price_desc' | 'featured';
        featuredInstrumentId: string | null; refreshMinutes: number;
      };
      await route.fulfill({ json: { theme: 'ocean', ...body, updatedAt: '2026-08-11T14:00:00.000Z' } });
      return;
    }
    await route.fulfill({ json: {
      theme: 'ocean', mode: 'gradient', startColor: '#071426', endColor: '#0F766E',
      sortMode: 'dividend_desc', featuredInstrumentId: null, refreshMinutes: 180, updatedAt: null,
    } });
  });
});

test('dashboard shows stock/ETF dividend and quote fields with period controls', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByLabel('查詢範圍')).toHaveValue('month');
  for (const heading of ['ETF／個股', '發放日', '股數', '配息', '預計毛額', '昨日收盤', '今日成交']) {
    await expect(page.getByRole('columnheader', { name: heading })).toBeVisible();
  }
  const row = page.getByRole('row').filter({ hasText: '2330' });
  await expect(row).toContainText('台積電');
  await expect(row).toContainText('股票');
  await expect(row).toContainText('2026/07/10');
  await expect(row).toContainText('100');
  await expect(row).toContainText('5');
  await expect(row).toContainText('$500');
  await expect(row).toContainText('1000');
  await expect(row).toContainText('1010');
  const lockScreenCard = page.getByTestId('lock-screen-card');
  await expect(lockScreenCard).toHaveText('7月配息10K元');
  await expect(lockScreenCard).not.toContainText('2330');
  await expect(lockScreenCard).not.toContainText('昨收');
  await expect(lockScreenCard).toHaveClass(/rounded-\[26px\]/);
  await page.getByLabel('查詢範圍').selectOption('day');
  const dayRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname.endsWith('/api/v1/dashboard') && url.searchParams.get('year') === '2025' && url.searchParams.get('month') === '10' && url.searchParams.get('day') === '9';
  });
  await page.getByLabel('選擇日期').fill('2025-10-09');
  await dayRequest;
  await expect(page.getByLabel('選擇日期')).toHaveValue('2025-10-09');
});

test('each Widget download rotates credentials and embeds current-origin settings', async ({ page }) => {
  await page.goto('/#/widget-setup');
  const password = page.getByLabel('目前帳號密碼');
  await password.fill('test-password');
  const [downloadOne] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '下載全新 Widget' }).click()]);
  const pathOne = await downloadOne.path();
  expect(pathOne).not.toBeNull();
  if (pathOne === null) throw new Error('Playwright download did not produce a local file');
  const scriptOne = await readFile(pathOne, 'utf8');
  await password.fill('test-password');
  const [downloadTwo] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '下載全新 Widget' }).click()]);
  const pathTwo = await downloadTwo.path();
  expect(pathTwo).not.toBeNull();
  if (pathTwo === null) throw new Error('Playwright download did not produce a local file');
  const scriptTwo = await readFile(pathTwo, 'utf8');
  expect(scriptOne).toContain('http://localhost:4173');
  expect(scriptTwo).toContain('http://localhost:4173');
  expect(scriptOne).toContain('widget-fresh-token-1');
  expect(scriptTwo).toContain('widget-fresh-token-2');
  expect(scriptOne).not.toContain('__DIVIDEND_TRACKER_BASE_URL__');
  expect(scriptOne).not.toContain('__DIVIDEND_TRACKER_WIDGET_TOKEN__');
  expect(scriptOne).not.toContain('__DIVIDEND_TRACKER_INSTALLATION_ID__');
  expect(scriptTwo).not.toContain('__DIVIDEND_TRACKER_INSTALLATION_ID__');
  expect(scriptOne).not.toContain('widget-fresh-token-2');
  expect(scriptTwo).not.toContain('widget-fresh-token-1');
  const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/g;
  expect(scriptOne.match(uuidPattern)?.[0]).toBeTruthy();
  expect(scriptTwo.match(uuidPattern)?.[0]).toBeTruthy();
  expect(scriptOne.match(uuidPattern)?.[0]).not.toBe(scriptTwo.match(uuidPattern)?.[0]);
  expect(rotatePasswords).toEqual(['test-password', 'test-password']);
  await expect(page.getByText(/每次下載都會建立新 Token/)).toBeVisible();
});

test('Widget background accepts arbitrary solid or gradient colors', async ({ page }) => {
  await page.goto('/#/widget-setup');
  const startColor = page.getByLabel('起始顏色 HEX');
  const endColor = page.getByLabel('結束顏色 HEX');
  await expect(startColor).toHaveValue('#071426');
  await startColor.fill('#123ABC');
  await endColor.fill('#FEDCBA');
  const updateRequest = page.waitForRequest((request) => request.url().endsWith('/api/v1/widget/settings') && request.method() === 'PUT');
  await page.getByRole('button', { name: '儲存外觀設定' }).click();
  const request = await updateRequest;
  expect(request.postDataJSON()).toEqual({
    mode: 'gradient', startColor: '#123ABC', endColor: '#FEDCBA',
    sortMode: 'dividend_desc', featuredInstrumentId: null, refreshMinutes: 180,
  });
  await expect(page.getByRole('status')).toContainText('外觀設定已儲存');
  await expect(page.getByLabel('外觀預覽')).toHaveAttribute('style', /rgb\(18, 58, 188\).*rgb\(254, 220, 186\)/);
  await page.getByRole('button', { name: '單色' }).click();
  await startColor.fill('#F1F5F9');
  await expect(endColor).toBeHidden();
  const solidRequest = page.waitForRequest((candidate) => candidate.url().endsWith('/api/v1/widget/settings') && candidate.method() === 'PUT');
  await page.getByRole('button', { name: '儲存外觀設定' }).click();
  expect((await solidRequest).postDataJSON()).toEqual({
    mode: 'solid', startColor: '#F1F5F9', endColor: '#F1F5F9',
    sortMode: 'dividend_desc', featuredInstrumentId: null, refreshMinutes: 180,
  });
});

test('Widget ordering and refresh controls submit the complete preference body', async ({ page }) => {
  await page.goto('/#/widget-setup');
  const sortSelect = page.getByLabel('Widget 排列方式');
  await expect(sortSelect.locator('option')).toHaveCount(4);
  await sortSelect.selectOption('featured');
  const featuredSelect = page.getByLabel('自訂第一個顯示的標的');
  await expect(featuredSelect).toBeVisible();
  await featuredSelect.selectOption('twse:2330');
  await page.getByLabel('Widget 更新間隔（分鐘）').fill('45');

  const updateRequest = page.waitForRequest((request) => (
    request.url().endsWith('/api/v1/widget/settings') && request.method() === 'PUT'
  ));
  await page.getByRole('button', { name: '儲存排列與更新' }).click();
  expect((await updateRequest).postDataJSON()).toEqual({
    mode: 'gradient',
    startColor: '#071426',
    endColor: '#0F766E',
    sortMode: 'featured',
    featuredInstrumentId: 'twse:2330',
    refreshMinutes: 45,
  });
  await expect(page.getByRole('status')).toContainText('排列與更新設定已套用');
});
