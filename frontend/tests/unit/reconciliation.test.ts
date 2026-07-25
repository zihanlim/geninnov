// The reconciliation verdict, pinned.
//
// This is /method's core claim — that the arithmetic reproduces the published
// number — so the tolerance boundaries and the three-state result are the whole
// contract. Two behaviours in particular are load-bearing:
//
//  * "cannot compare" must stay distinct from "does not reconcile". Collapsing an
//    unscored row into a failure accuses the pipeline of a defect it does not
//    have; collapsing it into a pass claims a proof that never ran.
//  * The tolerance is scale-dependent (0.05 on HypeScore's 0-100, 0.005 on
//    EdgeScore's [-1,1]) and has no default, because passing the wrong scale's
//    tolerance is exactly how this goes quietly wrong.

import { describe, expect, it } from "vitest";
import {
  deltaCaption,
  deltaTone,
  reconcile,
} from "@/lib/method/reconciliation";

const HYPE_TOL = 0.05;
const EDGE_TOL = 0.005;

describe("reconcile", () => {
  it("passes an exact match", () => {
    const v = reconcile(60.12, 60.12, HYPE_TOL);
    expect(v.delta).toBe(0);
    expect(v.reconciles).toBe(true);
  });

  it("passes just inside tolerance and fails just outside", () => {
    expect(reconcile(60.14, 60.1, HYPE_TOL).reconciles).toBe(true); // |0.04| < 0.05
    expect(reconcile(60.16, 60.1, HYPE_TOL).reconciles).toBe(false); // |0.06| > 0.05
  });

  it("treats the tolerance as exclusive at the boundary", () => {
    // Strict `<`, so a delta exactly equal to the tolerance does NOT reconcile.
    // Pinned because flipping it to `<=` silently widens every verdict.
    const v = reconcile(0.005, 0, EDGE_TOL);
    expect(Math.abs(v.delta!)).toBeCloseTo(EDGE_TOL, 12);
    expect(v.reconciles).toBe(false);
  });

  it("is symmetric in sign — a negative gap fails the same way", () => {
    expect(reconcile(60.0, 60.2, HYPE_TOL).reconciles).toBe(false);
    expect(reconcile(60.2, 60.0, HYPE_TOL).reconciles).toBe(false);
    expect(reconcile(60.0, 60.2, HYPE_TOL).delta).toBeCloseTo(-0.2, 10);
  });

  it("respects the scale it is given", () => {
    // The same gap that is fine on HypeScore is a failure on EdgeScore.
    const gap = 0.01;
    expect(reconcile(gap, 0, HYPE_TOL).reconciles).toBe(true);
    expect(reconcile(gap, 0, EDGE_TOL).reconciles).toBe(false);
  });

  it("reports null — not false — when there is nothing to compare", () => {
    for (const [r, p] of [
      [null, 60.1],
      [60.1, null],
      [null, null],
      [undefined, 60.1],
      [60.1, undefined],
    ] as Array<[number | null | undefined, number | null | undefined]>) {
      const v = reconcile(r, p, HYPE_TOL);
      expect(v.reconciles).toBeNull();
      expect(v.delta).toBeNull();
    }
  });

  it("treats NaN and Infinity as absent rather than as values", () => {
    // A NaN delta compares false against every threshold, which would render as
    // a reconciliation FAILURE for what is really a missing input.
    expect(reconcile(NaN, 60.1, HYPE_TOL).reconciles).toBeNull();
    expect(reconcile(60.1, Infinity, HYPE_TOL).reconciles).toBeNull();
    expect(reconcile(NaN, 60.1, HYPE_TOL).recomputed).toBeNull();
  });

  it("carries the tolerance it used, for the audit trail", () => {
    expect(reconcile(1, 1, EDGE_TOL).tolerance).toBe(EDGE_TOL);
  });

  it("preserves both sides verbatim so the page can show its working", () => {
    const v = reconcile(60.1234, 60.1, HYPE_TOL);
    expect(v.recomputed).toBe(60.1234);
    expect(v.persisted).toBe(60.1);
  });
});

describe("verdict presentation", () => {
  it("tones the delta by outcome, muted when unmeasurable", () => {
    expect(deltaTone(reconcile(1, 1, EDGE_TOL))).toBe("good");
    expect(deltaTone(reconcile(1, 2, EDGE_TOL))).toBe("bad");
    expect(deltaTone(reconcile(1, null, EDGE_TOL))).toBe("muted");
  });

  it("never captions an unmeasured comparison as a failure", () => {
    // §2 of the design goals: absence is stated, not filled.
    const caption = deltaCaption(reconcile(1, null, EDGE_TOL));
    expect(caption).toBe("no persisted value to compare");
    expect(caption).not.toContain("NOT reconcile");
  });

  it("says plainly when it does not reconcile", () => {
    expect(deltaCaption(reconcile(1, 2, EDGE_TOL))).toContain("does NOT reconcile");
    expect(deltaCaption(reconcile(1, 1, EDGE_TOL))).toBe("reconciles exactly");
  });
});
