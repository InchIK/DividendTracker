import { formatAmount } from './format';

/** Compact a Lock Screen total using English K/M/B/T suffixes. */
export function compactLockScreenYuan(value: string | null | undefined): string {
  if (!value) return '待公告';
  const amount = Number(value.replace(/,/g, ''));
  if (!Number.isFinite(amount)) return '待公告';
  const absolute = Math.abs(amount);
  const units = [
    { threshold: 1, suffix: '' },
    { threshold: 1e3, suffix: 'K' },
    { threshold: 1e6, suffix: 'M' },
    { threshold: 1e9, suffix: 'B' },
    { threshold: 1e12, suffix: 'T' },
  ];
  let unitIndex = 0;
  while (unitIndex < units.length - 1 && absolute >= (units[unitIndex + 1]?.threshold ?? Number.POSITIVE_INFINITY)) {
    unitIndex += 1;
  }
  if (unitIndex === 0) return `${formatAmount(value)}元`;

  let unit = units[unitIndex];
  let compact = Math.round((amount / unit.threshold) * 10) / 10;
  if (Math.abs(compact) >= 1000 && unitIndex < units.length - 1) {
    unitIndex += 1;
    unit = units[unitIndex];
    compact = Math.round((amount / unit.threshold) * 10) / 10;
  }
  return `${compact.toLocaleString('en-US', { maximumFractionDigits: 1 })}${unit.suffix}元`;
}
