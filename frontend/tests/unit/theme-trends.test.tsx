// ThemeTrends — the anchors' Google-Trends board, and its honesty properties.
//
// What is pinned: the share arithmetic (a share of something NAMED — the day's
// theme-mention total, ADR-0091); NULL mention days becoming GAPS rather than
// zeros (ADR-0066 — "the fetch did not report" and "nobody mentioned it" are
// different claims); the five-slot palette cap with the table as the relief
// (ADR-0126); and that the plot is the SAME TrendPlot the narrative board
// renders, so the two boards cannot drift apart geometrically (ADR-0064).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToString } from "react-dom/server";
import { ThemeTrendsTable } from "@/components/ThemeTrends";
import {
  themeSharePct,
  topThemeSeries,
  toThemeTrendSeries,
  type ThemeTrendRow,
} from "@/lib/themeTrends";

const D1 = "2026-07-26";
const D2 = "2026-07-27";
const D3 = "2026-07-28";

function rows(): ThemeTrendRow[] {
  return [
    // D1 total = 40
    { run_date: D1, theme: "Fed Policy", mention_count_1d: 30 },
    { run_date: D1, theme: "US Dollar", mention_count_1d: 10 },
    { run_date: D1, theme: "AI Capex", mention_count_1d: null }, // fetch silent
    // D2 total = 50
    { run_date: D2, theme: "Fed Policy", mention_count_1d: 25 },
    { run_date: D2, theme: "US Dollar", mention_count_1d: 15 },
    { run_date: D2, theme: "AI Capex", mention_count_1d: 10 },
    // D3 total = 20
    { run_date: D3, theme: "Fed Policy", mention_count_1d: 10 },
    { run_date: D3, theme: "US Dollar", mention_count_1d: 5 },
    { run_date: D3, theme: "AI Capex", mention_count_1d: 5 },
  ];
}

describe("toThemeTrendSeries", () => {
  it("computes share against the day's total of reported counts", () => {
    const fed = toThemeTrendSeries(rows()).find((s) => s.phrase === "Fed Policy")!;
    expect(fed.points.map((p) => p.share)).toEqual([30 / 40, 25 / 50, 10 / 20]);
  });

  it("a NULL count is a gap, not a zero point — and leaves the denominator", () => {
    const ai = toThemeTrendSeries(rows()).find((s) => s.phrase === "AI Capex")!;
    // D1 is absent entirely: no fabricated 0-share point.
    expect(ai.points.map((p) => p.run_date)).toEqual([D2, D3]);
    // And D1's other shares were computed over 40 (30+10), not over 40+0.
    const fed = toThemeTrendSeries(rows()).find((s) => s.phrase === "Fed Policy")!;
    expect(fed.points[0].share).toBeCloseTo(0.75);
  });

  it("a day whose reported total is zero yields no points — 0/0 is not a share", () => {
    const zeroDay: ThemeTrendRow[] = [
      { run_date: D1, theme: "Fed Policy", mention_count_1d: 0 },
      { run_date: D1, theme: "US Dollar", mention_count_1d: 0 },
    ];
    for (const s of toThemeTrendSeries(zeroDay)) {
      expect(s.points).toEqual([]);
    }
  });

  it("orders loudest-today first and reports the delta vs the prior run", () => {
    const series = toThemeTrendSeries(rows());
    expect(series[0].phrase).toBe("Fed Policy"); // 50% today
    expect(series[0].latest.delta).toBeCloseTo(0.5 - 0.5, 5);
    const dollar = series.find((s) => s.phrase === "US Dollar")!;
    expect(dollar.latest.delta).toBeCloseTo(0.25 - 0.3, 5);
  });
});

describe("the five-slot cap and its relief", () => {
  const many: ThemeTrendRow[] = Array.from({ length: 9 }, (_, i) => ({
    run_date: D3,
    theme: `Theme ${i}`,
    mention_count_1d: 9 - i,
  }));

  it("draws at most five series; the table carries all of them", () => {
    const series = toThemeTrendSeries(many);
    expect(topThemeSeries(series, 5)).toHaveLength(5);
    const html = renderToString(<ThemeTrendsTable series={series} />).replace(/<!-- -->/g, "");
    for (let i = 0; i < 9; i++) expect(html).toContain(`Theme ${i}`);
  });

  it("a sixth row gets no colour dot — a sixth hue does not exist", () => {
    const series = toThemeTrendSeries(many);
    const html = renderToString(<ThemeTrendsTable series={series} />);
    const dots = html.match(/var\(--series-\d\)/g) ?? [];
    expect(dots).toHaveLength(5);
  });
});

describe("shared plot and honest caption", () => {
  const src = readFileSync(
    path.resolve(__dirname, "../../components/ThemeTrends.tsx"),
    "utf8",
  );

  it("renders through the narrative board's TrendPlot, not a copy", () => {
    // Asserted on the BINDINGS, not on the exact import line. The literal string
    // this used to match broke the moment `seriesColor` joined the same import —
    // a change that makes the two boards share MORE, which is the property this
    // test exists to protect. A test that fails on the fix it is meant to
    // encourage is testing the punctuation, not the design.
    const imported = src.match(
      /import\s*\{([^}]+)\}\s*from\s*"@\/components\/NarrativeTrends"/,
    );
    expect(imported, "ThemeTrends must import from NarrativeTrends").not.toBeNull();
    const names = imported![1].split(",").map((s) => s.trim());
    expect(names).toContain("TrendPlot");
    expect(names).toContain("SERIES_COLORS");
    expect(src).not.toMatch(/function TrendPlot/);
  });

  it("names the denominator and refuses the unbiased-corpus claim", () => {
    expect(src).toContain("relative attention among the nine anchors");
    expect(src).toContain("Not a share of an unbiased corpus");
    expect(src).toContain("gap, never a zero");
  });

  it("says nine, not the stale eight", () => {
    expect(src).not.toMatch(/eight anchor/i);
  });
});

describe("themeSharePct", () => {
  it("formats a share and renders absence as an em-dash", () => {
    expect(themeSharePct(0.043)).toBe("4.3%");
    expect(themeSharePct(null)).toBe("—");
  });
});
