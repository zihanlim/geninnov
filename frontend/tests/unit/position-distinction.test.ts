import { describe, it, expect } from "vitest";
import {
  distinguishPosition,
  distinctionClause,
  positionRationale,
  distinctLineCount,
} from "@/lib/positionDistinction";
import type { IndependentIdeas } from "@/components/book/PoolDepth";

/**
 * The live 2026-07-25 idea map, transcribed from the deployed /book Pool depth panel.
 * The point of using the real shape is that the regression being fixed was only
 * visible on a real book — a synthetic two-position fixture would have "passed" while
 * the deployed page rendered two strings across nine rows.
 */
const LIVE: IndependentIdeas = {
  long: {
    names: 20,
    count: 10,
    complexes: [
      { members: ["EEM", "EWJ", "IWM", "QQQ", "SVXY"], strongest: "EEM" },
      { members: ["AGG", "IEF", "SHY", "TLT"], strongest: "SHY" },
      { members: ["CVX", "XLE", "XOM"], strongest: "XLE" },
      { members: ["OIH", "SLB"], strongest: "OIH" },
    ],
    standalone: ["NUE", "UNH", "JPM", "GS", "BIL", "JD"],
  },
  short: {
    names: 10,
    count: 4,
    complexes: [
      { members: ["GDX", "GLD", "IAU", "NEM", "SLV"], strongest: "SLV" },
      { members: ["BABA", "KWEB", "MCHI"], strongest: "BABA" },
    ],
    standalone: ["PDD", "NOC"],
  },
};

describe("distinguishPosition", () => {
  it("names what the strongest member was taken instead of", () => {
    expect(distinguishPosition("XLE", "long", LIVE)).toEqual({
      kind: "strongest",
      over: ["CVX", "XOM"],
    });
    expect(distinguishPosition("SLV", "short", LIVE)).toEqual({
      kind: "strongest",
      over: ["GDX", "GLD", "IAU", "NEM"],
    });
  });

  it("reports a standalone name as standalone", () => {
    expect(distinguishPosition("NUE", "long", LIVE)).toEqual({ kind: "standalone" });
    expect(distinguishPosition("NOC", "short", LIVE)).toEqual({ kind: "standalone" });
  });

  it("reads the side matching the position's direction, never the other one", () => {
    // BABA is the strongest SHORT complex member and absent from the long map.
    expect(distinguishPosition("BABA", "short", LIVE)).toEqual({
      kind: "strongest",
      over: ["KWEB", "MCHI"],
    });
    expect(distinguishPosition("BABA", "long", LIVE)).toEqual({ kind: "unmeasured" });
  });

  it("is unmeasured — never standalone — for a name absent from the map", () => {
    // Absence usually means no usable return history to correlate. Calling that
    // "no correlated alternative" would assert independence from missing data.
    expect(distinguishPosition("ARKX", "short", LIVE)).toEqual({ kind: "unmeasured" });
  });

  it("is unmeasured for a non-strongest complex member", () => {
    // CVX sits inside the XLE complex. It should not claim to have beaten XLE.
    expect(distinguishPosition("CVX", "long", LIVE)).toEqual({ kind: "unmeasured" });
  });

  it("is unmeasured when there is no measurement at all", () => {
    expect(distinguishPosition("XLE", "long", null)).toEqual({ kind: "unmeasured" });
    expect(distinguishPosition("XLE", "long", {})).toEqual({ kind: "unmeasured" });
    expect(distinguishPosition("XLE", null, LIVE)).toEqual({ kind: "unmeasured" });
  });
});

describe("distinctionClause", () => {
  it("elides past four names rather than overflowing the row", () => {
    const clause = distinctionClause({
      kind: "strongest",
      over: ["A", "B", "C", "D", "E", "F"],
    });
    expect(clause).toBe("taken over A, B, C, D +2 more");
  });

  it("returns null for unmeasured, so the line degrades instead of padding", () => {
    expect(distinctionClause({ kind: "unmeasured" })).toBeNull();
  });
});

describe("positionRationale", () => {
  it("joins the driver phrase to the distinction", () => {
    expect(
      positionRationale("Long · a strong price uptrend", {
        kind: "strongest",
        over: ["CVX", "XOM"],
      })
    ).toBe("Long · a strong price uptrend · taken over CVX, XOM");
  });

  it("falls back to the driver phrase alone when nothing was measured", () => {
    expect(
      positionRationale("Long · a strong price uptrend", { kind: "unmeasured" })
    ).toBe("Long · a strong price uptrend");
  });

  it("still says something when the edge is missing but the distinction is not", () => {
    expect(positionRationale(null, { kind: "standalone" })).toBe(
      "No correlated alternative"
    );
    expect(positionRationale(null, { kind: "unmeasured" })).toBeNull();
  });
});

describe("the regression this exists to prevent", () => {
  // The live book, and the degenerate driver phrases it actually produced.
  const BOOK = [
    { asset: "XLE", direction: "long" },
    { asset: "OIH", direction: "long" },
    { asset: "NUE", direction: "long" },
    { asset: "JPM", direction: "long" },
    { asset: "EEM", direction: "long" },
    { asset: "SLV", direction: "short" },
    { asset: "BABA", direction: "short" },
    { asset: "PDD", direction: "short" },
    { asset: "NOC", direction: "short" },
  ];
  const plainFor = (d: string) =>
    d === "long" ? "Long · a strong price uptrend" : "Short · a price downtrend";

  it("the OLD line collapsed nine positions to two strings", () => {
    expect(distinctLineCount(BOOK.map((p) => plainFor(p.direction)))).toBe(2);
  });

  it("the NEW line differentiates across the same book", () => {
    const lines = BOOK.map((p) =>
      positionRationale(
        plainFor(p.direction),
        distinguishPosition(p.asset, p.direction, LIVE)
      )
    );
    // Not merely "more than two" — a fix that produced three would be the same bug
    // with a larger constant. Every position on a side that the map covers should be
    // separable from its side-mates.
    expect(distinctLineCount(lines)).toBeGreaterThanOrEqual(7);
    expect(lines).toContain("Long · a strong price uptrend · taken over CVX, XOM");
    expect(lines).toContain(
      "Short · a price downtrend · taken over GDX, GLD, IAU, NEM"
    );
  });

  it("does not manufacture difference where the measurement has none", () => {
    // PDD and NOC are both standalone shorts. They legitimately read the same, and
    // inventing a distinction between them would be worse than sharing a line.
    const pdd = positionRationale(
      plainFor("short"),
      distinguishPosition("PDD", "short", LIVE)
    );
    const noc = positionRationale(
      plainFor("short"),
      distinguishPosition("NOC", "short", LIVE)
    );
    expect(pdd).toBe(noc);
  });
});
