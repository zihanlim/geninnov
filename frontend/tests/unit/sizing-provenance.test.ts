import { describe, expect, it } from "vitest";

import {
  describeSizing,
  frontierPath,
  sizingRows,
} from "@/lib/book/sizingProvenance";

describe("describeSizing", () => {
  it("names the optimizer and the IC it sized on", () => {
    const summary = describeSizing("optimizer", null, {
      feasible: true,
      ic: { value: 0.0373, as_of: "2026-07-24" },
    });
    expect(summary.tone).toBe("optimizer");
    expect(summary.headline).toMatch(/mean-variance/i);
    expect(summary.detail).toContain("0.0373");
    expect(summary.detail).toContain("2026-07-24");
  });

  it("carries the reason forward when the optimizer did not run", () => {
    // ADR-0098: an absence must say WHICH absence. "conviction-sized because no IC
    // has been measured" and "conviction-sized because the constraints were
    // infeasible" are different facts, and a reader told only the former learns the
    // wrong thing about the latter.
    const summary = describeSizing(
      "conviction",
      "no EdgeScore IC has been measured yet",
      { feasible: false, status: "not_run" }
    );
    expect(summary.tone).toBe("fallback");
    expect(summary.detail).toContain("no EdgeScore IC has been measured yet");
  });

  it("says so when no reason was recorded, rather than implying one", () => {
    const summary = describeSizing("conviction", null, null);
    expect(summary.tone).toBe("fallback");
    expect(summary.detail).toContain("no reason was recorded");
  });

  it("does not infer conviction sizing from a missing column", () => {
    // Every book published before migration 047 was in fact conviction-sized, so
    // claiming it here would be RIGHT — and that is precisely why it is the wrong
    // habit. The same code path runs when a future write fails silently, and then
    // the page would state a provenance nobody recorded.
    const summary = describeSizing(null, null, null);
    expect(summary.tone).toBe("unrecorded");
    expect(summary.headline).toMatch(/not recorded/i);
    expect(summary.detail).not.toMatch(/proportional to conviction/i);
  });

  it("treats an infeasible result as a fallback even if the method says optimizer", () => {
    // Defensive: the column and the payload disagreeing is a bug, and the payload is
    // the one carrying the evidence.
    const summary = describeSizing("optimizer", "infeasible", { feasible: false });
    expect(summary.tone).toBe("fallback");
  });
});

describe("sizingRows", () => {
  const result = {
    feasible: true,
    signed_weights: { SVXY: 0.1607, GDX: -0.0746, SHY: 0 },
    zeroed: ["SHY"],
  };
  const heuristic = { SVXY: 0.0394, GDX: -0.064, SHY: 0.0925 };

  it("pairs the two sizings and computes the delta", () => {
    const rows = sizingRows(result, heuristic);
    const svxy = rows.find((r) => r.asset === "SVXY")!;
    expect(svxy.optimizer).toBeCloseTo(0.1607);
    expect(svxy.heuristic).toBeCloseTo(0.0394);
    expect(svxy.delta).toBeCloseTo(0.1213);
  });

  it("keeps a name the optimizer priced out, and flags it", () => {
    // "We declined this" is a result. Dropping the row would make the position
    // disappear from the comparison entirely, which reads as though it was never
    // considered (ADR-0058).
    const rows = sizingRows(result, heuristic);
    const shy = rows.find((r) => r.asset === "SHY")!;
    expect(shy).toBeDefined();
    expect(shy.zeroed).toBe(true);
    expect(shy.optimizer).toBe(0);
    expect(shy.heuristic).toBeCloseTo(0.0925);
  });

  it("orders by the size of the position actually held", () => {
    const rows = sizingRows(result, heuristic);
    expect(rows[0].asset).toBe("SVXY");
  });

  it("shows the conviction book alone when the optimizer did not run", () => {
    const rows = sizingRows({ feasible: false }, heuristic);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.optimizer === null)).toBe(true);
    expect(rows.every((r) => r.delta === null)).toBe(true);
  });

  it("returns nothing when there is nothing to compare", () => {
    expect(sizingRows(null, null)).toEqual([]);
  });
});

describe("frontierPath", () => {
  const frontier = {
    points: [
      { volatility: 0.001, expected_return: 0.0001 },
      { volatility: 0.05, expected_return: 0.005 },
      { volatility: 0.13, expected_return: 0.011 },
    ],
    current: { volatility: 0.0839, expected_return: 0.00675 },
  };

  it("projects the frontier and the current book onto the same axes", () => {
    const path = frontierPath(frontier)!;
    expect(path.points).toHaveLength(3);
    expect(path.current).not.toBeNull();
    // Both must be inside the same viewBox, or the picture compares two scales.
    for (const p of [...path.points, path.current!]) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(path.width);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(path.height);
    }
  });

  it("puts a higher expected return higher on the page", () => {
    // SVG y grows downward. Getting this backwards draws an inverted frontier that
    // still looks like a frontier.
    const path = frontierPath(frontier)!;
    expect(path.points[2].y).toBeLessThan(path.points[0].y);
  });

  it("includes the current book in the extents rather than clipping it", () => {
    const offFrontier = {
      points: frontier.points,
      current: { volatility: 0.30, expected_return: 0.001 },
    };
    const path = frontierPath(offFrontier)!;
    expect(path.current!.x).toBeLessThanOrEqual(path.width);
    expect(path.maxVol).toBeCloseTo(0.30);
  });

  it("returns null when there is nothing to draw", () => {
    expect(frontierPath(null)).toBeNull();
    expect(frontierPath({ points: [] })).toBeNull();
    // One point is not a frontier.
    expect(frontierPath({ points: [{ volatility: 0.1, expected_return: 0.01 }] })).toBeNull();
  });

  it("drops non-finite points rather than producing NaN coordinates", () => {
    const path = frontierPath({
      points: [
        { volatility: 0.01, expected_return: 0.001 },
        { volatility: Number.NaN, expected_return: 0.002 },
        { volatility: 0.05, expected_return: 0.004 },
      ],
    })!;
    expect(path.points).toHaveLength(2);
    expect(path.polyline).not.toContain("NaN");
  });
});
