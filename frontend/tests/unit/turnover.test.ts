import { describe, it, expect } from "vitest";
import { comparabilityCaveat, turnover } from "@/lib/turnover";

describe("book turnover", () => {
  it("reports zero when the same names are held", () => {
    // Names, not weights: a position that survives at a different size is the same
    // idea, and conflating the two would hide the question that matters.
    const t = turnover(["SPY", "TLT"], ["TLT", "SPY"]);
    expect(t.pct).toBe(0);
    expect(t.kept).toEqual(["SPY", "TLT"]);
    expect(t.opened).toEqual([]);
    expect(t.closed).toEqual([]);
  });

  it("reports 100% when nothing carries over", () => {
    const t = turnover(["GDX", "NOC"], ["SPY", "TLT"]);
    expect(t.pct).toBe(1);
    expect(t.opened).toEqual(["GDX", "NOC"]);
    expect(t.closed).toEqual(["SPY", "TLT"]);
  });

  it("measures the share of the COMBINED name set that changed", () => {
    // Held SPY; closed TLT; opened GDX. Union is {SPY,TLT,GDX} = 3, one survived,
    // so two thirds of the combined set moved.
    const t = turnover(["SPY", "GDX"], ["SPY", "TLT"]);
    expect(t.pct).toBeCloseTo(2 / 3, 5);
    expect(t.kept).toEqual(["SPY"]);
    expect(t.opened).toEqual(["GDX"]);
    expect(t.closed).toEqual(["TLT"]);
  });

  it("handles an empty previous book without dividing by zero", () => {
    expect(turnover([], []).pct).toBe(0);
    expect(turnover(["SPY"], []).pct).toBe(1);
  });

  it("is not fooled by duplicate names on either side", () => {
    const t = turnover(["SPY", "SPY"], ["SPY"]);
    expect(t.pct).toBe(0);
    expect(t.kept).toEqual(["SPY"]);
  });
});

describe("comparability", () => {
  it("stays silent when both books are a similar size", () => {
    expect(comparabilityCaveat(8, 8)).toBeNull();
    expect(comparabilityCaveat(8, 5)).toBeNull();
    expect(comparabilityCaveat(5, 8)).toBeNull();
  });

  it("flags the 8-vs-2 case that prompted it", () => {
    // Live on 2026-07-24: today's book holds 8, the previous run held 2, and
    // turnover reads 100% for a reason that has nothing to do with the view.
    const msg = comparabilityCaveat(8, 2);
    expect(msg).toContain("2 names");
    expect(msg).toContain("8");
    expect(msg).toContain("not a like-for-like comparison");
  });

  it("is symmetric — a book that shrank is just as incomparable", () => {
    expect(comparabilityCaveat(2, 8)).not.toBeNull();
  });

  it("says nothing when either book is empty (nothing to compare)", () => {
    expect(comparabilityCaveat(0, 8)).toBeNull();
    expect(comparabilityCaveat(8, 0)).toBeNull();
  });

  it("uses singular wording for a one-name previous book", () => {
    expect(comparabilityCaveat(10, 1)).toContain("1 name against");
  });
});
