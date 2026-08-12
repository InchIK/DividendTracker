import type { SourceStatusDTO } from "@/api/client";
import { formatDateTime, timeAgo } from "@/lib/format";

const STATUS_CLASS: Record<SourceStatusDTO["status"], { label: string; cls: string; dot: string }> = {
  never: { label: "從未", cls: "text-zinc-500 dark:text-zinc-400", dot: "bg-zinc-400" },
  ok: { label: "正常", cls: "text-emerald-600 dark:text-emerald-400", dot: "bg-emerald-500" },
  stale: { label: "過期", cls: "text-amber-600 dark:text-amber-400", dot: "bg-amber-500" },
  error: { label: "錯誤", cls: "text-red-600 dark:text-red-400", dot: "bg-red-500" },
};

export function FreshnessCard({ source }: { source: SourceStatusDTO }) {
  const meta = STATUS_CLASS[source.status] ?? STATUS_CLASS.never;
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
            {source.sourceLabel}
          </h3>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 break-all">
            {source.sourceKind}
          </p>
        </div>
        <span className={`inline-flex items-center gap-1 text-xs font-medium ${meta.cls}`}>
          <span className={`inline-block w-2 h-2 rounded-full ${meta.dot}`} />
          {meta.label}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
        <div>
          <dt className="text-slate-500 dark:text-slate-400">最近嘗試</dt>
          <dd className="font-mono text-slate-700 dark:text-slate-200">
            {formatDateTime(source.lastAttemptAt)}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500 dark:text-slate-400">最近成功</dt>
          <dd className="font-mono text-slate-700 dark:text-slate-200">
            {source.lastSuccessAt ? timeAgo(source.lastSuccessAt) : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500 dark:text-slate-400">來源最新日期</dt>
          <dd className="font-mono text-slate-700 dark:text-slate-200">
            {source.newestSourceDate ?? "—"}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500 dark:text-slate-400">HTTP</dt>
          <dd className="font-mono text-slate-700 dark:text-slate-200">
            {source.lastHttpStatus ?? "—"}
          </dd>
        </div>
      </dl>

      {source.errorMessage ? (
        <p className="mt-3 text-xs text-red-600 dark:text-red-400 break-words">
          ⚠️ {source.errorMessage}
        </p>
      ) : null}
    </div>
  );
}

export default FreshnessCard;