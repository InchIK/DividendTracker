import type { PriceDTO } from "@/api/client";

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function formatMicros(micros: string | null): string {
  if (micros === null || !/^-?\d+$/.test(micros)) return "—";
  const negative = micros.startsWith("-");
  const unsigned = negative ? micros.slice(1) : micros;
  const padded = unsigned.padStart(7, "0");
  const integer = padded.slice(0, -6).replace(/^0+(?=\d)/, "") || "0";
  const fraction = padded.slice(-6).replace(/0+$/, "");
  return `${negative ? "-" : ""}${groupThousands(integer)}${fraction ? `.${fraction}` : ""}`;
}

export interface PriceDisplay {
  latest: string;
  previousClose: string;
  change: string;
  state: string;
  updated: string;
}

export function buildPriceDisplay(price: PriceDTO | undefined): PriceDisplay {
  if (!price) return { latest: "—", previousClose: "—", change: "—", state: "尚無價格資料", updated: "—" };
  let state = "資料完整";
  if (price.status === "error") state = "來源失敗";
  else if (price.stale || price.status === "stale") state = "資料過期";
  else if (price.marketState === "halted") state = "停止交易";
  else if (price.marketState === "no_trade") state = "無成交";
  else if (price.latestPriceMicros === null) state = "尚無最新成交";
  else if (price.marketState === "closed") state = "已收盤";
  else if (price.marketState === "trading") state = "交易中";

  let change = "—";
  if (price.latestPriceMicros !== null && price.previousCloseMicros !== null) {
    const delta = BigInt(price.latestPriceMicros) - BigInt(price.previousCloseMicros);
    change = `${delta > 0n ? "+" : ""}${formatMicros(delta.toString())}`;
  }
  const updated = price.tradeDate
    ? `${price.tradeDate}${price.tradeTime ? ` ${price.tradeTime}` : ""}`
    : price.observedAt ?? "—";
  return {
    latest: formatMicros(price.latestPriceMicros),
    previousClose: formatMicros(price.previousCloseMicros),
    change,
    state,
    updated,
  };
}