import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  type CanonicalEventDTO,
  type SourceObservationDTO,
  type ManualVerifyPayload,
  type WatchlistItemDTO,
} from "@/api/client";
import { formatAmount, formatDate, formatDateTime, formatInt } from "@/lib/format";
import StatusBadge from "@/components/StatusBadge";

const TWSE_DIVIDEND_LIST_URL = "https://www.twse.com.tw/zh/ETFortune/dividendList";

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

function nowYm(): { year: number; month: number } {
  const d = new Date();
  const taipei = new Date(d.toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
  return { year: taipei.getFullYear(), month: taipei.getMonth() + 1 };
}

const SOURCE_LABEL: Record<string, string> = {
  manual_verified: "官方人工覆核",
  sitca_open_data: "投信投顧公會開放資料",
  twse_ex_schedule: "證交所預告",
  twse_fund_mapping: "證交所基金對應",
};

export function DividendsPage(): React.JSX.Element {
  const today = useMemo(nowYm, []);
  const [year, setYear] = useState<number>(today.year);
  const [month, setMonth] = useState<number>(today.month);
  const [codeFilter, setCodeFilter] = useState<string>("");
  const [events, setEvents] = useState<CanonicalEventDTO[]>([]);
  const [watchlist, setWatchlist] = useState<WatchlistItemDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [dividends, currentWatchlist] = await Promise.all([
        api.getDividends(year || undefined, month || undefined, codeFilter || undefined),
        api.getWatchlist(),
      ]);
      setEvents(dividends.items ?? []);
      setWatchlist(currentWatchlist.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "載入配息事件失敗");
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [year, month, codeFilter]);

  useEffect(() => { void load(); }, [load]);

  const filterOptions = useMemo(() => {
    const unique = new Map<string, WatchlistItemDTO>();
    for (const item of watchlist) {
      if (!unique.has(item.code)) unique.set(item.code, item);
    }
    return [...unique.values()].sort((a, b) => a.code.localeCompare(b.code));
  }, [watchlist]);

  const toggleExpand = (key: string) =>
    setExpanded((p) => ({ ...p, [key]: !p[key] }));

  const onUpdateAfterUnlock = () => { void load(); };

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">配息事件</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          檢視每月配息事件、展開觀測來源、人工覆核與鎖定。
        </p>
      </header>

      {/* Filters */}
      <section className="flex flex-wrap gap-2 items-end">
        <div>
          <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">年度</label>
          <select value={year} onChange={(e) => {
            const nextYear = Number(e.target.value);
            setYear(nextYear);
            if (nextYear === 0) setMonth(0);
          }}
            className="px-2 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm">
            <option value={0}>全部年度</option>
            {Array.from({ length: 10 }, (_, i) => today.year - 5 + i).map((y) => (
              <option key={y} value={y}>{y} 年</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">月份</label>
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))}
            className="px-2 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm">
            <option value={0}>全部月份</option>
            {MONTHS.map((m) => <option key={m} value={m}>{m}月</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">標的</label>
          <select value={codeFilter} onChange={(e) => setCodeFilter(e.target.value)}
            className="px-2 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm">
            <option value="">全部</option>
            {filterOptions.map((item) => (
              <option key={item.code} value={item.code}>
                {item.code} · {item.displayName} ({item.kind === "etf" ? "ETF" : "股票"})
              </option>
            ))}
          </select>
        </div>
        <button onClick={() => void load()}
          className="px-3 py-1.5 rounded-md bg-emerald-600 text-white text-sm hover:bg-emerald-700">
          重新查詢
        </button>
        <a
          href={TWSE_DIVIDEND_LIST_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm hover:bg-slate-100 dark:hover:bg-slate-700"
        >
          🔗 前往官方核對
        </a>
      </section>

      {error && (
        <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/40 px-3 py-2 rounded-md">
          ⚠️ {error}
        </div>
      )}

      {/* Event list */}
      {loading ? (
        <div className="text-center text-slate-500 py-10">載入中…</div>
      ) : events.length === 0 ? (
        <div className="text-center text-slate-400 py-10">此月份尚無配息事件</div>
      ) : (
        <ul className="space-y-3">
          {events.map((ev) => (
            <EventCard
              key={ev.eventKey}
              ev={ev}
              expanded={!!expanded[ev.eventKey]}
              onToggle={() => toggleExpand(ev.eventKey)}
              onChanged={onUpdateAfterUnlock}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function EventCard({
  ev, expanded, onToggle, onChanged,
}: {
  ev: CanonicalEventDTO;
  expanded: boolean;
  onToggle: () => void;
  onChanged: () => void;
}) {
  return (
    <li className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 overflow-hidden">
      <div
        className="px-4 py-3 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/40"
        onClick={onToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="font-mono font-semibold">{ev.code}</span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              除息日 {formatDate(ev.exDate)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={ev.status} manualLocked={ev.manualLocked} size="sm" />
            <span className="text-slate-400">{expanded ? "▾" : "▸"}</span>
          </div>
        </div>
        <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <Field label="發放日" value={formatDate(ev.payDate)} />
          <Field label="每單位配息" value={ev.dividendPerUnit ? `$${formatAmount(ev.dividendPerUnit)}` : "待公告"} />
          <Field label="基準日" value={formatDate(ev.baseDate)} />
          <Field label="覆寫股數" value={ev.eligibleSharesOverride != null ? formatInt(ev.eligibleSharesOverride) : "—"} />
        </div>
      </div>

      {expanded && (
        <div className="border-t border-slate-100 dark:border-slate-700 px-4 py-3 space-y-3">
          <ObservationsList observations={ev.observations ?? []} />
          <ManualVerifyForm eventKey={ev.eventKey} ev={ev} onChanged={onChanged} />
          <UnlockButton eventKey={ev.eventKey} locked={ev.manualLocked} onChanged={onChanged} />
          <QuickPasteArea eventKey={ev.eventKey} onChanged={onChanged} />
        </div>
      )}
    </li>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-slate-400">{label}</div>
      <div className="font-mono text-slate-700 dark:text-slate-200">{value}</div>
    </div>
  );
}

function ObservationsList({ observations }: { observations: SourceObservationDTO[] }) {
  if (observations.length === 0) {
    return <p className="text-xs text-slate-400">尚無觀測資料。</p>;
  }
  const sorted = [...observations].sort((a, b) => b.sourcePriority - a.sourcePriority);
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase text-slate-500 mb-1">觀測來源（依優先級排序）</h4>
      <ul className="space-y-1.5">
        {sorted.map((o, i) => (
          <li
            key={`${o.sourceKind}-${i}`}
            className="text-xs bg-slate-50 dark:bg-slate-900/40 rounded-md px-2 py-1.5 border border-slate-100 dark:border-slate-700"
          >
            <div className="flex items-center justify-between">
              <span className="font-medium">
                {SOURCE_LABEL[o.sourceKind] ?? o.sourceKind}
                <span className="ml-2 text-[10px] text-slate-400">優先級 {o.sourcePriority}</span>
              </span>
              <span className="text-[10px] text-slate-400">{formatDateTime(o.sourceObservedAt)}</span>
            </div>
            <div className="mt-1 grid grid-cols-2 sm:grid-cols-4 gap-1 text-[11px]">
              <span>除息日：{o.exDate ? formatDate(o.exDate) : "—"}</span>
              <span>發放日：{o.payDate ? formatDate(o.payDate) : "—"}</span>
              <span>配息：{o.dividendPerUnit ? `$${formatAmount(o.dividendPerUnit)}` : "—"}</span>
              <span>來源 URL：
                {o.sourceUrl
                  ? <a href={o.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 underline">開啟</a>
                  : "—"}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ManualVerifyForm({
  eventKey, ev, onChanged,
}: {
  eventKey: string;
  ev: CanonicalEventDTO;
  onChanged: () => void;
}) {
  const [payDate, setPayDate] = useState<string>(ev.payDate ?? "");
  const [amount, setAmount] = useState<string>(ev.dividendPerUnit ?? "");
  const [shares, setShares] = useState<string>(
    ev.eligibleSharesOverride != null ? String(ev.eligibleSharesOverride) : "",
  );
  const [note, setNote] = useState<string>(ev.manualNote ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setMsg(null);
    setErr(null);
    try {
      const payload: ManualVerifyPayload = {
        eventKey,
        payDate: payDate.trim() || null,
        dividendPerUnit: amount.trim() || null,
        eligibleShares: shares.trim() === "" ? null : Number(shares.trim().replace(/,/g, "")),
        note: note.trim() || null,
      };
      await api.manualVerify(payload);
      setMsg("✅ 人工覆核已儲存，事件已鎖定。");
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "覆核失敗");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-900/40 rounded-md p-3">
      <h4 className="text-xs font-semibold text-blue-700 dark:text-blue-300 mb-2">
        📝 人工覆核（填寫後該事件將被鎖定，自動同步不會覆寫）
      </h4>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <label className="block">
          <span className="text-slate-600 dark:text-slate-400">發放日</span>
          <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)}
            className="mt-0.5 w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900" />
        </label>
        <label className="block">
          <span className="text-slate-600 dark:text-slate-400">每單位配息 (元)</span>
          <input type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="例如 1.35"
            className="mt-0.5 w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 font-mono" />
        </label>
        <label className="block">
          <span className="text-slate-600 dark:text-slate-400">覆寫股數</span>
          <input type="text" inputMode="numeric" value={shares} onChange={(e) => setShares(e.target.value)} placeholder="留空則不覆寫"
            className="mt-0.5 w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 font-mono" />
        </label>
        <label className="block">
          <span className="text-slate-600 dark:text-slate-400">備註</span>
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="選填"
            className="mt-0.5 w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900" />
        </label>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => { void submit(); }}
          disabled={submitting}
          className="px-3 py-1.5 rounded bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          鎖定覆核
        </button>
        {msg && <span className="text-xs text-emerald-600 dark:text-emerald-400">{msg}</span>}
        {err && <span className="text-xs text-red-600 dark:text-red-400">{err}</span>}
      </div>
    </div>
  );
}

function UnlockButton({
  eventKey, locked, onChanged,
}: {
  eventKey: string;
  locked: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const unlock = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      await api.unlockEvent(eventKey);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "解鎖失敗");
    } finally {
      setBusy(false);
    }
  };
  if (!locked) return null;
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => { void unlock(); }}
        disabled={busy}
        className="px-3 py-1.5 rounded border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 text-xs font-medium hover:bg-amber-50 dark:hover:bg-amber-900/20 disabled:opacity-50"
      >
        🔓 解除鎖定
      </button>
      {err && <span className="text-xs text-red-600 dark:text-red-400">{err}</span>}
    </div>
  );
}

function QuickPasteArea({
  eventKey, onChanged,
}: {
  eventKey: string;
  onChanged: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Parse common TWSE dividend list row formats:
  // Accepted patterns:
  //   "0056 2024-08-15 2024-08-16 1.35"
  //   "0056,2024/08/15,1.35"
  //   lines with code, payDate, amount possibly in some order
  function parsePaste(input: string): { payDate?: string; dividendPerUnit?: string; code?: string } {
    const lines = input.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return {};
    const first = lines[0] ?? '';
    // Find a date (YYYY-MM-DD or YYYY/MM/DD)
    const dateRe = /(\d{4}[-/]\d{1,2}[-/]\d{1,2})/;
    const dateMatch = dateRe.exec(first);
    // Find an amount (decimal number)
    // Try to find a code: 4-5 digits
    const codeRe = /\b(\d{4,5})\b/;
    const codeMatch = codeRe.exec(first);
    // amount: pick the decimal that is not part of the date; use the last one
    const amounts = first.match(/(\d+\.\d{1,6})/g);
    const out: { payDate?: string; dividendPerUnit?: string; code?: string } = {};
    if (dateMatch?.[1]) out.payDate = dateMatch[1].replaceAll("/", "-");
    if (amounts?.length) out.dividendPerUnit = amounts[amounts.length - 1] ?? '';
    if (codeMatch?.[1]) out.code = codeMatch[1];
    return out;
  }

  const apply = async () => {
    if (busy || !text.trim()) return;
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const parsed = parsePaste(text);
      await api.manualVerify({
        eventKey,
        payDate: parsed.payDate ?? null,
        dividendPerUnit: parsed.dividendPerUnit ?? null,
      });
      setText("");
      setMsg("✅ 已從貼上內容填入並完成覆核。");
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "貼上解析或覆核失敗");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-md p-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-slate-600 dark:text-slate-300">📋 快速貼上</h4>
        <a
          href={TWSE_DIVIDEND_LIST_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] text-blue-600 dark:text-blue-400 underline"
        >
          前往官方核對 ↗
        </a>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="貼上官方網頁的配息資料（例如：0056 2024/08/15 2024/08/16 1.35）"
        rows={3}
        className="mt-2 w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs font-mono"
      />
      <button
        type="button"
        onClick={() => { void apply(); }}
        disabled={busy || !text.trim()}
        className="mt-2 px-3 py-1.5 rounded bg-slate-700 dark:bg-slate-200 text-white dark:text-slate-900 text-xs font-medium hover:opacity-90 disabled:opacity-50"
      >
        解析並覆核
      </button>
      {msg && <span className="ml-2 text-xs text-emerald-600 dark:text-emerald-400">{msg}</span>}
      {err && <span className="ml-2 text-xs text-red-600 dark:text-red-400">{err}</span>}
    </div>
  );
}

export default DividendsPage;
