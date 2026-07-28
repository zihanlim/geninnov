// The workbench must not quietly become a second, differently-wrong book.
//
// Two properties carry most of the risk and get most of the tests:
//   1. An unscored name never acquires a signal it does not have.
//   2. The caps it checks are the mandate's, not a second copy that can drift.

import { describe, expect, it } from "vitest";
import { ENFORCED } from "@/lib/mandate";
import {
  driftFromBook,
  scratchMetrics,
  scratchNotionals,
  scratchTilts,
  type ScratchPosition,
} from "@/lib/workbench/scratch";

const pos = (o: Partial<ScratchPosition> & { asset: string }): ScratchPosition => ({
  direction: "long",
  weight: 0.1,
  tier: "held",
  edgeScore: 0.3,
  conviction: 12,
  vol: 0.02,
  sector: "Energy",
  geo: "US",
  ...o,
});

describe("exposures", () => {
  it("nets longs against shorts and grosses them together", () => {
    const m = scratchMetrics([
      pos({ asset: "A", direction: "long", weight: 0.3 }),
      pos({ asset: "B", direction: "short", weight: 0.2 }),
    ]);
    expect(m.gross).toBeCloseTo(0.5);
    expect(m.net).toBeCloseTo(0.1);
    expect(m.longWeight).toBeCloseTo(0.3);
    expect(m.shortWeight).toBeCloseTo(0.2);
  });

  it("holds the undeployed remainder as cash, never as negative cash", () => {
    expect(scratchMetrics([pos({ asset: "A", weight: 0.4 })]).cash).toBeCloseTo(0.6);
    // A book over its gross budget is leveraged. Reporting -20% cash would be a
    // second wrong way of saying the same thing.
    expect(scratchMetrics([pos({ asset: "A", weight: 1.2 })]).cash).toBe(0);
  });

  it("computes HHI on the 0-10 000 scale the backend uses", () => {
    // Five equal 20% names: 5 x 0.04 x 10 000 = 2 000.
    const five = ["A", "B", "C", "D", "E"].map((asset) => pos({ asset, weight: 0.2 }));
    expect(scratchMetrics(five).hhi).toBeCloseTo(2000);
  });

  it("signs notionals so a short reads negative", () => {
    const n = scratchNotionals(
      [pos({ asset: "A", weight: 0.1 }), pos({ asset: "B", direction: "short", weight: 0.1 })],
      100_000_000,
    );
    expect(n.A).toBeCloseTo(10_000_000);
    expect(n.B).toBeCloseTo(-10_000_000);
  });
});

describe("caps come from the mandate, not a second copy", () => {
  it("checks single name, sector, geography and gross against ENFORCED", () => {
    const m = scratchMetrics([pos({ asset: "A", weight: 0.5 })]);
    expect(m.singleName[0].cap).toBe(ENFORCED.single_name_pct.value);
    expect(m.sector[0].cap).toBe(ENFORCED.sector_pct.value);
    expect(m.geo[0].cap).toBe(ENFORCED.geo_pct.value);
    expect(m.grossCap.cap).toBe(ENFORCED.gross_exposure_pct.value);
  });

  it("names every breach", () => {
    const m = scratchMetrics([
      pos({ asset: "A", weight: 0.5, sector: "Energy", geo: "US" }),
      pos({ asset: "B", weight: 0.4, sector: "Energy", geo: "US" }),
    ]);
    expect(m.breaches).toContain("A single-name");
    expect(m.breaches).toContain("Energy sector");
    expect(m.breaches).toContain("US geography");
  });

  it("treats sitting exactly on a cap as compliance, not breach", () => {
    // ADR-0068: the allocator clamps a group ONTO its cap, and summing clamped
    // floats reintroduces error. 0.35000000000000003 > 0.35 is one ULP, not a
    // governance breach.
    const geo = scratchMetrics([
      pos({ asset: "A", weight: 0.2, geo: "US" }),
      pos({ asset: "B", weight: 0.15000000000000002, geo: "US" }),
    ]).geo;
    expect(geo[0].weight).toBeGreaterThanOrEqual(0.35);
    expect(geo[0].breached).toBe(false);
  });

  it("excludes an unmapped name from group caps rather than inventing a bucket", () => {
    // An "Unknown" group would produce a cap check on a category that does not
    // exist, and could report a breach of it.
    const m = scratchMetrics([
      pos({ asset: "A", weight: 0.2, sector: "Energy", geo: "US" }),
      pos({ asset: "NEW", weight: 0.2, sector: null, geo: null }),
    ]);
    expect(m.sector.map((s) => s.key)).toEqual(["Energy"]);
    expect(m.sector[0].weight).toBeCloseTo(0.2);
    expect(m.geo.map((g) => g.key)).toEqual(["US"]);
  });
});

describe("an unscored name never acquires a signal", () => {
  it("carries null scores, not zeros", () => {
    const p = pos({ asset: "NVDA", tier: "unscored", edgeScore: null, conviction: null });
    expect(p.edgeScore).toBeNull();
    expect(p.conviction).toBeNull();
  });

  it("is listed so the UI can state the cause", () => {
    const m = scratchMetrics([
      pos({ asset: "VRT" }),
      pos({ asset: "NVDA", tier: "unscored", edgeScore: null, conviction: null }),
    ]);
    expect(m.unscored).toEqual(["NVDA"]);
  });

  it("still counts fully toward exposure and caps", () => {
    // It has no VIEW attached, but it is a real position and consumes real limit.
    const m = scratchMetrics([
      pos({ asset: "NVDA", tier: "unscored", edgeScore: null, conviction: null, weight: 0.25 }),
    ]);
    expect(m.gross).toBeCloseTo(0.25);
    expect(m.singleName[0].breached).toBe(true);
  });
});

describe("factor tilts report their coverage", () => {
  it("returns covered/total so a partial tilt cannot read as a full one", () => {
    const out = scratchTilts(
      [pos({ asset: "A", weight: 0.5 }), pos({ asset: "NEW", weight: 0.5 })],
      { A: { beta_mkt: 1.0 } },
    );
    expect(out.tilts.beta_mkt).toBeCloseTo(0.5);
    expect(out.covered).toBe(1);
    expect(out.total).toBe(2);
    expect(out.missing).toEqual(["NEW"]);
  });

  it("signs a short's contribution negatively", () => {
    const out = scratchTilts([pos({ asset: "A", direction: "short", weight: 0.4 })], {
      A: { beta_mkt: 1.0 },
    });
    expect(out.tilts.beta_mkt).toBeCloseTo(-0.4);
  });
});

describe("drift from the published book", () => {
  const published = [
    { asset: "VRT", direction: "long" as const, weight: 0.1 },
    { asset: "BABA", direction: "short" as const, weight: 0.1 },
  ];

  it("is zero for an untouched copy", () => {
    const d = driftFromBook(
      [
        pos({ asset: "VRT", weight: 0.1 }),
        pos({ asset: "BABA", direction: "short", weight: 0.1 }),
      ],
      published,
    );
    expect(d.turnover).toBeCloseTo(0);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
  });

  it("separates added, removed and resized", () => {
    const d = driftFromBook(
      [pos({ asset: "VRT", weight: 0.2 }), pos({ asset: "NVDA", weight: 0.1 })],
      published,
    );
    expect(d.added).toEqual(["NVDA"]);
    expect(d.removed).toEqual(["BABA"]);
    expect(d.resized).toEqual(["VRT"]);
    // 0.1 resize + 0.1 add + 0.1 removal (a short closed) = 0.3
    expect(d.turnover).toBeCloseTo(0.3);
  });

  it("counts a direction flip as the full distance", () => {
    const d = driftFromBook([pos({ asset: "VRT", direction: "short", weight: 0.1 })], published);
    expect(d.turnover).toBeCloseTo(0.3); // +0.1 -> -0.1 is 0.2, plus BABA's 0.1 exit
  });
});
