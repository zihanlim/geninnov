import { describe, it, expect } from "vitest";
import {
  classifyOverlap,
  overlapLabel,
  HIGH_CORR_THRESHOLD,
} from "@/lib/candidateOverlap";

describe("candidate overlap", () => {
  it("calls a same-side, highly correlated candidate a duplicate", () => {
    // Live 2026-07-24: AGG long, closest held TLT long, rho +0.91.
    const { aligned, kind } = classifyOverlap("long", "long", 0.91);
    expect(aligned).toBeCloseTo(0.91, 5);
    expect(kind).toBe("same-bet");
  });

  it("treats two shorts on correlated names as the same bet", () => {
    // SLV short against GDX short at +0.82 — the same precious-metals bet.
    expect(classifyOverlap("short", "short", 0.82).kind).toBe("same-bet");
    expect(classifyOverlap("short", "short", 0.82).aligned).toBeCloseTo(0.82, 5);
  });

  it("does NOT call a long candidate a duplicate of a short holding", () => {
    // The bug this module exists for. The book is SHORT ARKK; QQQ, IWM and SPY are
    // long candidates at rho +0.77 / +0.80 / +0.80, and the panel used to label all
    // three "largely already held" — the opposite of the truth.
    for (const rho of [0.77, 0.8, 0.8]) {
      const { aligned, kind } = classifyOverlap("long", "short", rho);
      expect(aligned).toBeCloseTo(-rho, 5);
      expect(kind).toBe("offsets");
    }
  });

  it("calls a short candidate against a correlated long holding an offset too", () => {
    expect(classifyOverlap("short", "long", 0.85).kind).toBe("offsets");
  });

  it("is independent between the two thresholds, whatever the sides", () => {
    // GS long vs JPM long at +0.63, and RTX long vs NOC short at +0.65: both inside
    // the band, so both are genuinely separate ideas that were passed over.
    expect(classifyOverlap("long", "long", 0.63).kind).toBe("independent");
    expect(classifyOverlap("long", "short", 0.65).kind).toBe("independent");
    expect(classifyOverlap("long", "long", -0.18).kind).toBe("independent");
  });

  it("puts the boundary itself on the non-independent side", () => {
    expect(classifyOverlap("long", "long", HIGH_CORR_THRESHOLD).kind).toBe("same-bet");
    expect(classifyOverlap("long", "short", HIGH_CORR_THRESHOLD).kind).toBe("offsets");
  });

  it("refuses to classify without a correlation", () => {
    expect(classifyOverlap("long", "long", null).kind).toBe("unmeasured");
    expect(classifyOverlap("long", "long", undefined).kind).toBe("unmeasured");
    expect(classifyOverlap("long", "long", NaN).kind).toBe("unmeasured");
    // An unmeasurable correlation is not a zero one.
    expect(classifyOverlap("long", "long", null).aligned).toBeNull();
  });

  it("refuses to classify without the held side", () => {
    // Guessing a side would be a verdict dressed as a measurement.
    expect(classifyOverlap("long", null, 0.9).kind).toBe("unmeasured");
    expect(classifyOverlap("long", undefined, 0.9).kind).toBe("unmeasured");
  });

  it("names the holding a candidate would net against", () => {
    expect(overlapLabel("offsets", "ARKK")).toBe("would net against ARKK");
    expect(overlapLabel("offsets", null)).toBe("would net against a holding");
    expect(overlapLabel("same-bet", "TLT")).toBe("largely already held");
    expect(overlapLabel("independent", "TLT")).toBe("independent — passed over");
    expect(overlapLabel("unmeasured", null)).toBe("unmeasured");
  });

  it("shares /risk's correlated-pair threshold rather than inventing one", () => {
    expect(HIGH_CORR_THRESHOLD).toBe(0.7);
  });
});
