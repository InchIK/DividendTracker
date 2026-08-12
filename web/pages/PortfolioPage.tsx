import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  type InstrumentSearchItemDTO,
  type PriceDTO,
  type WatchlistItemDTO,
  type WatchlistKind,
  type WatchlistMarket,
} from "@/api/client";
import { formatInt } from "@/lib/format";
import {
  buildWatchlistPatch,
  parseSharesInput,
  validateWatchlistDraft,
  watchlistStatusLabel,
  type EditableWatchlistItem,
  type WatchlistDraft,
  type WatchlistDraftErrors,
} from "./watchlist-model";
import { buildPriceDisplay } from "./price-model";

const EMPTY_DRAFT: WatchlistDraft = {
  market: "twse",
  code: "",
  kind: "etf",
  displayName: "",
  sharesText: "0",
  enabled: true,
};

function editable(item: WatchlistItemDTO): EditableWatchlistItem {
  return { ...item, sharesText: formatInt(item.shares) };
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function refreshNotice(code: string, status: "success" | "partial" | "failed" | undefined): string {
  if (status === "success") return `${code} 已加入，並已立即完成一年股利回補與最新行情更新。`;
  if (status === "partial") return `${code} 已加入；一年股利或行情僅部分更新，系統會在每日台北時間 13:35 再重試。`;
  if (status === "failed") return `${code} 已加入，但立即回補失敗；可在儀表板手動重試，不必等到 13:35。`;
  return `${code} 已加入但目前停用；啟用時會立即回補一年資料。`;
}

function formatQuoteMicros(value: string | null): string {
  if (value === null) return "尚無資料";
  try {
    const micros = BigInt(value);
    const whole = micros / 1_000_000n;
    const fraction = (micros % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
    return fraction ? `${whole}.${fraction}` : whole.toString();
  } catch {
    return "資料格式錯誤";
  }
}

export function PortfolioPage(): React.JSX.Element {
  const [rows, setRows] = useState<EditableWatchlistItem[]>([]);
  const [originals, setOriginals] = useState<WatchlistItemDTO[]>([]);
  const [draft, setDraft] = useState<WatchlistDraft>(EMPTY_DRAFT);
  const [draftErrors, setDraftErrors] = useState<WatchlistDraftErrors>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [archivingIds, setArchivingIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [prices, setPrices] = useState<Map<string, PriceDTO>>(new Map());
  const [priceError, setPriceError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<InstrumentSearchItemDTO[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selectedMetadataSource, setSelectedMetadataSource] = useState<InstrumentSearchItemDTO["metadataSource"] | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const [watchlistResult, pricesResult] = await Promise.allSettled([
        api.getWatchlist(),
        api.getPrices(),
      ]);
      if (watchlistResult.status === "rejected") throw watchlistResult.reason;
      const response = watchlistResult.value;
      setOriginals(response.items);
      setRows(response.items.map(editable));
      if (pricesResult.status === "fulfilled") {
        setPrices(new Map(pricesResult.value.items.map((item) => [item.instrumentId, item])));
        setPriceError(null);
      } else {
        setPriceError(message(pricesResult.reason, "價格資料載入失敗"));
      }
    } catch (loadError) {
      setError(message(loadError, "載入自選標的失敗"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const searchInstruments = async (): Promise<void> => {
    const query = searchQuery.trim();
    if (query.length < 2 || searching) return;
    setSearching(true);
    setSearchError(null);
    try {
      const response = await api.searchInstruments(query);
      setSearchResults(response.items);
      if (response.items.length === 0) setSearchError("查無符合的上市、上櫃股票或 ETF。");
      else if (response.partial) setSearchError("部分官方來源暫時無法使用，以下為目前可取得的結果。");
    } catch (searchFailure) {
      setSearchResults([]);
      setSearchError(message(searchFailure, "官方標的查詢失敗"));
    } finally {
      setSearching(false);
    }
  };

  const chooseInstrument = (item: InstrumentSearchItemDTO): void => {
    setDraft((current) => ({
      ...current,
      market: item.market,
      code: item.code,
      kind: item.kind,
      displayName: item.displayName,
    }));
    setSelectedMetadataSource(item.metadataSource);
    setDraftErrors({});
  };

  const dirtyIds = useMemo(() => new Set(rows.flatMap((row) => {
    const original = originals.find((item) => item.instrumentId === row.instrumentId);
    if (!original) return [];
    return Object.keys(buildWatchlistPatch(original, row)).length > 0 ? [row.instrumentId] : [];
  })), [originals, rows]);

  useEffect(() => {
    const warnBeforeLeave = (event: BeforeUnloadEvent): void => {
      if (dirtyIds.size === 0) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warnBeforeLeave);
    return () => window.removeEventListener("beforeunload", warnBeforeLeave);
  }, [dirtyIds]);

  const updateRow = (instrumentId: string, change: Partial<EditableWatchlistItem>): void => {
    setRows((current) => current.map((row) => row.instrumentId === instrumentId ? { ...row, ...change } : row));
    setNotice(null);
  };

  const createItem = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (submitting) return;
    const validation = validateWatchlistDraft(draft);
    setDraftErrors(validation);
    if (Object.keys(validation).length > 0) return;
    const shares = parseSharesInput(draft.sharesText);
    if (shares === null) return;

    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const response = await api.addWatchlistItem({
        market: draft.market,
        code: draft.code.trim().toUpperCase(),
        kind: draft.kind,
        displayName: draft.displayName.trim(),
        shares,
        enabled: draft.enabled,
        ...(selectedMetadataSource ? { metadataSource: selectedMetadataSource } : {}),
      });
      setOriginals((current) => [...current.filter((item) => item.instrumentId !== response.item.instrumentId), response.item]);
      setRows((current) => [...current.filter((item) => item.instrumentId !== response.item.instrumentId), editable(response.item)]);
      setDraft(EMPTY_DRAFT);
      setSelectedMetadataSource(null);
      setSearchQuery("");
      setSearchResults([]);
      setNotice(refreshNotice(response.item.code, response.refresh?.status));
    } catch (createError) {
      setError(message(createError, "新增自選標的失敗"));
    } finally {
      setSubmitting(false);
    }
  };

  const saveRow = async (row: EditableWatchlistItem): Promise<void> => {
    const original = originals.find((item) => item.instrumentId === row.instrumentId);
    const shares = parseSharesInput(row.sharesText);
    if (!original || shares === null || savingIds.has(row.instrumentId)) return;
    const normalized = { ...row, shares };
    const patch = buildWatchlistPatch(original, normalized);
    if (Object.keys(patch).length === 0) return;
    const enablingNow = patch.enabled === true;

    setSavingIds((current) => new Set(current).add(row.instrumentId));
    setError(null);
    setNotice(enablingNow
      ? `${row.code} 正在啟用，立即回補至少一年股利並更新昨收與今日成交…`
      : null);
    try {
      const response = await api.updateWatchlistItem(row.instrumentId, patch);
      setOriginals((current) => current.map((item) => item.instrumentId === row.instrumentId ? response.item : item));
      setRows((current) => current.map((item) => item.instrumentId === row.instrumentId ? editable(response.item) : item));
      setNotice(response.refresh
        ? refreshNotice(row.code, response.refresh.status)
        : `${row.code} 已儲存。`);
    } catch (saveError) {
      setError(message(saveError, `${row.code} 儲存失敗`));
    } finally {
      setSavingIds((current) => {
        const next = new Set(current);
        next.delete(row.instrumentId);
        return next;
      });
    }
  };

  const archiveRow = async (row: EditableWatchlistItem): Promise<void> => {
    if (archivingIds.has(row.instrumentId)) return;
    if (!window.confirm(`確定要移除 ${row.code} ${row.displayName}？\n\n將停止後續同步，但既有配息、價格與來源紀錄會保留。`)) return;
    setArchivingIds((current) => new Set(current).add(row.instrumentId));
    setError(null);
    setNotice(null);
    try {
      await api.archiveWatchlistItem(row.instrumentId);
      setOriginals((current) => current.filter((item) => item.instrumentId !== row.instrumentId));
      setRows((current) => current.filter((item) => item.instrumentId !== row.instrumentId));
      setNotice(`${row.code} 已移除並停止同步，歷史資料仍保留。`);
    } catch (archiveError) {
      setError(message(archiveError, `${row.code} 移除失敗`));
    } finally {
      setArchivingIds((current) => {
        const next = new Set(current);
        next.delete(row.instrumentId);
        return next;
      });
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">自選標的</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          可設定任一上市、上櫃股票或 ETF；新增或重新啟用時立即回補一年資料，之後每日台北時間 13:35 更新。股數可輸入千分位逗號，例如「1,234」。
        </p>
      </header>

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300">
          {error}
          <button type="button" onClick={() => setError(null)} className="ml-3 underline">關閉</button>
        </div>
      )}
      {notice && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-900/20 dark:text-emerald-300">{notice}</div>}
      {dirtyIds.size > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-300">
          有 {dirtyIds.size} 筆尚未儲存的修改。
        </div>
      )}

      <form onSubmit={(event) => { void createItem(event); }} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800/60">
        <div className="mb-4">
          <h2 className="font-semibold text-slate-800 dark:text-slate-100">新增自選標的</h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            輸入代碼或名稱查詢官方資料與當時報價，選取後再設定持有股數。
          </p>
        </div>
        <div className="mb-4 rounded-lg bg-slate-50 p-3 dark:bg-slate-900/60">
          <div className="flex gap-2">
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void searchInstruments(); } }}
              placeholder="例如 2330、0050 或台積電"
              aria-label="搜尋股票或 ETF"
              className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-900"
            />
            <button type="button" onClick={() => { void searchInstruments(); }} disabled={searching || searchQuery.trim().length < 2} className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {searching ? "查詢中…" : "查詢"}
            </button>
          </div>
          {searchError && <p role="status" className="mt-2 text-xs text-amber-700 dark:text-amber-300">{searchError}</p>}
          {searchResults.length > 0 && (
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {searchResults.map((item) => (
                <button key={item.instrumentId} type="button" onClick={() => chooseInstrument(item)} className="rounded-lg border border-slate-200 bg-white p-3 text-left hover:border-emerald-500 dark:border-slate-700 dark:bg-slate-800">
                  <div className="flex items-center justify-between gap-2">
                    <span><strong className="font-mono">{item.code}</strong> {item.displayName}</span>
                    <span className="text-xs text-slate-500">{item.market === "twse" ? "上市" : "上櫃"}・{item.kind === "etf" ? "ETF" : "股票"}</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    最新成交：{formatQuoteMicros(item.quote?.latestPriceMicros ?? null)} ・ 前收：{formatQuoteMicros(item.quote?.previousCloseMicros ?? null)}
                    {item.quote ? ` ・ ${item.quote.tradeDate ?? ""} ${item.quote.tradeTime ?? ""}` : " ・ 目前無即時報價"}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <label className="text-sm">市場
            <select value={draft.market} onChange={(event) => { setDraft({ ...draft, market: event.target.value as WatchlistMarket }); setSelectedMetadataSource(null); }} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-900">
              <option value="twse">上市</option><option value="tpex">上櫃</option>
            </select>
          </label>
          <label className="text-sm">類型
            <select value={draft.kind} onChange={(event) => { setDraft({ ...draft, kind: event.target.value as WatchlistKind }); setSelectedMetadataSource(null); }} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-900">
              <option value="stock">股票</option><option value="etf">ETF</option>
            </select>
          </label>
          <label className="text-sm">代碼
            <input value={draft.code} onChange={(event) => { setDraft({ ...draft, code: event.target.value }); setSelectedMetadataSource(null); }} placeholder="例如 2330" className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono uppercase dark:border-slate-600 dark:bg-slate-900" />
            {draftErrors.code && <span className="mt-1 block text-xs text-red-600">{draftErrors.code}</span>}
          </label>
          <label className="text-sm lg:col-span-2">名稱
            <input value={draft.displayName} onChange={(event) => { setDraft({ ...draft, displayName: event.target.value }); setSelectedMetadataSource(null); }} placeholder="例如 台積電" className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-900" />
            {draftErrors.displayName && <span className="mt-1 block text-xs text-red-600">{draftErrors.displayName}</span>}
          </label>
          <label className="text-sm">持有股數
            <input value={draft.sharesText} onChange={(event) => setDraft({ ...draft, sharesText: event.target.value })} inputMode="numeric" className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-right font-mono dark:border-slate-600 dark:bg-slate-900" />
            {draftErrors.sharesText && <span className="mt-1 block text-xs text-red-600">{draftErrors.sharesText}</span>}
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />啟用每日台北時間 13:35 同步（新增時立即回補一年）</label>
          <button type="submit" disabled={submitting} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50">{submitting ? "正在回補一年資料與行情…" : "新增並立即回補"}</button>
        </div>
        {submitting && <p role="status" className="mt-3 text-sm text-emerald-700 dark:text-emerald-300">正在從資料來源回補此標的至少一年股利，並更新昨收與今日成交；完成前請勿關閉頁面。</p>}
      </form>

      <section aria-busy={loading}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-semibold text-slate-800 dark:text-slate-100">目前自選清單</h2>
          <button type="button" onClick={() => { void load(); }} disabled={loading || savingIds.size > 0} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-800">重新整理</button>
        </div>
        {priceError && <div role="status" className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-700 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-300">價格資料載入失敗，持股仍可正常編輯。</div>}
        {loading ? (
          <div className="rounded-xl border border-slate-200 bg-white py-12 text-center text-slate-500 dark:border-slate-700 dark:bg-slate-800/60">載入中…</div>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white py-12 text-center dark:border-slate-700 dark:bg-slate-800/60">
            <p className="font-medium">尚未加入任何標的</p><p className="mt-1 text-sm text-slate-500">請使用上方表單加入第一筆股票或 ETF。</p>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {rows.map((row) => {
              const original = originals.find((item) => item.instrumentId === row.instrumentId);
              const shares = parseSharesInput(row.sharesText);
              const dirty = dirtyIds.has(row.instrumentId);
              const saving = savingIds.has(row.instrumentId);
              const archiving = archivingIds.has(row.instrumentId);
              const price = buildPriceDisplay(prices.get(row.instrumentId));
              return (
                <article key={row.instrumentId} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800/60">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div><div className="flex items-center gap-2"><span className="font-mono text-lg font-bold">{row.code}</span><span className="rounded bg-slate-100 px-2 py-0.5 text-xs dark:bg-slate-700">{row.market === "twse" ? "上市" : "上櫃"}・{row.kind === "etf" ? "ETF" : "股票"}</span></div><div className="mt-1 text-xs text-slate-500">{watchlistStatusLabel(row.status)}</div></div>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${row.enabled ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300"}`}>{row.enabled ? "同步中" : "已停用"}</span>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <label className="text-sm">名稱<input value={row.displayName} onChange={(event) => updateRow(row.instrumentId, { displayName: event.target.value })} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-900" /></label>
                    <label className="text-sm">持有股數<input value={row.sharesText} onChange={(event) => updateRow(row.instrumentId, { sharesText: event.target.value, shares: parseSharesInput(event.target.value) ?? row.shares })} inputMode="numeric" className={`mt-1 w-full rounded-md border bg-white px-3 py-2 text-right font-mono dark:bg-slate-900 ${shares === null ? "border-red-500" : "border-slate-300 dark:border-slate-600"}`} />{shares === null ? <span className="mt-1 block text-xs text-red-600">請輸入 0 以上整數，可使用千分位逗號。</span> : <span className="mt-1 block text-xs text-slate-400">{formatInt(shares)} 股</span>}</label>
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-900/60">
                    <div><dt className="text-xs text-slate-500">最新成交</dt><dd className="font-mono font-semibold">{price.latest}</dd></div>
                    <div><dt className="text-xs text-slate-500">前一交易日收盤</dt><dd className="font-mono font-semibold">{price.previousClose}</dd></div>
                    <div><dt className="text-xs text-slate-500">漲跌</dt><dd className="font-mono font-semibold">{price.change}</dd></div>
                    <div><dt className="text-xs text-slate-500">狀態</dt><dd>{price.state}</dd></div>
                    <div className="col-span-2"><dt className="text-xs text-slate-500">更新時間</dt><dd>{price.updated}</dd></div>
                  </dl>
                  <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4 dark:border-slate-700">
                    <button type="button" onClick={() => updateRow(row.instrumentId, { enabled: !row.enabled })} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-700">{row.enabled ? "停用同步" : "啟用同步"}</button>
                    <button type="button" onClick={() => { void saveRow(row); }} disabled={!dirty || shares === null || saving || archiving} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{saving ? (row.enabled && original?.enabled === false ? "啟用並回補中…" : "儲存中…") : "儲存修改"}</button>
                    <button type="button" onClick={() => { void archiveRow(row); }} disabled={saving || archiving} className="ml-auto rounded-lg px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-900/20">{archiving ? "移除中…" : "移除"}</button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

export default PortfolioPage;
