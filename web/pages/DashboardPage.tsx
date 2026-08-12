import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type DashboardResponse, type SourcesStatusResponse, type WidgetResponseDTO } from "@/api/client";
import { formatAmount, formatDate, formatInt } from "@/lib/format";
import { FreshnessCard } from "@/components/FreshnessCard";
import { WidgetPreview } from "@/components/WidgetPreview";

type PeriodScope = "year" | "month" | "day" | "all";

const MONTH_NAMES = [
  "1月", "2月", "3月", "4月", "5月", "6月",
  "7月", "8月", "9月", "10月", "11月", "12月",
];

function nowTaipei(): { year: number; month: number; day: number } {
  const value = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [year, month, day] = value.split("-").map(Number);
  return { year, month, day };
}

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function shiftedDate(year: number, month: number, day: number, scope: PeriodScope, delta: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (scope === "year") date.setUTCFullYear(date.getUTCFullYear() + delta);
  if (scope === "month") date.setUTCMonth(date.getUTCMonth() + delta, 1);
  if (scope === "day") date.setUTCDate(date.getUTCDate() + delta);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function periodTitle(scope: PeriodScope, year: number, month: number, day: number): string {
  if (scope === "all") return "全部期間";
  if (scope === "year") return `${year} 年`;
  if (scope === "month") return `${year} 年 ${month} 月`;
  return `${year} 年 ${month} 月 ${day} 日`;
}

export function DashboardPage(): React.JSX.Element {
  const today = useMemo(nowTaipei, []);
  const [scope, setScope] = useState<PeriodScope>("month");
  const [year, setYear] = useState(today.year);
  const [month, setMonth] = useState(today.month);
  const [day, setDay] = useState(today.day);
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [widget, setWidget] = useState<WidgetResponseDTO | null>(null);
  const [sources, setSources] = useState<SourcesStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [widgetError, setWidgetError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setWidgetError(null);
    try {
      const selectedYear = scope === "all" ? undefined : year;
      const selectedMonth = scope === "month" || scope === "day" ? month : undefined;
      const selectedDay = scope === "day" ? day : undefined;
      const [dashboard, sourceStatus] = await Promise.all([
        api.getDashboard(selectedYear, selectedMonth, scope === "all", selectedDay),
        api.getSourcesStatus().catch(() => null),
      ]);
      setData(dashboard);
      setSources(sourceStatus);
      if (scope === "month") {
        setWidget(await api.getWidgetCurrent(year, month).catch((widgetFailure: unknown) => {
          setWidgetError(widgetFailure instanceof Error ? widgetFailure.message : "載入失敗");
          return null;
        }));
      } else {
        setWidget(null);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "載入儀表板失敗");
    } finally {
      setLoading(false);
    }
  }, [scope, year, month, day]);

  useEffect(() => { void load(); }, [load]);

  const movePeriod = (delta: number): void => {
    if (scope === "all") return;
    const next = shiftedDate(year, month, day, scope, delta);
    setYear(next.year); setMonth(next.month); setDay(next.day);
  };

  const goToday = (): void => {
    setYear(today.year); setMonth(today.month); setDay(today.day);
  };

  const runSync = async (): Promise<void> => {
    if (syncing) return;
    setSyncing(true);
    setNotice("正在立即回補所有已設定標的一年股利並更新行情…");
    setError(null);
    try {
      const result = await api.triggerSync();
      const status = result.status === "success" && result.prices.outcome === "success" ? "完成" : "部分完成";
      setNotice(`同步${status}：讀取 ${result.finmindRows} 筆歷史資料、更新 ${result.eventsChanged} 筆事件、行情 ${result.prices.persisted}/${result.prices.selected} 檔。`);
      await load();
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "同步失敗");
      setNotice(null);
    } finally {
      setSyncing(false);
    }
  };

  const rows = data?.items ?? [];
  const summary = data?.summary;
  const current = year === today.year && month === today.month && day === today.day;
  const title = periodTitle(scope, year, month, day);

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <select value={scope} onChange={(event) => setScope(event.target.value as PeriodScope)} aria-label="查詢範圍" className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800">
            <option value="year">每年</option>
            <option value="month">每月</option>
            <option value="day">每日</option>
            <option value="all">全部</option>
          </select>
          <button onClick={() => movePeriod(-1)} disabled={scope === "all"} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800" aria-label="上一期">‹</button>
          {scope !== "all" && scope !== "day" && (
            <select value={year} onChange={(event) => setYear(Number(event.target.value))} className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800">
              {Array.from({ length: 12 }, (_, index) => today.year - 6 + index).map((optionYear) => <option key={optionYear} value={optionYear}>{optionYear} 年</option>)}
            </select>
          )}
          {scope === "month" && (
            <select value={month} onChange={(event) => setMonth(Number(event.target.value))} className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800">
              {MONTH_NAMES.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}
            </select>
          )}
          {scope === "day" && (
            <input type="date" aria-label="選擇日期" value={isoDate(year, month, day)} onInput={(event) => {
              const [nextYear, nextMonth, nextDay] = event.currentTarget.value.split("-").map(Number);
              if (nextYear && nextMonth && nextDay) { setYear(nextYear); setMonth(nextMonth); setDay(nextDay); }
            }} className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800" />
          )}
          <button onClick={() => movePeriod(1)} disabled={scope === "all"} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800" aria-label="下一期">›</button>
          <button onClick={goToday} disabled={current && scope !== "all"} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800">今天</button>
        </div>
        <div className="flex gap-2">
          <button onClick={() => void load()} disabled={loading || syncing} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-slate-600">重新整理</button>
          <button onClick={() => void runSync()} disabled={syncing} className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">{syncing ? "同步回補中…" : "立即同步全部標的"}</button>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryCard label={`${title}預計配息毛額`} value={summary ? `$${formatAmount(summary.totalGrossAmount ?? "0")}` : "—"} tone="emerald" />
        <SummaryCard label="配息 ETF／股票數" value={summary ? String(summary.instrumentCount ?? summary.etfCount) : "—"} tone="blue" />
        <SummaryCard label="待公告數量" value={summary ? String(summary.pendingCount) : "—"} tone="amber" />
        <SummaryCard label="最後成功同步" value={summary?.lastSuccessfulSync ? new Date(summary.lastSuccessfulSync).toLocaleString("zh-Hant", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "從未"} tone="slate" small />
      </section>

      {notice && <div role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-900/20 dark:text-emerald-300">{notice}</div>}
      {error && <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-400">⚠️ {error}</div>}

      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-800 dark:text-slate-100">{title}配息與行情</h2>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800/60">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              <tr><Th>ETF／個股</Th><Th>發放日</Th><Th align="right">股數</Th><Th align="right">配息</Th><Th align="right">預計毛額</Th><Th align="right">昨日收盤</Th><Th align="right">今日成交</Th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {loading ? <tr><td colSpan={7} className="py-10 text-center text-slate-400">載入中…</td></tr>
                : rows.length === 0 ? <tr><td colSpan={7} className="py-10 text-center text-slate-400">{title}尚無已設定標的的配息資料</td></tr>
                  : rows.map((row) => (
                    <tr key={row.eventKey} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                      <td className="px-3 py-2"><div className="flex items-center gap-2"><span className="font-mono font-semibold">{row.code}</span><span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] dark:bg-slate-700">{row.kind === "etf" ? "ETF" : "股票"}</span></div><div className="text-xs text-slate-500">{row.displayName}・{row.market === "twse" ? "上市" : "上櫃"}</div></td>
                      <td className="whitespace-nowrap px-3 py-2">{formatDate(row.payDate)}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatInt(row.shares)}<div className="text-[10px] text-slate-400">{row.sharesBasis === "event_override" ? "事件覆寫" : "目前持股估算"}</div></td>
                      <td className="px-3 py-2 text-right font-mono">{row.dividendPerUnit ?? "待公告"}<div className="text-[10px] text-slate-400">{row.sourceLabel}</div></td>
                      <td className="px-3 py-2 text-right font-mono font-semibold">{row.estimatedGrossAmount ? `$${formatAmount(row.estimatedGrossAmount)}` : "—"}</td>
                      <td className="px-3 py-2 text-right font-mono">{row.previousClose ?? "—"}</td>
                      <td className="px-3 py-2 text-right font-mono">{row.currentTrade ?? "—"}<div className={`text-[10px] ${row.priceStale ? "text-amber-500" : "text-slate-400"}`}>{row.tradeDate ?? "尚無行情"}{row.tradeTime ? ` ${row.tradeTime}` : ""}</div></td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      </section>

      {scope === "month" && <section><h2 className="mb-3 text-lg font-semibold text-slate-800 dark:text-slate-100">手機小工具預覽</h2><WidgetPreview data={widget} loading={loading} error={widgetError} /></section>}

      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-800 dark:text-slate-100">資料來源新鮮度</h2>
        {sources && sources.sources.length > 0
          ? <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">{sources.sources.map((source) => <FreshnessCard key={source.sourceKind} source={source} />)}</div>
          : <p className="text-sm text-slate-500 dark:text-slate-400">尚無來源狀態資料。</p>}
      </section>
    </div>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: "right" }) {
  return <th className={`whitespace-nowrap px-3 py-2 text-xs font-semibold uppercase tracking-wider ${align === "right" ? "text-right" : "text-left"}`}>{children}</th>;
}

const TONES: Record<string, string> = {
  emerald: "border-emerald-200 bg-emerald-50 dark:border-emerald-900/40 dark:bg-emerald-900/20",
  blue: "border-blue-200 bg-blue-50 dark:border-blue-900/40 dark:bg-blue-900/20",
  amber: "border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-900/20",
  slate: "border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/40",
};

function SummaryCard({ label, value, tone, small }: { label: string; value: string; tone: keyof typeof TONES; small?: boolean }) {
  return <div className={`rounded-xl border p-4 ${TONES[tone] ?? TONES.slate}`}><div className="text-xs text-slate-500 dark:text-slate-400">{label}</div><div className={`mt-1 break-all font-semibold text-slate-800 dark:text-slate-100 ${small ? "text-sm" : "text-xl"}`}>{value}</div></div>;
}

export default DashboardPage;
