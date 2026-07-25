import { describe, expect, it } from "vitest";
import { breachedCapRows, capRowUtil, isCapBreached } from "@/lib/risk/capBreach";
import type { CapRow } from "@/lib/risk/analytics";

const row = (over: Partial<CapRow>): CapRow => ({
  key: "X",
  weight: 0.1,
  cap: 0.35,
  utilisation: 0.1 / 0.35,
  breached: false,
  ...over,
});

describe("capRowUtil", () => {
  it("prefers the persisted utilisation", () => {
    expect(capRowUtil(row({ utilisation: 0.8 }))).toBe(0.8);
  });

  it("falls back to weight / cap", () => {
    expect(capRowUtil(row({ utilisation: NaN, weight: 0.35, cap: 0.35 }))).toBeCloseTo(1);
  });

  it("returns null when neither is usable", () => {
    expect(capRowUtil(row({ utilisation: NaN, weight: NaN, cap: 0 }))).toBeNull();
  });
});

describe("isCapBreached", () => {
  it("does NOT flag a group resting exactly on its cap with float dust", () => {
    // The production case: US geo weight 0.35000000000000003 vs 0.35 cap.
    const dust: CapRow = row({
      key: "US",
      weight: 0.35000000000000003,
      cap: 0.35,
      utilisation: 1.0000000000000002,
    });
    expect(isCapBreached(dust)).toBe(false);
  });

  it("ignores a stale persisted breached=true flag when utilisation is within tolerance", () => {
    const stale: CapRow = row({
      weight: 0.35,
      cap: 0.35,
      utilisation: 1,
      breached: true,
    });
    expect(isCapBreached(stale)).toBe(false);
  });

  it("flags a genuine breach (one basis point over is 10^7 × the tolerance)", () => {
    expect(isCapBreached(row({ utilisation: 1.0001 }))).toBe(true);
  });

  it("does not flag a null utilisation", () => {
    expect(isCapBreached(row({ utilisation: NaN, weight: NaN, cap: 0 }))).toBe(false);
  });
});

describe("breachedCapRows", () => {
  it("returns [] for null / empty data", () => {
    expect(breachedCapRows(null)).toEqual([]);
    expect(breachedCapRows({ single_name: [], sector: [], geo: [] })).toEqual([]);
  });

  it("collects genuine breaches across all three groups and drops float dust", () => {
    const breached = breachedCapRows({
      single_name: [row({ key: "NVDA", utilisation: 1.2 })],
      sector: [row({ key: "Tech", utilisation: 0.9 })],
      geo: [row({ key: "US", weight: 0.35000000000000003, cap: 0.35, utilisation: 1.0000000000000002 })],
    });
    expect(breached.map((r) => r.key)).toEqual(["NVDA"]);
  });
});
