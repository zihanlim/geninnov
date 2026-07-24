import { describe, it, expect } from "vitest";
import { slopeToBps, formatSlopeBps } from "@/lib/regimeUnits";

describe("regime curve units", () => {
  it("scales percentage points to basis points", () => {
    // The live 2026-07-25 value: DGS10 4.67 − DGS2 4.31 = 0.36pp = 36bps.
    expect(slopeToBps(0.36)).toBeCloseTo(36, 6);
    expect(slopeToBps(-0.05)).toBeCloseTo(-5, 6);
  });

  it("does NOT round a +36bps curve down to 0bps — the shipped bug", () => {
    // The defect: `(0.36).toFixed(0) + "bps"` = "0bps", a flat/inverted curve
    // printed over one that is +36bps. Must scale before rounding.
    expect(formatSlopeBps(0.36)).toBe("36bps"); // not "0bps"
    expect(formatSlopeBps(0.36)).not.toBe("0bps");
  });

  it("formats a genuinely flat curve as 0bps and an inversion as negative", () => {
    expect(formatSlopeBps(0)).toBe("0bps");
    expect(formatSlopeBps(-0.18)).toBe("-18bps");
  });

  it("is null-safe", () => {
    expect(slopeToBps(null)).toBeNull();
    expect(slopeToBps(undefined)).toBeNull();
    expect(slopeToBps(NaN)).toBeNull();
    expect(formatSlopeBps(null)).toBe("—");
  });
});
