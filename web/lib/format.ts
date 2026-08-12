/**
 * Shared small UI utilities for DividendTracker.
 */

/** Format micros integer into a localized 元 string (e.g. "1,234.50"). */
export function formatMicrosToAmount(micros: number | null | undefined): string {
  if (micros === null || micros === undefined) return "—";
  const yuan = micros / 1_000_000;
  return yuan.toLocaleString("zh-Hant", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  });
}

/** Format a decimal string (元) for display with commas. */
export function formatAmount(amount: string | null | undefined): string {
  if (!amount) return "—";
  const n = Number(amount);
  if (Number.isNaN(n)) return amount;
  return n.toLocaleString("zh-Hant", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  });
}

/** Format an ISO date string (YYYY-MM-DD...) into YYYY/MM/DD for zh-Hant. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const datePart = iso.slice(0, 10); // YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return iso;
  return datePart.replaceAll("-", "/");
}

/** Format an ISO timestamp into YYYY/MM/DD HH:MM (Taipei). */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const opts: Intl.DateTimeFormatOptions = {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Taipei",
    };
    return new Intl.DateTimeFormat("zh-Hant", opts).format(d).replace(/\//g, "/");
  } catch {
    return iso;
  }
}

/** Relative-time label, e.g. "3 分鐘前". */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "從未";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const diff = Date.now() - d.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "剛剛";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分鐘前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小時前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} 天前`;
  return formatDateTime(iso);
}

/** Parse a number input that may contain commas. Returns NaN if invalid. */
export function parseCommaNumber(text: string): number {
  const cleaned = text.trim().replace(/,/g, "");
  if (cleaned === "") return 0;
  return Number(cleaned);
}

/** Format an integer with thousands separators. */
export function formatInt(n: number | string | null | undefined): string {
  if (n === null || n === undefined) return "—";
  const num = typeof n === "string" ? Number(n) : n;
  if (Number.isNaN(num)) return String(n);
  return num.toLocaleString("zh-Hant");
}
