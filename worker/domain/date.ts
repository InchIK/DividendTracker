/**
 * Date parsing and formatting utilities.
 * All dates are stored as ISO YYYY-MM-DD in the database.
 * Input supports both ROC (民國) and CE (西元) formats.
 */

/** Convert a Date to ISO date string in Asia/Taipei timezone. */
export function toIsoDateInTaipei(date: Date): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(date); // en-CA produces YYYY-MM-DD
}

/** Get current year/month in Taipei timezone. */
export function getCurrentPeriodInTaipei(): { year: number; month: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
  });
  const parts = fmt.formatToParts(new Date());
  const year = Number(parts.find((p) => p.type === 'year')!.value);
  const month = Number(parts.find((p) => p.type === 'month')!.value);
  return { year, month };
}

/**
 * Parse a date string in various formats and return ISO YYYY-MM-DD.
 * Supported formats:
 *   2026-08-10, 2026/08/10, 20260810
 *   115-08-10, 115/08/10, 1150810, 115年08月10日
 * Returns null for empty string or "尚未公告".
 * Throws for invalid dates.
 */
export function parseDate(input: string): string | null {
  if (input == null) return null;
  const trimmed = String(input).trim();
  if (trimmed === '') return null;
  if (trimmed === '尚未公告' || trimmed === '待公告') return null;

  let year: number;
  let month: number;
  let day: number;

  // Format: 115年08月10日
  const rocChinese = /^(\d{2,4})年(\d{1,2})月(\d{1,2})日?$/.exec(trimmed);
  if (rocChinese) {
    year = parseInt(rocChinese[1]!, 10) + 1911;
    month = parseInt(rocChinese[2]!, 10);
    day = parseInt(rocChinese[3]!, 10);
    return validateAndReturn(year, month, day);
  }

  // Remove slashes/dashes, parse compact
  const cleaned = trimmed.replace(/[/-]/g, '');
  // Try as compact date: YYYYMMDD or YYMMDD
  const compactMatch = /^(\d{4,7})(\d{2})(\d{2})$/.exec(cleaned);
  if (compactMatch) {
    const yearPart = parseInt(compactMatch[1]!, 10);
    // If year part is < 1000, it's a ROC year
    if (yearPart < 1000) {
      year = yearPart + 1911;
    } else {
      year = yearPart;
    }
    month = parseInt(compactMatch[2]!, 10);
    day = parseInt(compactMatch[3]!, 10);
    return validateAndReturn(year, month, day);
  }

  // Try standard parsing with separators
  const sepMatch = /^(\d{2,4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(trimmed);
  if (sepMatch) {
    const yearPart = parseInt(sepMatch[1]!, 10);
    if (yearPart < 1000) {
      year = yearPart + 1911;
    } else {
      year = yearPart;
    }
    month = parseInt(sepMatch[2]!, 10);
    day = parseInt(sepMatch[3]!, 10);
    return validateAndReturn(year, month, day);
  }

  throw new Error(`無法解析日期格式: ${input}`);
}

function validateAndReturn(year: number, month: number, day: number): string {
  // Basic range checks
  if (month < 1 || month > 12) {
    throw new Error(`無效的月份: ${month}`);
  }
  if (day < 1 || day > 31) {
    throw new Error(`無效的日期: ${day}`);
  }

  // Create UTC date and verify round-trip
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const d = new Date(`${iso}T00:00:00Z`);
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() + 1 !== month ||
    d.getUTCDate() !== day
  ) {
    throw new Error(`不存在的日期: ${iso}`);
  }

  return iso;
}

/** Parse ROC compact date (e.g., 1150818 → 2026-08-18). */
export function parseRocCompactDate(input: string): string | null {
  if (input.length !== 7) return null;
  const rocYear = parseInt(input.slice(0, 3) ?? '', 10);
  const month = parseInt(input.slice(3, 5) ?? '', 10);
  const day = parseInt(input.slice(5, 7) ?? '', 10);
  if (isNaN(rocYear) || isNaN(month) || isNaN(day)) return null;
  return validateAndReturn(rocYear + 1911, month, day);
}

/** Format ISO date for display in Chinese: 2026-08-10 → "2026年8月10日" */
export function formatDisplayDate(iso: string | null): string {
  if (!iso) return '待公告';
  const parts = iso.split('-');
  const y = parts[0] ?? '0000';
  const m = parts[1] ?? '01';
  const d = parts[2] ?? '01';
  return `${y}年${parseInt(m)}月${parseInt(d)}日`;
}

/** Get the YYYY-MM prefix for a given year/month. */
export function yearMonthPrefix(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}