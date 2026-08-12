import { describe, expect, it } from "vitest";
import { buildPriceDisplay, formatMicros } from "../../web/pages/price-model";

describe("price display model", () => {
  it("formats integer micros without unsafe Number conversion", () => {
    expect(formatMicros("9007199254740993")).toBe("9,007,199,254.740993");
    expect(formatMicros("-1250000")).toBe("-1.25");
  });

  it("calculates change with BigInt and distinguishes price states", () => {
    expect(buildPriceDisplay({
      instrumentId: "twse:0050", code: "0050", displayName: "元大台灣50",
      latestPriceMicros: "9007199254740993", previousCloseMicros: "9007199254740001",
      tradeDate: "2026-08-11", tradeTime: "13:30:00", marketState: "closed",
      status: "complete", source: "twstock_twse_mis", observedAt: "2026-08-11T05:31:00Z",
      stale: false, errorMessage: null,
    })).toMatchObject({ change: "+0.000992", state: "已收盤" });
    expect(buildPriceDisplay({
      instrumentId: "twse:0050", code: "0050", displayName: "元大台灣50",
      latestPriceMicros: null, previousCloseMicros: null, tradeDate: null, tradeTime: null,
      marketState: "unknown", status: "error", source: "twstock_twse_mis",
      observedAt: null, stale: false, errorMessage: "timeout",
    }).state).toBe("來源失敗");
  });
});