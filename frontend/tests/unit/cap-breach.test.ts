import { describe, expect, it } from "vitest";
import {
  breachedCapRows,
  capCoverage,
  capRowUtil,
  isCapBreached,
} from "@/lib/risk/capBreach";
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

// ── capCoverage (ADR-0185) ────────────────────────────────────────────────────
// A cap binds only on weight it can see. Sector/geo rows come from SECTOR_MAP and
// GEO_MAP; a held ticker in neither map sits in no group, and the bars look
// identical whether they describe the whole book or two thirds of it.
describe("capCoverage", () => {
  const row = (key: string, weight: number) => ({
    key,
    weight,
    cap: 0.35,
    utilisation: weight / 0.35,
    breached: false,
  });

  it("reports each grouping's share of gross and passes only when all three reach it", () => {
    const cov = capCoverage(
      {
        single_name: [row("JD", 0.5), row("GLD", 0.2874)],
        sector: [row("China", 0.5), row("Metals", 0.2874)],
        geo: [row("US", 0.5), row("Global", 0.2874)],
      } as never,
      0.7874,
    );
    expect(cov.gross).toBeCloseTo(0.7874, 6);
    expect(cov.groups.map((g) => g.id)).toEqual(["single_name", "sector", "geo"]);
    for (const g of cov.groups) expect(g.share).toBeCloseTo(1, 6);
    expect(cov.complete).toBe(true);
  });

  it("does NOT pass when one grouping sees less of the book than the others", () => {
    // The live failure this exists for: a ticker absent from SECTOR_MAP is in no
    // sector group, so the sector cap cannot bind on its weight — while its
    // single-name and geography bars look perfectly healthy.
    const cov = capCoverage(
      {
        single_name: [row("JD", 0.5), row("XYZ", 0.2874)],
        sector: [row("China", 0.5)],
        geo: [row("US", 0.5), row("Global", 0.2874)],
      } as never,
      0.7874,
    );
    expect(cov.complete).toBe(false);
    expect(cov.groups.find((g) => g.id === "sector")!.share).toBeCloseTo(0.635, 3);
  });

  it("tolerates the same float dust the breach check does", () => {
    const cov = capCoverage(
      {
        single_name: [row("A", 0.35), row("B", 0.42739999999999995)],
        sector: [row("S", 0.7774000000000001)],
        geo: [row("G", 0.7774)],
      } as never,
      0.7774,
    );
    expect(cov.complete).toBe(true);
  });

  it("refuses to guess: an unmeasurable weight makes the whole group null, not zero", () => {
    const cov = capCoverage(
      {
        single_name: [row("A", 0.5), { key: "B", weight: null, cap: 0.2 }],
        sector: [row("S", 0.7874)],
        geo: [row("G", 0.7874)],
      } as never,
      0.7874,
    );
    expect(cov.groups.find((g) => g.id === "single_name")!.covered).toBeNull();
    expect(cov.groups.find((g) => g.id === "single_name")!.share).toBeNull();
    expect(cov.complete).toBe(false);
  });

  it("says nothing when gross is absent — a share of an unknown book is not a share", () => {
    const cov = capCoverage({ single_name: [row("A", 0.5)] } as never, null);
    expect(cov.gross).toBeNull();
    expect(cov.groups.every((g) => g.share === null)).toBe(true);
    expect(cov.complete).toBe(false);
  });
});
