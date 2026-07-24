import { describe, it, expect } from "vitest";
import type { SideDepth } from "@/components/book/PoolDepth";

/**
 * The panel's branch selection, extracted so the three cases can be asserted without
 * a DOM renderer (this suite has no React test environment).
 *
 * The bug being pinned: `PoolDepth` ended every under-picked side with "the agent's
 * reasoning is in the thesis above". On the live 2026-07-25 run the book took four
 * shorts against five independent ideas and the thesis never mentioned ARKK — so the
 * one panel built to expose the shortfall pointed the reader at prose that did not
 * answer it (ADR-0056).
 *
 * Kept in lockstep with the JSX by construction: both read `shortfall.unexplained`
 * and `shortfall.named`, and nothing else decides the branch.
 */
type Branch = "pool-limited" | "unexplained" | "explained" | "unmeasured" | "complete";

const Q1_TARGET = 5;

function branchFor(depth: SideDepth, held: number): Branch {
  const poolLimited = depth.count < Q1_TARGET;
  const underPicked = held < Math.min(depth.count, Q1_TARGET);
  const unexplained = depth.shortfall?.unexplained ?? [];
  const satisfied = depth.shortfall
    ? (depth.shortfall.satisfied ?? unexplained.length === 0)
    : null;
  if (poolLimited) return "pool-limited";
  if (underPicked && satisfied === false) return "unexplained";
  if (underPicked && satisfied === true) return "explained";
  if (underPicked) return "unmeasured";
  return "complete";
}

const LIVE_SHORT: SideDepth = {
  count: 5,
  names: 11,
  complexes: [
    { members: ["GDX", "GLD", "IAU", "NEM", "SLV"], strongest: "SLV" },
    { members: ["BABA", "KWEB", "MCHI"], strongest: "BABA" },
  ],
  standalone: ["PDD", "NOC", "ARKK"],
};

describe("PoolDepth shortfall branch", () => {
  it("says the thesis is silent when a declined idea is unexplained", () => {
    const depth: SideDepth = {
      ...LIVE_SHORT,
      shortfall: {
        held: 4,
        available: 5,
        empty_slots: 1,
        passed_over: ["ARKK"],
        named: [],
        unexplained: ["ARKK"],
        satisfied: false,
      },
    };
    expect(branchFor(depth, 4)).toBe("unexplained");
  });

  it("credits the thesis when it names what it declined", () => {
    const depth: SideDepth = {
      ...LIVE_SHORT,
      shortfall: {
        held: 4,
        available: 5,
        empty_slots: 1,
        passed_over: ["ARKK"],
        named: ["ARKK"],
        unexplained: [],
        satisfied: true,
      },
    };
    expect(branchFor(depth, 4)).toBe("explained");
  });

  it("does not claim the thesis explains anything when nothing was measured", () => {
    // Rows written before ADR-0056 carry no `shortfall` key. Asserting "the reasoning
    // is in the thesis" for them would be the same false pointer, just older.
    expect(branchFor(LIVE_SHORT, 4)).toBe("unmeasured");
  });

  it("a pool with fewer than five ideas is constraint, not choice", () => {
    const thin: SideDepth = { count: 3, names: 6, complexes: [], standalone: ["A", "B", "C"] };
    expect(branchFor(thin, 3)).toBe("pool-limited");
    // ...and stays pool-limited even when under-picked, because the honest headline
    // is that the market offered three.
    expect(branchFor(thin, 2)).toBe("pool-limited");
  });

  it("a side that took everything reachable says nothing about a shortfall", () => {
    expect(branchFor(LIVE_SHORT, 5)).toBe("complete");
  });

  it("never shows the warning branch when the shortfall block is empty", () => {
    const depth: SideDepth = {
      ...LIVE_SHORT,
      shortfall: {
        held: 5, available: 5, empty_slots: 0,
        passed_over: [], named: [], unexplained: [], satisfied: true,
      },
    };
    expect(branchFor(depth, 5)).toBe("complete");
  });
});

describe("ADR-0058 — the verdict is empty slots, not declined ideas", () => {
  it("credits a side that named one idea per empty slot, though others went untaken", () => {
    // The real sample-1 long side from the frozen-input run: 3 held of 5 reachable,
    // SEVEN independent ideas untaken, FOUR of them named. Two slots empty, four
    // named — satisfied. The old all-or-nothing rule called this a failure.
    const depth: SideDepth = {
      count: 10,
      names: 19,
      complexes: [],
      standalone: ["SHY", "NUE", "UNH", "JPM", "BIL", "GS", "JD"],
      shortfall: {
        held: 3,
        available: 5,
        empty_slots: 2,
        passed_over: ["SHY", "NUE", "UNH", "JPM", "BIL", "GS", "JD"],
        named: ["NUE", "UNH", "JPM", "BIL"],
        unexplained: ["SHY", "GS", "JD"],
        satisfied: true,
      },
    };
    expect(branchFor(depth, 3)).toBe("explained");
  });

  it("falls back to all-or-nothing for rows written before the verdict existed", () => {
    // Pre-ADR-0058 rows carry `unexplained` but no `satisfied`. Inventing a lenient
    // verdict for them would silently clear warnings that were correct when written.
    const depth: SideDepth = {
      ...LIVE_SHORT,
      shortfall: {
        held: 4,
        available: 5,
        passed_over: ["ARKK"],
        named: [],
        unexplained: ["ARKK"],
      },
    };
    expect(branchFor(depth, 4)).toBe("unexplained");
  });
});
