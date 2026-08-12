/**
 * Money handling using integer micros.
 * 1 元 = 1,000,000 微元
 * All financial calculations use BigInt to avoid floating-point errors.
 */

/** 1 元 = 1,000,000 微元 */
export const MICROS_PER_UNIT = 1_000_000n;

/**
 * Parse a decimal string to micros (BigInt).
 * Supports up to 6 decimal places.
 * Returns null for empty string or "尚未公告".
 * Throws for invalid strings or >6 decimal places.
 *
 * Examples:
 *   "1"        → 1000000n
 *   "1.35"     → 1350000n
 *   "0.058"    → 58000n
 *   "1,234.5"  → 1234500000n
 *   ""         → null
 *   "尚未公告"  → null
 */
export function parseDecimalToMicros(value: string): bigint | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (trimmed === '') return null;
  if (trimmed === '尚未公告' || trimmed === '待公告') return null;

  // Remove thousands separators (commas)
  const cleaned = trimmed.replace(/,/g, '');

  // Validate format
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) {
    throw new Error(`無法解析金額: ${value}`);
  }

  const negative = cleaned.startsWith('-');
  const abs = negative ? cleaned.slice(1) : cleaned;

  const [intPart, decPart = ''] = abs.split('.');

  if (decPart.length > 6) {
    throw new Error(`小數位數超過 6 位: ${value}`);
  }

  // Pad decimal to exactly 6 digits
  const paddedDec = decPart.padEnd(6, '0');

  // Combine: intPart + paddedDec = micros
  const combined = intPart + paddedDec;
  const micros = BigInt(combined);

  return negative ? -micros : micros;
}

/**
 * Format micros (BigInt) to a decimal string.
 * Examples:
 *   1000000n    → "1"
 *   1350000n    → "1.35"
 *   58000n      → "0.058"
 *   0n          → "0"
 *   10057500n   → "10.0575"
 */
export function formatMicros(value: bigint): string {
  if (value === 0n) return '0';
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const str = abs.toString().padStart(7, '0'); // Ensure at least 1 integer digit + 6 decimals
  const intPart = str.slice(0, -6) || '0';
  let decPart = str.slice(-6);

  // Trim trailing zeros from decimal
  decPart = decPart.replace(/0+$/, '');

  const result = decPart ? `${intPart}.${decPart}` : intPart;
  return negative ? `-${result}` : result;
}

/**
 * Calculate total amount in micros.
 * amount_micros = eligible_shares × dividend_micros
 */
export function calculateAmount(
  eligibleShares: number,
  dividendMicros: bigint | null,
): bigint | null {
  if (dividendMicros === null) return null;
  return BigInt(eligibleShares) * dividendMicros;
}

/** Format micros with thousand separators for display: "16,057.5" */
export function formatMicrosWithCommas(value: bigint): string {
  const formatted = formatMicros(value);
  const parts = formatted.split('.');
  const intPart = parts[0] ?? '0';
  const decPart = parts[1] ?? '';
  const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return decPart ? `${withCommas}.${decPart}` : withCommas;
}