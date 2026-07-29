// A share computed over three documents is 66.7% by arithmetic and says nothing.
//
// Observed live on 2026-07-29, when the Brave quota died mid-run (ADR-0156) and the
// day's same-day mentions across all NINE themes fell to three:
//
//     US Election   66.7%   2 mentions   +55.0pp
//     Fed Policy    33.3%   1 mention     -3.0pp
//     (seven themes at 0.0%)
//
// Rendered with exactly the confidence of a healthy day — same decimals, same delta
// column, no indication that the denominator had collapsed. `+55.0pp` is a statement
// about the sample size, not about the US election.
//
// Healthy days run 62-77 same-day mentions across the nine themes (measured
// 2026-07-27 and -28), so the floor binds only when the figure would otherwise be
// invented.

import { describe, expect, it } from "vitest";
import {
  MIN_DAY_MENTIONS_FOR_SHARE,
  latestSampleShortfall,
  toThemeTrendSeries,
  type ThemeTrendRow,
} from "@/lib/themeTrends";

/** One day's rows across N themes, summing to `total`. */
function day(run_date: string, counts: Array<number | null>): ThemeTrendRow[] {
  return counts.map((n, i) => ({
    run_date,
    theme: `Theme ${i + 1}`,
    mention_count_1d: n,
  }));
}

/** A healthy day: 63 mentions across nine themes, the 2026-07-27 shape. */
const HEALTHY = day("2026-07-20", [15, 12, 11, 7, 6, 4, 3, 3, 2]);
/** The outage: three mentions across nine themes, the 2026-07-29 shape. */
const OUTAGE = day("2026-07-21", [2, 1, 0, 0, 0, 0, 0, 0, 0]);

describe("a thin day cannot carry a share", () => {
  it("drops the outage day from every series", () => {
    const series = toThemeTrendSeries([...HEALTHY, ...OUTAGE]);
    for (const s of series) {
      expect(s.points.map((p) => p.run_date)).not.toContain("2026-07-21");
    }
  });

  it("never prints 66.7% off two mentions", () => {
    const series = toThemeTrendSeries(OUTAGE);
    expect(series.every((s) => s.points.length === 0)).toBe(true);
    expect(series.every((s) => s.latest.share === null)).toBe(true);
  });

  it("suppresses the delta too, not just the share", () => {
    // The delta is the more dangerous number: +55.0pp reads as a surge.
    const series = toThemeTrendSeries([...HEALTHY, ...OUTAGE]);
    expect(series.every((s) => s.latest.delta === null)).toBe(true);
  });

  it("keeps the healthy day", () => {
    const series = toThemeTrendSeries(HEALTHY);
    const withPoints = series.filter((s) => s.points.length > 0);
    expect(withPoints).toHaveLength(9);
    const top = series[0];
    expect(top.latest.share).toBeCloseTo(15 / 63, 6);
  });

  it("binds at the boundary and not above it", () => {
    const atFloor = day("2026-07-22", [MIN_DAY_MENTIONS_FOR_SHARE]);
    const below = day("2026-07-23", [MIN_DAY_MENTIONS_FOR_SHARE - 1]);
    expect(toThemeTrendSeries(atFloor)[0].points).toHaveLength(1);
    expect(toThemeTrendSeries(below)[0].points).toHaveLength(0);
  });

  it("is a GAP, not a zero", () => {
    // The distinction the whole guard exists for: a zero-height point would read
    // as "nobody mentioned anything" (ADR-0066).
    const series = toThemeTrendSeries([...HEALTHY, ...OUTAGE]);
    for (const s of series) {
      expect(s.points.some((p) => p.share === 0 && p.run_date === "2026-07-21")).toBe(
        false,
      );
    }
  });
});

describe("the absence states its cause", () => {
  it("reports the thin day and its total", () => {
    const short = latestSampleShortfall([...HEALTHY, ...OUTAGE]);
    expect(short).toEqual({ run_date: "2026-07-21", total: 3 });
  });

  it("returns null when the latest day is healthy", () => {
    expect(latestSampleShortfall(HEALTHY)).toBeNull();
  });

  it("looks at the LATEST day, not any thin day in history", () => {
    // A thin day last week is already a gap in the lines; the banner is about
    // why TODAY is missing.
    const recentHealthy = day("2026-07-25", [20, 18, 15, 10]);
    expect(latestSampleShortfall([...OUTAGE, ...recentHealthy])).toBeNull();
  });

  it("returns null on no data at all rather than claiming a shortfall of zero", () => {
    expect(latestSampleShortfall([])).toBeNull();
    expect(latestSampleShortfall(day("2026-07-26", [null, null]))).toBeNull();
  });
});
