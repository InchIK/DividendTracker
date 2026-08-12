import { getCurrentPeriodInTaipei, yearMonthPrefix } from './date';

export interface PeriodFilter {
  prefix: string | null;
  period: { year: number; month: number | null; day?: number } | null;
}

export class PeriodFilterError extends Error {}

function parseYear(value: string | undefined): number | null {
  if (value === undefined) return null;
  if (!/^\d{4}$/.test(value)) throw new PeriodFilterError('年度格式錯誤');
  const year = Number(value);
  if (year < 1912 || year > 9999) throw new PeriodFilterError('年度超出範圍');
  return year;
}

function parseMonth(value: string | undefined): number | null {
  if (value === undefined) return null;
  if (!/^\d{1,2}$/.test(value)) throw new PeriodFilterError('月份格式錯誤');
  const month = Number(value);
  if (month < 1 || month > 12) throw new PeriodFilterError('月份必須介於 1 到 12');
  return month;
}

function parseDay(value: string | undefined): number | null {
  if (value === undefined) return null;
  if (!/^\d{1,2}$/.test(value)) throw new PeriodFilterError('日期格式錯誤');
  const day = Number(value);
  if (day < 1 || day > 31) throw new PeriodFilterError('日期必須介於 1 到 31');
  return day;
}

/**
 * Query contract:
 * - year + month: selected month
 * - year + month + day: selected pay date
 * - year only: all months in selected year
 * - neither: current Taipei month when defaultToCurrent=true; otherwise all time
 * - month only: rejected because its meaning is ambiguous
 */
export function parsePeriodFilter(
  yearValue: string | undefined,
  monthValue: string | undefined,
  defaultToCurrent: boolean,
  dayValue?: string,
): PeriodFilter {
  const year = parseYear(yearValue);
  const month = parseMonth(monthValue);
  const day = parseDay(dayValue);

  if (year === null && (month !== null || day !== null)) {
    throw new PeriodFilterError('指定月份時必須同時指定年度');
  }
  if (day !== null && month === null) {
    throw new PeriodFilterError('指定日期時必須同時指定年度與月份');
  }

  if (year !== null && month !== null && day !== null) {
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const parsed = new Date(`${iso}T00:00:00Z`);
    if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() + 1 !== month || parsed.getUTCDate() !== day) {
      throw new PeriodFilterError('日期不存在');
    }
    return {
      prefix: iso,
      period: { year, month, day },
    };
  }

  if (year !== null && month !== null) {
    return {
      prefix: yearMonthPrefix(year, month),
      period: { year, month },
    };
  }

  if (year !== null) {
    return {
      prefix: `${year}-`,
      period: { year, month: null },
    };
  }

  if (defaultToCurrent) {
    const current = getCurrentPeriodInTaipei();
    return {
      prefix: yearMonthPrefix(current.year, current.month),
      period: current,
    };
  }

  return { prefix: null, period: null };
}
