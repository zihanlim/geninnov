import { describe, it, expect } from "vitest";
import { recomputeEdgeScore, type ThemeEdge, type EdgeWeights } from "@/lib/themeSignals";

/**
 * `/method`'s worked example and `/book`'s EdgeBars both recomputed EdgeScore by
 * summing `w × (v ?? 0)` with no renormalisation, while the pipeline drops a null
 * component and divides by the weight actually present (ADR-0036).
 *
 * On the live 2026-07-25 Energy Prices row that produced a red **RECONCILIATION
 * FAILURE** on `/method` blaming the pipeline — *"either the weights changed after
 * this row was written, or a component column and the score column were not written
 * from the same inputs."* Both causes are false: the persisted number was right and
 * the page's arithmetic was wrong (ADR-0064).
 */

/** The live weights from scoring_config on that run. */
const W: EdgeWeights = {
  trend: 0.2,
  regime: 0.23,
  carry: 0.34,
  value: 0.18,
  sentiment: 0.05,
  abstainThreshold: 0.15,
};

/** The live Energy Prices row: carry and value not computable. */
const ENERGY: ThemeEdge = {
  edge_score: 0.354165,
  trend_signal: 0.7932,
  regime_bias: 0.0365,
  carry_signal: null,
  value_signal: null,
  sentiment_signal: 0.0592,
  conviction: null,
  vol: null,
  direction: "long",
  run_date: "2026-07-25",
};

describe("recomputeEdgeScore renormalises over present components", () => {
  it("reproduces the persisted score the naive sum could not", () => {
    const { weightedSum, weightPresent, edgeScore } = recomputeEdgeScore(ENERGY, W);
    // The naive sum — what both surfaces used to print.
    expect(weightedSum).toBeCloseTo(0.169999, 5);
    // Only trend + regime + sentiment are computable.
    expect(weightPresent).toBeCloseTo(0.2 + 0.23 + 0.05, 10);
    // ...and the quotient is the persisted value. Tolerance is 1e-4, not tighter:
    // the components here are the page's 4-dp DISPLAY values (0.7932, 0.0365,
    // 0.0592), so the fixture cannot reproduce more precision than it was given.
    // Recomputed 0.35415625 vs persisted 0.354165 — an 8.8e-6 gap that is entirely
    // input rounding, and asserting 1e-5 would be pinning that rounding rather than
    // the renormalisation this test is about.
    expect(edgeScore).toBeCloseTo(ENERGY.edge_score as number, 4);
  });

  it("the naive sum is NOT the persisted score — the bug this pins", () => {
    const { weightedSum } = recomputeEdgeScore(ENERGY, W);
    expect(Math.abs(weightedSum - (ENERGY.edge_score as number))).toBeGreaterThan(0.15);
  });

  it("is a no-op when every component is computable", () => {
    // Full weights sum to 1.00, so renormalising divides by 1 and changes nothing.
    const full: ThemeEdge = {
      ...ENERGY,
      carry_signal: 0.4,
      value_signal: -0.2,
      edge_score: null,
    };
    const { weightedSum, weightPresent, edgeScore } = recomputeEdgeScore(full, W);
    expect(weightPresent).toBeCloseTo(1.0, 10);
    expect(edgeScore).toBeCloseTo(weightedSum, 12);
  });

  it("abstains at 0 when nothing is computable, never divides by zero", () => {
    const empty: ThemeEdge = {
      ...ENERGY,
      trend_signal: null,
      regime_bias: null,
      carry_signal: null,
      value_signal: null,
      sentiment_signal: null,
    };
    const { weightPresent, edgeScore } = recomputeEdgeScore(empty, W);
    expect(weightPresent).toBe(0);
    expect(edgeScore).toBe(0);
    expect(Number.isFinite(edgeScore)).toBe(true);
  });

  it("does not let a missing component drag the score toward abstention", () => {
    // The point of ADR-0036: a theme with one strong computable signal should not be
    // pushed under the 0.15 abstain band by the absence of a carry proxy.
    const oneStrong: ThemeEdge = {
      ...ENERGY,
      trend_signal: 0.9,
      regime_bias: null,
      carry_signal: null,
      value_signal: null,
      sentiment_signal: null,
      edge_score: null,
    };
    const { edgeScore } = recomputeEdgeScore(oneStrong, W);
    expect(edgeScore).toBeCloseTo(0.9, 10);        // renormalised: 0.20·0.9 / 0.20
    expect(Math.abs(edgeScore)).toBeGreaterThan(W.abstainThreshold);
    // The naive sum would have been 0.18 — barely above the band, and for the wrong
    // reason: it measures how much weight happened to be computable, not conviction.
  });
});
