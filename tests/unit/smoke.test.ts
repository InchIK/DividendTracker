import { describe, expect, it } from "vitest";

import { formatMicros, parseDecimalToMicros } from "../../worker/domain/money";

describe("money utilities", () => {
  it("preserves a six-decimal dividend amount without floating-point rounding", () => {
    const micros = parseDecimalToMicros("1.234567");

    expect(micros).toBe(1_234_567n);
    expect(formatMicros(micros ?? 0n)).toBe("1.234567");
  });
});
