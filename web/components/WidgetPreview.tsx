import type { WidgetAppearanceDTO, WidgetResponseDTO, WidgetTheme } from "@/api/client";
import { compactLockScreenYuan } from "@/lib/compact-amount";
import { formatAmount, formatInt } from "@/lib/format";

function yuan(value: string | null | undefined): string {
  return value ? `${formatAmount(value)}元` : "待公告";
}

function paymentMonth(payDate: string | null): string {
  if (!payDate) return "日期待定";
  const month = payDate.split("-")[1];
  return month ? `${Number(month)}月` : "日期待定";
}

const THEME_COLORS: Record<WidgetTheme, { startColor: string; endColor: string }> = {
  ocean: { startColor: "#071426", endColor: "#0F766E" },
  midnight: { startColor: "#020617", endColor: "#334155" },
  sunset: { startColor: "#2E1065", endColor: "#BE123C" },
  forest: { startColor: "#052E16", endColor: "#166534" },
};

const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255);
  const linear = channels.map((channel) => (
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ));
  return 0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0);
}

function rgba(hex: string, alpha: number): string {
  const red = Number.parseInt(hex.slice(1, 3), 16);
  const green = Number.parseInt(hex.slice(3, 5), 16);
  const blue = Number.parseInt(hex.slice(5, 7), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function widgetColors(appearance?: WidgetAppearanceDTO) {
  const fallback = THEME_COLORS[appearance?.theme ?? "ocean"];
  const startColor = appearance?.startColor && HEX_COLOR_PATTERN.test(appearance.startColor)
    ? appearance.startColor
    : fallback.startColor;
  const requestedEnd = appearance?.endColor && HEX_COLOR_PATTERN.test(appearance.endColor)
    ? appearance.endColor
    : fallback.endColor;
  const endColor = appearance?.mode === "solid" ? startColor : requestedEnd;
  const startLuminance = relativeLuminance(startColor);
  const endLuminance = relativeLuminance(endColor);
  const isMixed = Math.abs(startLuminance - endLuminance) > 0.35;
  const isLight = !isMixed && (startLuminance + endLuminance) / 2 > 0.5;
  return {
    startColor,
    endColor,
    background: appearance?.mode === "solid"
      ? startColor
      : `linear-gradient(135deg, ${startColor}, ${endColor})`,
    standby: `linear-gradient(90deg, #000000 0%, ${startColor} 48%, ${endColor} 100%)`,
    foreground: isLight ? "#0F172A" : "#FFFFFF",
    muted: isLight ? "#334155" : "#CBD5E1",
    accent: isLight ? "#064E3B" : "#FDE68A",
    card: isLight
      ? "rgba(255, 255, 255, 0.48)"
      : isMixed ? "rgba(0, 0, 0, 0.30)" : "rgba(255, 255, 255, 0.12)",
    border: isLight ? "rgba(15, 23, 42, 0.12)" : "rgba(255, 255, 255, 0.12)",
    glow: rgba(endColor, 0.25),
  };
}

/** Phone-sized previews that mirror the Scriptable lock-screen and Home Screen renderers. */
export function WidgetPreview({
  data,
  loading,
  error,
}: {
  data: WidgetResponseDTO | null;
  loading?: boolean;
  error?: string | null;
}) {
  if (loading) {
    return <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-400">小工具資料載入中…</div>;
  }
  if (error) {
    return <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-600 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-400">無法載入小工具資料：{error}</div>;
  }
  if (!data) return null;

  const firstItem = data.items[0];
  const colors = widgetColors(data.appearance);

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <section>
        <div className="mb-2 flex items-center justify-between gap-3">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">📱 鎖定畫面</h4>
          <span className="text-[11px] text-slate-400">外框尺寸由 iOS 固定</span>
        </div>
        <div className="relative flex h-[260px] max-w-[430px] items-center justify-center overflow-hidden rounded-[34px] bg-[radial-gradient(circle_at_25%_20%,#2563eb_0%,#0f172a_43%,#020617_100%)] p-6 text-white shadow-2xl shadow-slate-950/25">
          <div className="absolute left-7 top-5 text-3xl font-semibold tabular-nums tracking-tight">09:41</div>
          <div data-testid="lock-screen-card" className="w-[220px] rounded-[26px] border border-white/25 bg-white/15 px-8 py-5 text-center shadow-xl backdrop-blur-2xl">
            <div className="text-sm font-semibold tracking-wide">{data.period.month}月配息</div>
            <div className="mt-1 text-3xl font-black leading-none tracking-tight">{compactLockScreenYuan(data.totalGrossAmount)}</div>
          </div>
        </div>
      </section>

      <section>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">🏠 主畫面 Medium（建議）</h4>
        <div className="relative aspect-[2/1] w-full max-w-[520px] overflow-hidden rounded-[30px] border p-5 shadow-2xl shadow-slate-950/25" style={{ background: colors.background, color: colors.foreground, borderColor: colors.border }}>
          <div className="absolute -right-12 -top-16 h-44 w-44 rounded-full blur-2xl" style={{ backgroundColor: colors.glow }} />
          <div className="relative flex items-center justify-between">
            <div className="text-sm font-bold" style={{ color: colors.accent }}>{data.period.month}月預計配息</div>
            <div className="rounded-full border px-2.5 py-1 text-[10px]" style={{ color: colors.muted, borderColor: colors.border, backgroundColor: colors.card }}>已同步</div>
          </div>
          <div className="relative mt-1.5 flex items-end gap-3">
            <div className="text-[30px] font-black leading-none tracking-tight">{yuan(data.totalGrossAmount)}</div>
            <div className="pb-0.5 text-[10px]" style={{ color: colors.muted }}>{data.period.month}月 · {data.items.length}檔</div>
          </div>
          <div className="relative mt-3 space-y-2">
            {data.items.length === 0 && <div className="rounded-xl border p-3 text-sm" style={{ borderColor: colors.border, backgroundColor: colors.card }}>本月尚無已公告配息</div>}
            {data.items.slice(0, 2).map((item) => (
              <div key={item.instrumentId} className="rounded-xl border px-3 py-2 shadow-sm backdrop-blur" style={{ borderColor: colors.border, backgroundColor: colors.card }}>
                <div className="flex items-center gap-2 text-xs">
                  <strong className="font-mono text-sm">{item.code}</strong>
                  <span className="font-semibold" style={{ color: colors.accent }}>{paymentMonth(item.payDate)}</span>
                  <span className="ml-auto font-bold">{yuan(item.estimatedGrossAmount)}</span>
                </div>
                <div className="mt-1 flex items-center gap-2 text-[10px]" style={{ color: colors.muted }}>
                  <span>{formatInt(item.shares)}股</span>
                  <span>·</span>
                  <span>{item.dividendPerUnit ?? "待公告"}元</span>
                  <span className="ml-auto">昨收{item.previousClose ?? "—"}</span>
                  <span className="font-bold" style={{ color: colors.accent }}>今收{item.currentTrade ?? "—"}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="xl:col-span-2">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">🌙 StandBy 橫向</h4>
        <div className="flex max-w-[720px] items-center gap-8 overflow-hidden rounded-[32px] p-7 shadow-2xl" style={{ background: colors.standby }}>
          <div className="min-w-36 border-r border-white/10 pr-8 text-white">
            <div className="text-5xl font-black tabular-nums tracking-tight">09:41</div>
            <div className="mt-1 text-xs text-white/50">星期二 · {data.period.month}月</div>
          </div>
          <div className="min-w-0 flex-1" style={{ color: colors.foreground }}>
            <div className="text-xs font-bold" style={{ color: colors.accent }}>{data.period.month}月預計配息</div>
            <div className="mt-1 text-3xl font-black tracking-tight">{yuan(data.totalGrossAmount)}</div>
            {firstItem && <div className="mt-3 rounded-xl border px-3 py-2 text-xs" style={{ borderColor: colors.border, backgroundColor: colors.card }}><strong>{firstItem.code}</strong> · {paymentMonth(firstItem.payDate)} · {formatInt(firstItem.shares)}股 × {firstItem.dividendPerUnit ?? "待公告"}元 · <strong>{yuan(firstItem.estimatedGrossAmount)}</strong> · 昨收{firstItem.previousClose ?? "—"} · <span className="font-bold" style={{ color: colors.accent }}>今收{firstItem.currentTrade ?? "—"}</span></div>}
          </div>
        </div>
      </section>
    </div>
  );
}

export default WidgetPreview;
