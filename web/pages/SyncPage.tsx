import { useCallback, useEffect, useState } from "react";
import {
  api,
  type SyncRunDTO,
  type SourcesStatusResponse,
  type SyncScheduleDTO,
  type FinmindTokenStatusDTO,
} from "@/api/client";
import { formatDateTime } from "@/lib/format";
import { FreshnessCard } from "@/components/FreshnessCard";

const STATUS_CLASS: Record<SyncRunDTO["status"], string> = {
  running: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  success: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  partial: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  failed: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

const STATUS_LABEL: Record<SyncRunDTO["status"], string> = {
  running: "執行中",
  success: "成功",
  partial: "部分",
  failed: "失敗",
};

const FINMIND_TOKEN_STATUS_LABEL: Record<FinmindTokenStatusDTO["source"], string> = {
  database: "已由此頁加密儲存",
  environment: "已由 Cloudflare Secret 設定",
  none: "未設定（使用匿名額度）",
};

export function SyncPage({ canManageSettings }: { canManageSettings: boolean }): React.JSX.Element {
  const [runs, setRuns] = useState<SyncRunDTO[]>([]);
  const [sources, setSources] = useState<SourcesStatusResponse | null>(null);
  const [schedule, setSchedule] = useState<SyncScheduleDTO | null>(null);
  const [scheduleInput, setScheduleInput] = useState("13:35");
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleMsg, setScheduleMsg] = useState<string | null>(null);
  const [finmindTokenStatus, setFinmindTokenStatus] = useState<FinmindTokenStatusDTO | null>(null);
  const [finmindTokenInput, setFinmindTokenInput] = useState("");
  const [finmindTokenSaving, setFinmindTokenSaving] = useState(false);
  const [finmindTokenError, setFinmindTokenError] = useState<string | null>(null);
  const [finmindTokenMsg, setFinmindTokenMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setFinmindTokenError(null);
    try {
      const tokenPromise = canManageSettings
        ? api.getFinmindTokenStatus().catch((tokenError: unknown) => {
          setFinmindTokenStatus(null);
          setFinmindTokenError(tokenError instanceof Error ? tokenError.message : "載入 FinMind API Token 設定失敗");
          return null;
        })
        : Promise.resolve(null);
      const [r, s, tokenStatus] = await Promise.all([
        api.getSyncRuns(50).catch(() => ({ items: [] })),
        api.getSourcesStatus().catch(() => null),
        tokenPromise,
      ]);
      setRuns(r.items ?? []);
      setSources(s);
      setFinmindTokenStatus(canManageSettings ? tokenStatus : null);
      try {
        const configuredSchedule = await api.getSyncSettings();
        setSchedule(configuredSchedule);
        setScheduleInput(configuredSchedule.dailyTime);
      } catch (scheduleError) {
        setSchedule(null);
        setError(scheduleError instanceof Error ? scheduleError.message : "載入自動同步時間失敗");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "載入同步紀錄失敗");
    } finally {
      setLoading(false);
    }
  }, [canManageSettings]);

  useEffect(() => { void load(); }, [load]);

  const triggerSync = async () => {
    if (syncing) return; // prevent double-click
    setSyncing(true);
    setSyncMsg(null);
    try {
      await api.triggerSync();
      setSyncMsg("✅ 同步已觸發，請稍候再重新整理。");
      // Refresh after a short delay so the new run appears
      setTimeout(() => { void load(); }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "觸發同步失敗");
    } finally {
      setSyncing(false);
    }
  };

  const saveSchedule = async () => {
    if (!canManageSettings || scheduleSaving) return;
    setScheduleSaving(true);
    setScheduleMsg(null);
    setError(null);
    try {
      const updated = await api.updateSyncSettings(scheduleInput);
      setSchedule(updated);
      setScheduleInput(updated.dailyTime);
      setScheduleMsg("自動同步時間已儲存。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "無法儲存自動同步時間。");
    } finally {
      setScheduleSaving(false);
    }
  };

  const saveFinmindToken = async () => {
    if (!canManageSettings || finmindTokenSaving || finmindTokenInput.trim().length === 0) return;
    setFinmindTokenSaving(true);
    setFinmindTokenError(null);
    setFinmindTokenMsg(null);
    try {
      const updated = await api.updateFinmindToken(finmindTokenInput.trim());
      setFinmindTokenStatus(updated);
      setFinmindTokenInput("");
      setFinmindTokenMsg("Token 已加密儲存，後續同步會使用此設定；如要驗證可按「立即同步」。");
    } catch (err) {
      setFinmindTokenError(err instanceof Error ? err.message : "無法儲存 FinMind API Token。");
    } finally {
      setFinmindTokenSaving(false);
    }
  };

  const deleteFinmindToken = async () => {
    if (!canManageSettings || finmindTokenSaving || finmindTokenStatus?.source !== "database") return;
    if (!window.confirm("確定要移除此頁設定嗎？")) return;
    setFinmindTokenSaving(true);
    setFinmindTokenError(null);
    setFinmindTokenMsg(null);
    try {
      const updated = await api.deleteFinmindToken();
      setFinmindTokenStatus(updated);
      setFinmindTokenMsg(
        updated.source === "environment"
          ? "已移除此頁設定，後續同步會使用 Cloudflare Secret。"
          : "已移除此頁設定，後續同步會使用匿名額度。",
      );
    } catch (err) {
      setFinmindTokenError(err instanceof Error ? err.message : "無法移除 FinMind API Token 設定。");
    } finally {
      setFinmindTokenSaving(false);
    }
  };

  const toggleExpand = (id: number) => setExpanded((p) => ({ ...p, [id]: !p[id] }));

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">資料同步</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            觸發同步、檢視最近 50 次執行紀錄與資料來源狀態。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => { void triggerSync(); }}
            disabled={syncing}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {syncing && <Spinner />}
            {syncing ? "同步中…" : "🔄 立即同步"}
          </button>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm"
          >
            重新整理
          </button>
        </div>
      </header>

      {syncMsg && (
        <div className="text-sm text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-900/40 px-3 py-2 rounded-md">
          {syncMsg}
        </div>
      )}
      {error && (
        <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/40 px-3 py-2 rounded-md">
          ⚠️ {error}
        </div>
      )}

      <section
        aria-labelledby="sync-schedule-title"
        className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 p-4 shadow-sm"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 id="sync-schedule-title" className="text-lg font-semibold text-slate-800 dark:text-slate-100">
              自動同步時間
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              每日依台北時間執行同步；行情資料仍會在每個整點更新。
            </p>
          </div>
          <div className="flex items-end gap-2">
            <div>
              <label htmlFor="daily-sync-time" className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                Asia/Taipei
              </label>
              <input
                id="daily-sync-time"
                type="time"
                value={scheduleInput}
                onChange={(event) => setScheduleInput(event.target.value)}
                disabled={!canManageSettings || scheduleSaving}
                aria-describedby="daily-sync-help"
                className="mt-1 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>
            <button
              type="button"
              onClick={() => { void saveSchedule(); }}
              disabled={!canManageSettings || scheduleSaving || schedule === null && scheduleInput.length === 0}
              className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {scheduleSaving ? "儲存中…" : "儲存"}
            </button>
          </div>
        </div>
        <p id="daily-sync-help" className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          {canManageSettings ? "只有擁有者可修改此時間。" : "僅擁有者可修改自動同步時間。"}
        </p>
        {scheduleMsg && (
          <p role="status" aria-live="polite" className="mt-2 text-sm text-emerald-700 dark:text-emerald-300">
            {scheduleMsg}
          </p>
        )}
      </section>

      <section
        aria-labelledby="finmind-token-title"
        className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 p-4 shadow-sm"
      >
        <div>
          <h2 id="finmind-token-title" className="text-lg font-semibold text-slate-800 dark:text-slate-100">
            FinMind API Token
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            儲存後會以加密設定供後續同步使用；此頁不會顯示 Token 內容。
          </p>
        </div>

        {canManageSettings ? (
          <>
            <div className="mt-4 flex flex-wrap items-end gap-2">
              <div className="min-w-[16rem] flex-1">
                <label htmlFor="finmind-api-token" className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                  貼上 FinMind API Token
                </label>
                <input
                  id="finmind-api-token"
                  type="password"
                  value={finmindTokenInput}
                  onChange={(event) => setFinmindTokenInput(event.target.value)}
                  placeholder="請貼上 FinMind API Token"
                  autoComplete="new-password"
                  spellCheck={false}
                  maxLength={4096}
                  disabled={finmindTokenSaving}
                  aria-describedby="finmind-token-help"
                  className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>
              <button
                type="button"
                onClick={() => { void saveFinmindToken(); }}
                disabled={finmindTokenSaving || finmindTokenInput.trim().length === 0}
                className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {finmindTokenSaving ? "處理中…" : "儲存 Token"}
              </button>
            </div>
            <p id="finmind-token-help" className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              僅擁有者可管理；輸入框不會預填既有設定。
            </p>
            {finmindTokenStatus && (
              <p className="mt-3 text-sm text-slate-600 dark:text-slate-300" aria-live="polite">
                狀態：{FINMIND_TOKEN_STATUS_LABEL[finmindTokenStatus.source]}
              </p>
            )}
            {finmindTokenStatus?.storedTokenInvalid && (
              <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200" role="alert">
                此頁原有 Token 設定無法解密，請重新輸入；同步會使用 Cloudflare Secret（若有設定），否則使用匿名額度。
              </p>
            )}
            {finmindTokenStatus?.source === "database" && (
              <button
                type="button"
                onClick={() => { void deleteFinmindToken(); }}
                disabled={finmindTokenSaving}
                className="mt-3 rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-900/60 dark:text-red-300 dark:hover:bg-red-900/20"
              >
                移除此頁設定
              </button>
            )}
          </>
        ) : (
          <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
            FinMind API Token 僅限擁有者管理。
          </p>
        )}
        {finmindTokenError && (
          <p className="mt-3 text-sm text-red-600 dark:text-red-400" role="alert" aria-live="polite">
            ⚠️ {finmindTokenError}
          </p>
        )}
        {finmindTokenMsg && (
          <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-300" role="status" aria-live="polite">
            {finmindTokenMsg}
          </p>
        )}
      </section>

      {/* Source status */}
      <section>
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-3">資料來源狀態</h2>
        {sources && sources.sources.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {sources.sources.map((s) => (
              <FreshnessCard key={s.sourceKind} source={s} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-400">尚無來源狀態。</p>
        )}
      </section>

      {/* Sync runs */}
      <section>
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-3">
          最近同步紀錄
        </h2>
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold">#</th>
                <th className="px-3 py-2 text-left text-xs font-semibold">觸發</th>
                <th className="px-3 py-2 text-left text-xs font-semibold">開始</th>
                <th className="px-3 py-2 text-left text-xs font-semibold">完成</th>
                <th className="px-3 py-2 text-left text-xs font-semibold">狀態</th>
                <th className="px-3 py-2 text-right text-xs font-semibold">對應</th>
                <th className="px-3 py-2 text-right text-xs font-semibold">預告</th>
                <th className="px-3 py-2 text-right text-xs font-semibold">配息</th>
                <th className="px-3 py-2 text-right text-xs font-semibold">套用</th>
                <th className="px-3 py-2 text-right text-xs font-semibold">變更</th>
                <th className="px-3 py-2 text-center text-xs font-semibold">詳情</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {loading ? (
                <tr><td colSpan={11} className="text-center py-8 text-slate-400">載入中…</td></tr>
              ) : runs.length === 0 ? (
                <tr><td colSpan={11} className="text-center py-8 text-slate-400">尚無同步紀錄</td></tr>
              ) : (
                runs.map((r) => (
                  <>
                    <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                      <td className="px-3 py-2 font-mono">{r.id}</td>
                      <td className="px-3 py-2 text-xs">{r.triggerKind}</td>
                      <td className="px-3 py-2 text-xs font-mono">{formatDateTime(r.startedAt)}</td>
                      <td className="px-3 py-2 text-xs font-mono">{r.finishedAt ? formatDateTime(r.finishedAt) : "—"}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STATUS_CLASS[r.status]}`}>
                          {STATUS_LABEL[r.status]}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{r.mappingRowsRead.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right font-mono">{r.scheduleRowsRead.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right font-mono">{r.dividendRowsRead.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right font-mono">{r.observationsApplied.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right font-mono">{r.eventsChanged.toLocaleString()}</td>
                      <td className="px-3 py-2 text-center">
                        <button
                          type="button"
                          onClick={() => toggleExpand(r.id)}
                          className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          {expanded[r.id] ? "收起" : "展開"}
                        </button>
                      </td>
                    </tr>
                    {expanded[r.id] && (
                      <tr key={`${r.id}-detail`}>
                        <td colSpan={11} className="px-4 py-3 bg-slate-50 dark:bg-slate-900/40 text-xs">
                          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                            <div><dt className="text-slate-400">最新來源日期</dt><dd className="font-mono">{r.newestSourceDate ?? "—"}</dd></div>
                            <div><dt className="text-slate-400">錯誤代碼</dt><dd className="font-mono">{r.errorCode ?? "—"}</dd></div>
                            <div><dt className="text-slate-400">錯誤訊息</dt><dd className="break-words">{r.errorMessage ?? "—"}</dd></div>
                          </dl>
                        </td>
                      </tr>
                    )}
                  </>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
    </svg>
  );
}

export default SyncPage;
