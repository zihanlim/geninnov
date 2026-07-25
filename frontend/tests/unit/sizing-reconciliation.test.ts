import { describe, it, expect } from "vitest";
import {
  buildSizingChain,
  type BindingGroupCap,
  type ResolvedEdge,
} from "@/lib/book/positionEdge";

/**
 * The sizing chain mixes two provenances: the normalised-conviction step is
 * recomputed from persisted edge/vol, while the cap and final steps are the weight
 * the sizer actually produced. For as long as size_positions sized by HypeScore
 * (ADR-0053) those were different models rendered as one derivation, and the live
 * 2026-07-25 book showed "normalised 19.0% → single-name cap 20% → final 6.4%" —
 * which no cap can do, since 19.0% is already under 20%.
 */
const edge = (conviction: number | null): ResolvedEdge =>
  ({
    edge_score: 0.45,
    vol: 0.015,
    conviction,
    trend_signal: 0,
    regime_bias: 0,
    carry_signal: 0,
    value_signal: 0,
    sentiment_signal: 0,
    source: "position",
  }) as unknown as ResolvedEdge;

const chain = (
  weight: number,
  conviction = 31.07,
  convictionSum = 163.5,
  cap?: unknown,
  bindingGroupCaps?: BindingGroupCap[],
) =>
  buildSizingChain({
    direction: "long",
    edge: edge(conviction),
    weight,
    signedWeight: weight,
    notional: weight * 1e8,
    hypeScore: 32.6,
    convictionSum,
    cap: cap as never,
    bindingGroupCaps,
  });

describe("sizing chain reconciliation", () => {
  it("flags the live case: 19% normalised, no cap binding, 6.4% held", () => {
    const c = chain(0.064, 31.07, 163.5, {
      weight: 0.064,
      cap: 0.2,
      utilisation: 0.32,
      breached: false,
    });
    expect(c.reconciliation).not.toBeNull();
    expect(c.reconciliation).toContain("19.0%");
    expect(c.reconciliation).toContain("6.4%");
    expect(c.reconciliation).toContain("do not compose");
  });

  it("names the binding group cap rather than falsely reporting 'no cap binding'", () => {
    // The 2026-07-25 live case: single-name cap not binding, but the US geography cap
    // is at its limit and scaled the name down (ADR-0037).
    const c = chain(
      0.088,
      31.07,
      163.5,
      { weight: 0.088, cap: 0.2, utilisation: 0.44, breached: false },
      [{ group: "geography", key: "US", cap: 0.35 }],
    );
    expect(c.reconciliation).not.toBeNull();
    expect(c.reconciliation).toContain("geography cap (US, 35%)");
    expect(c.reconciliation).toContain("ground truth");
    expect(c.reconciliation).not.toContain("no cap binding");
  });

  it("stays silent when the steps do compose", () => {
    // Conviction-sized: normalised == final, nothing to explain.
    const c = chain(0.19, 31.07, 163.5, {
      weight: 0.19,
      cap: 0.2,
      utilisation: 0.95,
      breached: false,
    });
    expect(c.reconciliation).toBeNull();
  });

  it("stays silent when a cap legitimately clamped the weight down", () => {
    // A binding cap is a real explanation for a shortfall — not a discrepancy.
    const c = chain(0.2, 60.0, 163.5, {
      weight: 0.2,
      cap: 0.2,
      utilisation: 1.0,
      breached: false,
    });
    expect(c.reconciliation).toBeNull();
  });

  it("ignores rounding-scale differences", () => {
    const c = chain(0.1899, 31.07, 163.5, {
      weight: 0.1899,
      cap: 0.2,
      utilisation: 0.95,
      breached: false,
    });
    expect(c.reconciliation).toBeNull();
  });

  it("says nothing when there is no conviction to check against", () => {
    const c = chain(0.064, null as unknown as number, 163.5);
    expect(c.reconciliation).toBeNull();
  });
});
