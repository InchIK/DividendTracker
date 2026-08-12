/** Download and configure a fresh, installation-scoped Scriptable Widget. */
import { useState, useCallback, useEffect } from 'react';
import { api } from '@/api/client';
import type { WidgetBackgroundMode } from '@/api/client';
import { customizeWidgetScript, normalizeWidgetDownloadConfig } from '@/lib/widget-script';

const QUICK_COLORS: { label: string; startColor: string; endColor: string }[] = [
  { label: '海灣', startColor: '#071426', endColor: '#0F766E' },
  { label: '午夜', startColor: '#020617', endColor: '#334155' },
  { label: '夕陽', startColor: '#2E1065', endColor: '#BE123C' },
  { label: '森林', startColor: '#052E16', endColor: '#166534' },
];

const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

function colorPickerValue(value: string): string {
  return HEX_COLOR_PATTERN.test(value) ? value : '#000000';
}

function colorLuminance(value: string): number {
  const channels = [1, 3, 5].map((index) => Number.parseInt(value.slice(index, index + 2), 16) / 255);
  const linear = channels.map((channel) => (
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ));
  return 0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0);
}

export function WidgetSetupPage() {
  // The current page origin is the only permitted endpoint. It is displayed,
  // but never editable, so a download cannot be pointed at another account.
  const baseUrl = window.location.origin;
  const [tokenPassword, setTokenPassword] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [downloadMessage, setDownloadMessage] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [backgroundMode, setBackgroundMode] = useState<WidgetBackgroundMode>('gradient');
  const [startColor, setStartColor] = useState('#071426');
  const [endColor, setEndColor] = useState('#0F766E');
  const [themeLoading, setThemeLoading] = useState(true);
  const [themeSaving, setThemeSaving] = useState(false);
  const [themeMessage, setThemeMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void api.getWidgetSettings()
      .then((appearance) => {
        if (!active) return;
        setBackgroundMode(appearance.mode ?? 'gradient');
        setStartColor(appearance.startColor || '#071426');
        setEndColor(appearance.endColor || appearance.startColor || '#0F766E');
      })
      .catch((error: unknown) => {
        if (active) setThemeMessage(error instanceof Error ? error.message : '無法載入外觀設定。');
      })
      .finally(() => { if (active) setThemeLoading(false); });
    return () => { active = false; };
  }, []);

  const handleThemeSave = useCallback(async () => {
    setThemeSaving(true);
    setThemeMessage(null);
    try {
      const saved = await api.updateWidgetSettings({
        mode: backgroundMode,
        startColor,
        endColor: backgroundMode === 'solid' ? startColor : endColor,
      });
      setBackgroundMode(saved.mode);
      setStartColor(saved.startColor);
      setEndColor(saved.endColor);
      setThemeMessage('外觀設定已儲存，之後下載的 Widget 會套用。');
    } catch (error) {
      setThemeMessage(error instanceof Error ? error.message : '外觀設定儲存失敗。');
    } finally {
      setThemeSaving(false);
    }
  }, [backgroundMode, endColor, startColor]);

  const handleDownload = useCallback(async () => {
    if (!tokenPassword.trim() || downloading) return;
    setDownloading(true);
    setDownloadError(null);
    setDownloadMessage(null);

    try {
      // Always fetch a clean template and rotate exactly once per click. Any
      // token from an earlier render/download is intentionally ignored.
      const response = await fetch('/widget/DividendTrackerWidget.js', { cache: 'no-store' });
      if (!response.ok) throw new Error(`Widget 模板下載失敗（HTTP ${response.status}）。`);
      const source = await response.text();
      const rotated = await api.rotateWidgetToken(tokenPassword);
      const config = normalizeWidgetDownloadConfig(
        baseUrl,
        rotated.token,
        crypto.randomUUID(),
      );
      const customized = customizeWidgetScript(source, config);

      // Verify the newly rotated credential before creating a download file.
      await api.testWidgetConnection(config.baseUrl, config.widgetToken);
      const url = URL.createObjectURL(new Blob([customized], { type: 'text/javascript;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'DividendTrackerWidget.js';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setDownloadMessage('已下載全新 Widget。每次下載都會建立新 Token；先前下載的 Widget 會立即停止運作。');
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : 'Widget 下載失敗。');
    } finally {
      setTokenPassword('');
      setDownloading(false);
    }
  }, [baseUrl, downloading, tokenPassword]);

  const startColorValid = HEX_COLOR_PATTERN.test(startColor);
  const endColorValid = HEX_COLOR_PATTERN.test(endColor);
  const colorsValid = startColorValid && (backgroundMode === 'solid' || endColorValid);
  const previewBackground = colorsValid
    ? backgroundMode === 'solid' ? startColor : `linear-gradient(135deg, ${startColor}, ${endColor})`
    : '#0F172A';
  const previewStartLuminance = colorsValid ? colorLuminance(startColor) : 0;
  const previewEndLuminance = colorsValid ? colorLuminance(backgroundMode === 'solid' ? startColor : endColor) : 0;
  const previewMixed = colorsValid && Math.abs(previewStartLuminance - previewEndLuminance) > 0.35;
  const previewLight = colorsValid && !previewMixed && (previewStartLuminance + previewEndLuminance) / 2 > 0.5;
  const previewForeground = previewLight ? '#0F172A' : '#FFFFFF';
  const previewMuted = previewLight ? '#334155' : 'rgba(255, 255, 255, 0.8)';
  const previewCard = previewLight
    ? 'rgba(255, 255, 255, 0.48)'
    : previewMixed ? 'rgba(0, 0, 0, 0.30)' : 'rgba(255, 255, 255, 0.15)';

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4">
      <h1 className="text-2xl font-bold">iPhone Widget 設定</h1>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">1. 外觀設定</h2>
        <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
          <div className="space-y-4 rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
            <div className="grid grid-cols-2 gap-2" role="group" aria-label="背景模式">
              {(['solid', 'gradient'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  disabled={themeLoading || themeSaving}
                  onClick={() => setBackgroundMode(mode)}
                  className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${backgroundMode === mode ? 'border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-slate-200 dark:border-slate-700'}`}
                >
                  {mode === 'solid' ? '單色' : '漸層'}
                </button>
              ))}
            </div>
            <label className="block space-y-2 text-sm font-medium">
              <span>{backgroundMode === 'solid' ? '背景顏色' : '起始顏色'}</span>
              <span className="flex gap-2">
                <input aria-label="起始顏色選擇" type="color" value={colorPickerValue(startColor)} onChange={(event) => setStartColor(event.target.value.toUpperCase())} className="h-11 w-14 cursor-pointer rounded-lg border border-slate-300 bg-transparent p-1 dark:border-slate-600" />
                <input aria-label="起始顏色 HEX" type="text" value={startColor} onChange={(event) => setStartColor(event.target.value.toUpperCase())} maxLength={7} spellCheck={false} className={`min-w-0 flex-1 rounded-lg border px-3 py-2 font-mono uppercase dark:bg-slate-900 ${startColorValid ? 'border-slate-300 dark:border-slate-600' : 'border-red-500'}`} />
              </span>
            </label>
            {backgroundMode === 'gradient' && (
              <label className="block space-y-2 text-sm font-medium">
                <span>結束顏色</span>
                <span className="flex gap-2">
                  <input aria-label="結束顏色選擇" type="color" value={colorPickerValue(endColor)} onChange={(event) => setEndColor(event.target.value.toUpperCase())} className="h-11 w-14 cursor-pointer rounded-lg border border-slate-300 bg-transparent p-1 dark:border-slate-600" />
                  <input aria-label="結束顏色 HEX" type="text" value={endColor} onChange={(event) => setEndColor(event.target.value.toUpperCase())} maxLength={7} spellCheck={false} className={`min-w-0 flex-1 rounded-lg border px-3 py-2 font-mono uppercase dark:bg-slate-900 ${endColorValid ? 'border-slate-300 dark:border-slate-600' : 'border-red-500'}`} />
                </span>
              </label>
            )}
            <div className="flex flex-wrap gap-2">
              {QUICK_COLORS.map((option) => (
                <button key={option.label} type="button" disabled={themeLoading || themeSaving} onClick={() => { setBackgroundMode('gradient'); setStartColor(option.startColor); setEndColor(option.endColor); }} className="flex items-center gap-2 rounded-full border border-slate-200 px-2.5 py-1.5 text-xs transition hover:border-slate-400 dark:border-slate-700">
                  <span className="h-5 w-5 rounded-full" style={{ background: `linear-gradient(135deg, ${option.startColor}, ${option.endColor})` }} />
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="relative min-h-64 overflow-hidden rounded-[28px] p-5 shadow-2xl" style={{ background: previewBackground, color: previewForeground }} aria-label="外觀預覽">
            <div className="relative flex items-center justify-between text-xs font-semibold"><span>本月摘要</span><span className="rounded-full px-2 py-1" style={{ backgroundColor: previewCard }}>Widget 預覽</span></div>
            <div className="relative mt-2 text-3xl font-black">摘要欄位</div>
            <div className="relative mt-4 space-y-2">
              {['標的 A', '標的 B'].map((label) => (
                <div key={label} className="rounded-xl border border-white/15 px-3 py-2 backdrop-blur" style={{ backgroundColor: previewCard }}>
                  <div className="flex text-sm font-bold"><span>{label}</span><span className="ml-auto">金額欄位</span></div>
                  <div className="mt-1 text-xs" style={{ color: previewMuted }}>股數欄位 · 股利欄位 · 價格欄位</div>
                </div>
              ))}
            </div>
          </div>
        </div>
        {!colorsValid && <p className="text-sm text-red-600 dark:text-red-400">顏色必須是 #RRGGBB 格式。</p>}
        <button onClick={() => { void handleThemeSave(); }} disabled={themeLoading || themeSaving || !colorsValid} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50">{themeSaving ? '儲存中…' : '儲存外觀設定'}</button>
        {themeMessage && <div role="status" className="rounded-lg bg-slate-100 p-3 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-200">{themeMessage}</div>}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">2. 下載全新 Widget</h2>
        <p className="text-sm opacity-70">每次下載都會建立全新的 Widget Token 與安裝識別碼；所有先前下載的 Widget 會立即停止運作。下載時需要輸入目前帳號密碼。</p>
        <label className="block space-y-2 text-sm font-medium">
          <span>目前網站 Origin（唯讀）</span>
          <input aria-label="目前網站 Origin" readOnly value={baseUrl} className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 dark:border-slate-700 dark:bg-slate-800" />
        </label>
        <input type="password" value={tokenPassword} onChange={(event) => setTokenPassword(event.target.value)} autoComplete="current-password" placeholder="輸入目前帳號密碼" aria-label="目前帳號密碼" className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-950" />
        <button onClick={() => { void handleDownload(); }} disabled={downloading || !tokenPassword.trim()} className="rounded-lg bg-blue-600 px-4 py-2 text-white transition hover:bg-blue-700 disabled:opacity-50" aria-label="下載全新 Widget">
          {downloading ? '正在建立全新 Widget…' : '下載全新 Widget'}
        </button>
        {downloadMessage && <div role="status" className="rounded-lg bg-green-100 p-3 text-sm text-green-700 dark:bg-green-900 dark:text-green-200">{downloadMessage}</div>}
        {downloadError && <div role="alert" className="rounded-lg bg-red-100 p-3 text-sm text-red-700 dark:bg-red-900 dark:text-red-200">{downloadError}</div>}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">3. Scriptable 安裝</h2>
        <ol className="list-decimal space-y-1 pl-5 text-sm opacity-80">
          <li>下載完成後，在 iPhone 的「檔案」開啟 DividendTrackerWidget.js。</li>
          <li>選擇分享至 Scriptable，儲存並加入主畫面 Widget。</li>
          <li>若要重新下載，回到本頁輸入目前密碼；重新下載會讓舊 Widget 失效。</li>
        </ol>
      </section>
    </div>
  );
}
