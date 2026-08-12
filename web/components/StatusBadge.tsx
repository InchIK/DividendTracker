import type { EventStatus } from "@/api/client";

const STATUS_META: Record<
  EventStatus,
  { label: string; className: string; dot: string }
> = {
  schedule_only: {
    label: "僅預告",
    className: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    dot: "bg-slate-400",
  },
  pending_amount: {
    label: "待公告金額",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
    dot: "bg-amber-500",
  },
  announced: {
    label: "已公告",
    className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
    dot: "bg-emerald-500",
  },
  verified: {
    label: "人工覆核",
    className: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
    dot: "bg-blue-500",
  },
  paid: {
    label: "已發放",
    className: "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300",
    dot: "bg-teal-500",
  },
  cancelled: {
    label: "已取消",
    className: "bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-400",
    dot: "bg-zinc-500",
  },
  conflict: {
    label: "衝突",
    className: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
    dot: "bg-red-500",
  },
};

export function StatusBadge({
  status,
  manualLocked,
  size = "md",
}: {
  status: EventStatus;
  manualLocked?: boolean;
  size?: "sm" | "md";
}) {
  const meta = STATUS_META[status] ?? STATUS_META.schedule_only;
  const pad = size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium ${meta.className} ${pad}`}
      title={manualLocked ? `${meta.label}（已鎖定）` : meta.label}
    >
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
      {manualLocked ? " 🔒" : ""}
    </span>
  );
}

export default StatusBadge;