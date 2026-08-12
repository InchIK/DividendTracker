/**
 * DividendTracker — Scriptable Widget (TypeScript source).
 *
 * This is the main entry point for the iOS Scriptable widget. It:
 *   1. Reads the embedded connection settings (or generic manual settings).
 *   2. Fetches /api/v1/widget/upcoming from the Cloudflare Worker.
 *   3. Caches the JSON payload to FileManager.local() for offline display.
 *   4. Renders a ListWidget in the appropriate family (Lock Screen rectangular,
 *      Home Screen medium, small, or accessoryInline).
 *
 * First-run / manual invocation shows a setup menu (see config.ts).
 *
 * After esbuild bundling (see `scripts/build-widget.mjs`), this file becomes a
 * single self-contained `.js` file that you paste into the Scriptable app.
 */

import {
  WidgetResponse,
  UpcomingWidgetResponse,
  WidgetItem,
  compactYuanAmount,
  fullAmount,
  buildSmallSummary,
  statusBanner,
  buildUpcomingSummaries,
  markUpcomingPayloadStale,
  type WidgetAppearance,
  type WidgetTheme,
} from './formatter';
import { clearCache, readCache, writeCache } from './cache';
import {
  WidgetConfig,
  loadConfig,
  runSetupMenu,
} from './config';
import { fetchWidgetPayload, WidgetApiError } from './api';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Refresh policy: iOS WidgetKit will invoke us again after this many hours. */
const REFRESH_HOURS = 3;

/** URL path to the web dashboard (so tapping the widget opens the dashboard). */
const DASHBOARD_PATH = '/';

// ---------------------------------------------------------------------------
// Detected runtime family — Scriptable exposes `config.widgetFamily`.
// ---------------------------------------------------------------------------

function currentFamily(): WidgetFamily {
  const family = config.widgetFamily;
  return family ?? 'medium';
}

function isStandaloneRun(): boolean {
  return !config.runsInWidget;
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

/**
 * Widget entry point. Scriptable calls this automatically when run as a widget.
 * Also exported as the default export so users can `await run()` from inside
 * the app when testing.
 */
export async function run(): Promise<void> {
  const config = loadConfig();

  // First-run / manual invocation: show the setup menu.
  if (config === null) {
    log('DividendTrackerWidget: no config — showing setup menu');
    await runSetupMenu(previewWidgetFamily, testApiWithConfig, (cfg) => clearCache(cfg.installationId));
    return;
  }

  // When invoked inside the Scriptable app (not as a widget), show the setup menu
  // if the user wants to reconfigure. Scriptable exposes this via `config.runsInWidget`.
  if (isStandaloneRun()) {
    log('DividendTrackerWidget: standalone run — showing menu');
    await runSetupMenu(previewWidgetFamily, testApiWithConfig, (cfg) => clearCache(cfg.installationId));
    return;
  }

  // Normal widget update path.
  const family = currentFamily();
  const widget = await buildWidget(family, config);
  widget.refreshAfterDate = new Date(Date.now() + REFRESH_HOURS * 3600 * 1000);
  Script.setWidget(widget);
  Script.complete();
}

/**
 * Build a `ListWidget` for the given family, using API data (with cache fallback).
 */
async function buildWidget(family: WidgetFamily, config: WidgetConfig): Promise<ListWidget> {
  const { data, isCached, error } = await fetchWithCache(config);

  const widget = new ListWidget();
  widget.url = dashboardUrl(config.baseUrl);

  switch (family) {
    case 'accessoryRectangular':
      renderUpcomingLockScreen(widget, data);
      break;
    case 'accessoryInline':
      renderUpcomingAccessoryInline(widget, data);
      break;
    case 'small':
      renderUpcomingSmall(widget, data);
      break;
    case 'medium':
    case 'large':
    default:
      renderUpcomingMedium(widget, data, isCached, error);
      break;
  }

  return widget;
}

// ---------------------------------------------------------------------------
// Fetch with cache fallback.
// ---------------------------------------------------------------------------

interface FetchResult {
  data: UpcomingWidgetResponse;
  isCached: boolean;
  error?: WidgetApiError;
}

/**
 * Try the API; on success write cache and return fresh payload.
 * On failure: fall back to cached payload tagged "stale".
 * On failure + no cache: return a synthetic error payload.
 */
async function fetchWithCache(config: WidgetConfig): Promise<FetchResult> {
  try {
    const payload = await fetchWidgetPayload(config.baseUrl, config.widgetToken);
    writeCache(config.installationId, payload);
    return { data: payload, isCached: false };
  } catch (err) {
    const apiError = err instanceof WidgetApiError ? err : new WidgetApiError('未知錯誤', 0, null, err);
    const cached = readCache(config.installationId);
    if (cached) {
      log(`DividendTrackerWidget: API failed, using cache (${apiError.message}).`);
      // Mark cache as stale by overriding status so banner displays "資料可能過期".
      const stalePayload = markUpcomingPayloadStale(cached.payload, cached.cachedAt);
      return { data: stalePayload, isCached: true, error: apiError };
    }
    // No cache — synthetic error payload so the widget renders something sensible.
    return {
      data: syntheticErrorPayload(apiError),
      isCached: false,
      error: apiError,
    };
  }
}

/**
 * Construct an error WidgetResponse so the renderer doesn't need a separate code path.
 * Mirrors the shape returned by the Worker when status is `source_error`.
 */
function syntheticErrorPayload(err: WidgetApiError): UpcomingWidgetResponse {
  const now = new Date();
  const currentMonth = now.getUTCMonth() + 1;
  const nextMonth = currentMonth === 12 ? 1 : currentMonth + 1;
  const nextYear = currentMonth === 12 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
  const periodError = (year: number, month: number): WidgetResponse => ({
    status: 'source_error',
    period: { year, month, timezone: 'Asia/Taipei' },
    items: [], totalGrossAmount: null,
    display: { title: '暫時無法取得', total: null, lines: ['暫時無法取得資料', err.message], compact: null },
    freshness: { stale: true, lastSuccessfulSync: null },
    generatedAt: now.toISOString(),
  });
  return {
    periods: [periodError(now.getUTCFullYear(), currentMonth), periodError(nextYear, nextMonth)],
    generatedAt: now.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Renderer: Lock Screen (accessoryRectangular)
// ---------------------------------------------------------------------------

/**
 * Lock Screen rectangular widget.
 * - Uses `addAccessoryWidgetBackground` for the tinted/standby asset.
 * - Renders exactly two centered lines: the month and the compact total.
 * - The inner translucent card supplies the visible rounded corners while iOS
 *   continues to control the accessory's outer size and system background.
 */
function renderLockScreen(widget: ListWidget, res: WidgetResponse): void {
  widget.addAccessoryWidgetBackground = true;
  widget.setPadding(3, 3, 3, 3);

  widget.addSpacer();
  const row = widget.addStack();
  row.layoutHorizontally();
  row.addSpacer();

  const card = row.addStack();
  card.layoutVertically();
  card.centerAlignContent();
  card.setPadding(7, 18, 7, 18);
  card.backgroundColor = new Color('#FFFFFF', 0.14);
  card.borderColor = new Color('#FFFFFF', 0.20);
  card.borderWidth = 1;
  card.cornerRadius = 13;

  const titleText = card.addText(`${res.period.month}月配息`);
  titleText.font = Font.semiboldSystemFont(12);
  titleText.minimumScaleFactor = 0.85;
  titleText.lineLimit = 1;
  titleText.centerAlignText();

  card.addSpacer(1);
  const total = res.totalGrossAmount
    ? compactYuanAmount(res.totalGrossAmount)
    : statusBanner(res.status) ?? '待公告';
  const totalText = card.addText(total);
  totalText.font = Font.blackSystemFont(22);
  totalText.minimumScaleFactor = 0.78;
  totalText.lineLimit = 1;
  totalText.centerAlignText();

  row.addSpacer();
  widget.addSpacer();
}

// ---------------------------------------------------------------------------
// Renderer: Home Screen medium (and StandBy — same layout, larger fonts).
// ---------------------------------------------------------------------------

interface HomePalette {
  start: string;
  end: string;
  primary: string;
  accent: string;
  quote: string;
  secondary: string;
  soft: string;
  cardBackground: string;
  cardOpacity: number;
}

const HOME_PALETTES: Record<WidgetTheme, HomePalette> = {
  ocean: { start: '#071426', end: '#0F766E', primary: '#F8FAFC', accent: '#99F6E4', quote: '#5EEAD4', secondary: '#CBD5E1', soft: '#CCFBF1', cardBackground: '#FFFFFF', cardOpacity: 0.10 },
  midnight: { start: '#020617', end: '#334155', primary: '#F8FAFC', accent: '#E2E8F0', quote: '#FFFFFF', secondary: '#CBD5E1', soft: '#F1F5F9', cardBackground: '#FFFFFF', cardOpacity: 0.10 },
  sunset: { start: '#2E1065', end: '#BE123C', primary: '#F8FAFC', accent: '#FDE68A', quote: '#FDBA74', secondary: '#E9D5FF', soft: '#FEF3C7', cardBackground: '#FFFFFF', cardOpacity: 0.10 },
  forest: { start: '#052E16', end: '#166534', primary: '#F8FAFC', accent: '#BBF7D0', quote: '#86EFAC', secondary: '#D1FAE5', soft: '#DCFCE7', cardBackground: '#FFFFFF', cardOpacity: 0.10 },
};

const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

function colorLuminance(hex: string): number {
  const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255);
  const linear = channels.map((channel) => (
    channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4)
  ));
  return 0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0);
}

function applyHomeScreenTheme(widget: ListWidget, appearance?: WidgetAppearance): HomePalette {
  const base = HOME_PALETTES[appearance?.theme ?? 'ocean'] ?? HOME_PALETTES.ocean;
  const customStart = appearance?.startColor && HEX_COLOR_PATTERN.test(appearance.startColor)
    ? appearance.startColor
    : null;
  const customEnd = appearance?.endColor && HEX_COLOR_PATTERN.test(appearance.endColor)
    ? appearance.endColor
    : null;
  const hasCustomColors = customStart !== null && customEnd !== null;
  const start = customStart ?? base.start;
  const end = hasCustomColors
    ? appearance?.mode === 'solid' ? start : customEnd ?? base.end
    : base.end;
  const startLuminance = colorLuminance(start);
  const endLuminance = colorLuminance(end);
  const mixedBackground = hasCustomColors && Math.abs(startLuminance - endLuminance) > 0.35;
  const lightBackground = hasCustomColors
    && !mixedBackground
    && (startLuminance + endLuminance) / 2 > 0.5;
  const palette: HomePalette = hasCustomColors
    ? lightBackground
      ? { start, end, primary: '#0F172A', accent: '#064E3B', quote: '#7C2D12', secondary: '#334155', soft: '#1E293B', cardBackground: '#FFFFFF', cardOpacity: 0.48 }
      : { start, end, primary: '#FFFFFF', accent: '#FFFFFF', quote: '#FDE68A', secondary: '#E2E8F0', soft: '#F8FAFC', cardBackground: mixedBackground ? '#000000' : '#FFFFFF', cardOpacity: mixedBackground ? 0.30 : 0.12 }
    : base;
  const gradient = new LinearGradient();
  gradient.colors = [new Color(palette.start), new Color(palette.end)];
  gradient.locations = [0, 1];
  gradient.startPoint = new Point(0, 0);
  gradient.endPoint = new Point(1, 1);
  widget.backgroundGradient = gradient;
  return palette;
}

function styleHomeText(text: WidgetText, font: Font, color = '#F8FAFC', opacity = 1): void {
  text.font = font;
  text.textColor = new Color(color, opacity);
  text.minimumScaleFactor = 0.72;
  text.lineLimit = 1;
}

function formatYuan(value: string | number | null | undefined): string {
  const formatted = fullAmount(value);
  return formatted === '—' ? formatted : `${formatted.replace(/^\$/, '')}元`;
}

function paymentMonth(payDate: string | null): string {
  if (!payDate) return '日期待定';
  const month = payDate.split('-')[1];
  return month ? `${month.replace(/^0/, '')}月` : '日期待定';
}

function addMediumItemRow(widget: ListWidget, item: WidgetItem, palette: HomePalette): void {
  const row = widget.addStack();
  row.layoutVertically();
  row.setPadding(5, 7, 5, 7);
  row.backgroundColor = new Color(palette.cardBackground, palette.cardOpacity);
  row.cornerRadius = 9;

  const top = row.addStack();
  top.layoutHorizontally();
  top.centerAlignContent();
  styleHomeText(top.addText(item.code), Font.boldSystemFont(12), palette.primary);
  top.addSpacer(6);
  styleHomeText(top.addText(paymentMonth(item.payDate)), Font.semiboldSystemFont(9), palette.accent);
  top.addSpacer();
  styleHomeText(top.addText(item.estimatedGrossAmount ? formatYuan(item.estimatedGrossAmount) : '金額待公告'), Font.boldSystemFont(11), palette.primary);

  row.addSpacer(2);
  const bottom = row.addStack();
  bottom.layoutHorizontally();
  bottom.centerAlignContent();
  styleHomeText(bottom.addText(`${item.shares}股`), Font.mediumSystemFont(8.5), palette.soft);
  bottom.addSpacer(5);
  styleHomeText(bottom.addText(`${item.dividendPerUnit ?? '待公告'}元`), Font.mediumSystemFont(8.5), palette.soft);
  bottom.addSpacer();
  styleHomeText(bottom.addText(`昨收${item.previousClose ?? '—'}`), Font.mediumSystemFont(8.5), palette.secondary);
  bottom.addSpacer(5);
  styleHomeText(bottom.addText(`今收${item.currentTrade ?? '—'}`), Font.boldSystemFont(9), palette.quote);
}

// ---------------------------------------------------------------------------
// Renderer: small Home Screen widget — month + total + count.
// ---------------------------------------------------------------------------

function renderSmall(widget: ListWidget, res: WidgetResponse, appearance?: WidgetAppearance): void {
  const palette = applyHomeScreenTheme(widget, appearance);
  widget.setPadding(14, 14, 14, 14);
  const summary = buildSmallSummary(res);

  const monthText = widget.addText(summary.month);
  styleHomeText(monthText, Font.boldSystemFont(12), palette.accent);

  widget.addSpacer(8);
  const totalText = widget.addText(summary.total);
  styleHomeText(totalText, Font.blackSystemFont(22), palette.primary);

  widget.addSpacer();
  const countText = widget.addText(summary.count);
  styleHomeText(countText, Font.mediumSystemFont(10), palette.secondary);
}

function renderUpcomingLockScreen(widget: ListWidget, res: UpcomingWidgetResponse): void {
  renderLockScreen(widget, res.periods[0]);
}

function renderUpcomingAccessoryInline(widget: ListWidget, res: UpcomingWidgetResponse): void {
  const current = res.periods[0];
  widget.addAccessoryWidgetBackground = true;
  widget.setPadding(4, 8, 4, 8);
  const currentTotal = current.totalGrossAmount ? compactYuanAmount(current.totalGrossAmount) : '待公告';
  const line = widget.addText(`${current.period.month}月配息 ${currentTotal}`);
  line.font = Font.boldSystemFont(11); line.minimumScaleFactor = 0.72; line.lineLimit = 1;
}

function renderUpcomingSmall(widget: ListWidget, res: UpcomingWidgetResponse): void {
  renderSmall(widget, res.periods[0], res.appearance);
  const next = buildUpcomingSummaries(res)[1];
  widget.addSpacer(4);
  const line = widget.addText(`${next.month} ${next.total}`);
  line.font = Font.regularSystemFont(10); line.minimumScaleFactor = 0.7; line.lineLimit = 1;
}

function renderUpcomingMedium(widget: ListWidget, res: UpcomingWidgetResponse, isCached: boolean, error?: WidgetApiError): void {
  const current = res.periods[0];
  const next = buildUpcomingSummaries(res)[1];
  const palette = applyHomeScreenTheme(widget, res.appearance);
  widget.setPadding(12, 13, 11, 13);

  const header = widget.addStack();
  header.layoutHorizontally();
  header.centerAlignContent();
  styleHomeText(header.addText(`${current.period.month}月預計配息`), Font.boldSystemFont(12), palette.accent);
  header.addSpacer();
  styleHomeText(header.addText(error || isCached ? '離線快取' : buildUpdateLabel(current)), Font.mediumSystemFont(8), error || isCached ? palette.quote : palette.secondary);

  widget.addSpacer(2);
  const hero = widget.addStack();
  hero.layoutHorizontally();
  hero.bottomAlignContent();
  styleHomeText(hero.addText(current.totalGrossAmount ? formatYuan(current.totalGrossAmount) : '待公告'), Font.blackSystemFont(25), palette.primary);
  hero.addSpacer(7);
  styleHomeText(hero.addText(`${current.period.month}月 · ${current.items.length}檔`), Font.mediumSystemFont(9), palette.secondary);

  widget.addSpacer(6);
  const visibleItems = current.items.slice(0, 2);
  if (visibleItems.length === 0) {
    const empty = widget.addStack();
    empty.setPadding(8, 9, 8, 9);
    empty.backgroundColor = new Color(palette.cardBackground, palette.cardOpacity);
    empty.cornerRadius = 9;
    styleHomeText(empty.addText(statusBanner(current.status) ?? '本月尚無已公告配息'), Font.semiboldSystemFont(11), palette.primary);
  } else {
    for (const item of visibleItems) {
      addMediumItemRow(widget, item, palette);
      widget.addSpacer(4);
    }
  }

  widget.addSpacer();
  const footer = widget.addStack();
  footer.layoutHorizontally();
  footer.centerAlignContent();
  const surplus = current.items.length > 2 ? `另${current.items.length - 2}筆 · ` : '';
  styleHomeText(footer.addText(`${surplus}下月 ${next.month}`), Font.mediumSystemFont(9), palette.secondary);
  footer.addSpacer();
  styleHomeText(footer.addText(`${next.total}  ${next.status ?? next.count}`), Font.semiboldSystemFont(9), palette.soft);
}

// ---------------------------------------------------------------------------
// Footer / schedule helpers
// ---------------------------------------------------------------------------

/**
 * Build the footer line shown at the bottom of Home Screen medium widgets.
 * Includes the freshness / cached indicator.
 */
function buildUpdateLabel(res: WidgetResponse): string {
  const timestamp = res.freshness?.lastSuccessfulSync ?? res.generatedAt;
  return timestamp ? `更新 ${formatRelative(timestamp)}` : '已同步';
}

/**
 * Format an ISO 8601 timestamp as a compact relative time (e.g. "3小時前").
 */
function formatRelative(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const diffSec = (Date.now() - then) / 1000;
  if (diffSec < 60) return '剛剛';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}分前`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}小時前`;
  return `${Math.floor(diffSec / 86400)}天前`;
}

function dashboardUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '') + DASHBOARD_PATH;
}

// ---------------------------------------------------------------------------
// Preview actions — invoked from the setup menu (config.ts).
// ---------------------------------------------------------------------------

/**
 * Show a preview of the widget using Scriptable's `presentMedium` /
 * similar API. Used by the setup menu's "預覽鎖定畫面" / "預覽主畫面" actions.
 */
export async function previewWidgetFamily(family: 'medium' | 'accessoryRectangular'): Promise<void> {
  const config = loadConfig();
  if (!config) {
    const a = new Alert();
    a.title = '尚未設定';
    a.message = '請先執行初始設定。';
    a.addAction('確認');
    await a.present();
    return;
  }

  // Try API; fall back to this installation's cache; finally show the existing
  // synthetic error/empty state. Never invent holdings, prices, or dividends.
  let data: UpcomingWidgetResponse;
  let isCached = false;
  try {
    data = await fetchWidgetPayload(config.baseUrl, config.widgetToken);
  } catch {
    const cached = readCache(config.installationId);
    if (cached) {
      data = cached.payload;
      isCached = true;
    } else {
      data = syntheticErrorPayload(new WidgetApiError('無法載入 Widget 資料。', 0));
    }
  }

  const widget = new ListWidget();
  widget.url = dashboardUrl(config.baseUrl);
  if (family === 'accessoryRectangular') {
    renderUpcomingLockScreen(widget, data);
    await widget.presentAccessoryRectangular();
  } else {
    renderUpcomingMedium(widget, data, isCached);
    await widget.presentMedium();
  }
}

/**
 * Test API connectivity — invoked from the setup menu's "測試API" action.
 */
export async function testApiWithConfig(cfg: WidgetConfig): Promise<void> {
  const alert = new Alert();
  try {
    const res = await fetchWidgetPayload(cfg.baseUrl, cfg.widgetToken);
    alert.title = 'API 測試成功';
    const summaries = buildUpcomingSummaries(res);
    alert.message = summaries.map((summary) => `${summary.month}: ${summary.total} (${summary.count})`).join('\n');
  } catch (e) {
    const w = e as WidgetApiError;
    alert.title = 'API 測試失敗';
    alert.message = `HTTP ${w.status} — ${w.message}`;
  }
  alert.addAction('確認');
  await alert.present();
}

// ---------------------------------------------------------------------------
// Default export — Scriptable uses `Module.run()` if defined.
// ---------------------------------------------------------------------------
export default run;

// ---------------------------------------------------------------------------
// Auto-execute when run inside Scriptable. Scriptable calls `run()` itself
// when this file is the active widget; if it's run from inside the app
// script body, we also call `run()` automatically.
// ---------------------------------------------------------------------------

// Scriptable executes the file top-level for both an installed widget and a
// manual in-app run. Always invoke run(): widget runs render immediately,
// while an in-app run opens setup/preview and confirms the embedded settings.
run().catch((e) => {
  log(`DividendTrackerWidget error: ${(e as Error).message}`);
  Script.complete();
});
