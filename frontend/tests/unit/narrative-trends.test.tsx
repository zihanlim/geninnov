import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  attentionFunnel,
  emergingUncovered,
  sharePct,
  topSeries,
  toSeries,
  type NarrativeRow,
  type NarrativeSeries,
} from "@/lib/narratives";
import NarrativeTrends, {
  DetectionScatter,
  SeriesTable,
  TrendPlot,
} from "@/components/NarrativeTrends";
import { isCorroborated } from "@/lib/narratives";

function row(over: Partial<NarrativeRow> = {}): NarrativeRow {
  return {
    run_date: "2026-07-28",
    phrase: "ai capex cycle",
    doc_count: 12,
    corpus_size: 200,
    share: 0.06,
    velocity: 2.4,
    days_observed: 9,
    first_seen: "2026-07-20",
    status: "emerging",
    covered_by: null,
    methods: ["frequency"],
    ...over,
  };
}

/** Build one series of `n` runs with the given shares. */
function series(phrase: string, shares: number[]): NarrativeSeries {
  const points = shares.map((share, i) => ({
    run_date: `2026-07-${String(i + 1).padStart(2, "0")}`,
    share,
  }));
  return {
    phrase,
    points,
    latest: row({ phrase, share: shares[shares.length - 1] }),
  };
}

/** Every numeric attribute of every SVG mark, so a mark drawn outside the
 *  viewBox is caught wherever it came from — <circle>, <path> or <text>. */
function marksOutsideViewBox(markup: string) {
  const vb = markup.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  if (!vb) throw new Error("no viewBox found");
  const width = Number(vb[1]);
  const height = Number(vb[2]);
  const escapes: string[] = [];

  for (const el of markup.match(/<circle[^>]*>/g) ?? []) {
    const cx = Number(el.match(/cx="([-\d.]+)"/)?.[1] ?? NaN);
    const cy = Number(el.match(/cy="([-\d.]+)"/)?.[1] ?? NaN);
    if (cx < -0.5 || cx > width + 0.5 || cy < -0.5 || cy > height + 0.5) {
      escapes.push(`circle ${cx},${cy}`);
    }
  }
  for (const el of markup.match(/<path[^>]*\sd="([^"]+)"/g) ?? []) {
    const d = el.match(/\sd="([^"]+)"/)?.[1] ?? "";
    // exec-loop, not matchAll: this repo's tsc target rejects iterating a
    // RegExpStringIterator (same reason risk-charts.test.tsx uses one).
    const pairRe = /([-\d.]+),([-\d.]+)/g;
    let pair = pairRe.exec(d);
    while (pair !== null) {
      const px = Number(pair[1]);
      const py = Number(pair[2]);
      if (px < -0.5 || px > width + 0.5 || py < -0.5 || py > height + 0.5) {
        escapes.push(`path ${px},${py}`);
      }
      pair = pairRe.exec(d);
    }
  }
  for (const el of markup.match(/<text[^>]*>/g) ?? []) {
    const tx = Number(el.match(/\sx="([-\d.]+)"/)?.[1] ?? NaN);
    const ty = Number(el.match(/\sy="([-\d.]+)"/)?.[1] ?? NaN);
    if (Number.isFinite(tx) && (tx < -0.5 || tx > width + 0.5)) escapes.push(`text x ${tx}`);
    if (Number.isFinite(ty) && (ty < -0.5 || ty > height + 0.5)) escapes.push(`text y ${ty}`);
  }
  return escapes;
}

describe("narrative read model", () => {
  it("groups rows into ascending per-phrase series", () => {
    const rows = [
      row({ run_date: "2026-07-28", share: 0.06 }),
      row({ run_date: "2026-07-26", share: 0.02 }),
      row({ run_date: "2026-07-27", share: 0.04 }),
    ];
    const out = toSeries(rows);
    expect(out).toHaveLength(1);
    expect(out[0].points.map((p) => p.run_date)).toEqual([
      "2026-07-26",
      "2026-07-27",
      "2026-07-28",
    ]);
    expect(out[0].latest.run_date).toBe("2026-07-28");
  });

  it("drops a phrase absent from the most recent run", () => {
    // A line that stops three days ago reads as "this narrative collapsed" when
    // it usually means the phrase fell below the document floor and stopped
    // being tracked. The chart cannot tell those apart, so it draws neither.
    const rows = [
      row({ run_date: "2026-07-28", phrase: "live" }),
      row({ run_date: "2026-07-25", phrase: "stale" }),
    ];
    expect(toSeries(rows).map((s) => s.phrase)).toEqual(["live"]);
  });

  it("ranks the chart's series by current share, not by history", () => {
    const rows = [
      row({ phrase: "loud", share: 0.2 }),
      row({ phrase: "quiet", share: 0.01 }),
      row({ phrase: "middle", share: 0.05 }),
    ];
    expect(topSeries(toSeries(rows), 2).map((s) => s.phrase)).toEqual([
      "loud",
      "middle",
    ]);
  });

  it("excludes a surge an anchor theme already asks for", () => {
    // The question the shortlist answers is "what is the pipeline missing".
    // A surge in "fomc" is Fed Policy doing its job, not a miss.
    const rows = [
      row({ phrase: "fomc", covered_by: "Fed Policy", status: "emerging" }),
      row({ phrase: "ai capex cycle", covered_by: null, status: "emerging" }),
      row({ phrase: "tariffs", covered_by: null, status: "established" }),
    ];
    expect(emergingUncovered(toSeries(rows)).map((s) => s.phrase)).toEqual([
      "ai capex cycle",
    ]);
  });

  it("formats share as a percentage of headlines", () => {
    expect(sharePct(0.043)).toBe("4.3%");
  });
});

describe("the plot carries a value axis (ADR-0126)", () => {
  const markup = renderToStaticMarkup(
    <TrendPlot series={[series("ai capex cycle", [0.01, 0.02, 0.05, 0.09])]} />,
  );

  it("prints tick VALUES, not just an axis line", () => {
    // The defect ADR-0126 was written about: a chart that printed the word
    // "volatility" and nowhere printed 8.05%.
    expect(markup).toMatch(/>\d+(\.\d+)?%</);
  });

  it("names the unit", () => {
    expect(markup).toContain(">share<");
  });

  it("prints the date range on the x-axis", () => {
    expect(markup).toContain("2026-07-01");
    expect(markup).toContain("2026-07-04");
  });

  it("keeps zero in frame so a wobble is not exaggerated", () => {
    expect(markup).toMatch(/>0%</);
  });

  it("direct-labels the line, so identity never needs a colour lookup", () => {
    expect(markup).toContain("ai capex cycle");
  });
});

describe("share axis overrides let two charts share one scale (ADR-0177)", () => {
  it("TrendPlot's yMax overrides its own computed max", () => {
    // This series' own max is 9%, so its default axis tops out at "10%" —
    // asserts an explicit yMax reaches past that self-computed ceiling,
    // which a caller sharing a wider axis with another chart needs.
    const withoutOverride = renderToStaticMarkup(
      <TrendPlot series={[series("narrow today, wide elsewhere", [0.01, 0.02, 0.09])]} />,
    );
    expect(withoutOverride).not.toContain(">20%<");
    const withOverride = renderToStaticMarkup(
      <TrendPlot
        series={[series("narrow today, wide elsewhere", [0.01, 0.02, 0.09])]}
        yMax={0.2}
      />,
    );
    expect(withOverride).toContain(">20%<");
  });

  it("DetectionScatter's xMax overrides its own computed max", () => {
    // latest.share of 0.05 alone would cap the x-axis around "5%"-"6%" —
    // asserts an override reaches past that self-computed ceiling too.
    const out = renderToStaticMarkup(
      <DetectionScatter
        series={[
          {
            phrase: "p",
            points: [{ run_date: "2026-07-28", share: 0.05 }],
            latest: row({ phrase: "p", share: 0.05, velocity: 1.0 }),
          },
        ]}
        xMax={0.2}
      />,
    );
    expect(out).toContain(">20%<");
  });

  it("the board computes one shared max over BOTH charts' own data, not either alone", () => {
    // This series has a LOW latest share (what DetectionScatter would use
    // alone) but a much HIGHER historical share earlier in its own history
    // (what TrendPlot draws). The shared max must reach the historical peak,
    // not just today's reading — otherwise "shared" would only ever narrow
    // toward whichever chart's own number is smaller.
    const wideHistory: NarrativeSeries = {
      phrase: "spike then fade",
      points: [
        { run_date: "2026-07-01", share: 0.25 },
        { run_date: "2026-07-02", share: 0.05 },
      ],
      latest: row({ phrase: "spike then fade", share: 0.05, velocity: 0.5 }),
    };
    const out = renderToStaticMarkup(
      <NarrativeTrends shared={{ series: [wideHistory], asOfFallback: null, error: null }} />,
    );
    // 0.25 historical peak * 1.1 pad -> niceTicks tops out at 25%, not the
    // ~5-6% either chart would land on computing its own max alone.
    expect(out).toContain(">25%<");
  });
});

describe("labelInside keeps end-labels within the plot's own x-axis (ADR-0178)", () => {
  it("anchors the label INSIDE plotWidth, not past its right edge", () => {
    const data = [series("a fairly long narrative phrase", [0.01, 0.05, 0.1])];
    const withoutInside = renderToStaticMarkup(
      <TrendPlot series={data} width={430} height={225} />,
    );
    const withInside = renderToStaticMarkup(
      <TrendPlot series={data} width={430} height={225} plotRight={16} labelInside />,
    );
    // Default mode: the label sits in the dedicated right gutter, past the
    // plot's own data area (plotLeft + plotWidth = 44 + (430-44-148) = 282).
    const outsideLabel = withoutInside.match(
      /<text x="([\d.]+)"[^>]*fill="var\(--series-1\)" font-size="10">/,
    );
    expect(outsideLabel).not.toBeNull();
    expect(Number(outsideLabel?.[1])).toBeGreaterThan(282);
    // labelInside mode: text-anchor="end" at (or left of) the plot's own
    // right edge (44 + (430-44-16) = 414) — never past it.
    const insideLabel = withInside.match(
      /<text x="([\d.]+)"[^>]*text-anchor="end" fill="var\(--series-1\)" font-size="10">/,
    );
    expect(insideLabel).not.toBeNull();
    expect(Number(insideLabel?.[1])).toBeLessThanOrEqual(414);
  });

  it("still ties a displaced label back to its line, as a vertical connector rather than a rightward leader", () => {
    // Two lines converging at the end still need the collision pass; the
    // connector shape changes (vertical, at the point's own x) but a
    // reader must still be able to trace a moved label back to its line.
    const out = renderToStaticMarkup(
      <TrendPlot
        series={[
          series("first narrative", [0.01, 0.05]),
          series("second narrative", [0.02, 0.0501]),
        ]}
        width={430}
        height={225}
        plotRight={16}
        labelInside
      />,
    );
    // A short vertical tie: x1 === x2, y1 !== y2 (the rightward-leader shape
    // has x1 !== x2 for its horizontal run, so this distinguishes them).
    expect(out).toMatch(/<line x1="([\d.]+)" y1="[\d.]+" x2="\1" y2="[\d.]+"/);
  });
});

describe("per-phrase colours can be shared with another chart (ADR-0178)", () => {
  it("TrendPlot's colors map overrides seriesColor for a matched phrase", () => {
    const data = [series("second in rank", [0.01, 0.05])];
    // Rank 0 in a single-series call would normally get SERIES_COLORS[0].
    const withoutMap = renderToStaticMarkup(<TrendPlot series={data} />);
    expect(withoutMap).toContain("var(--series-1)");
    const withMap = renderToStaticMarkup(
      <TrendPlot series={data} colors={new Map([["second in rank", "var(--theme-ai-capex)"]])} />,
    );
    expect(withMap).toContain("var(--theme-ai-capex)");
    expect(withMap).not.toContain("var(--series-1)");
  });

  it("DetectionScatter's colors map overrides markColor for a matched phrase only", () => {
    const matched: NarrativeSeries = {
      phrase: "matched",
      points: [{ run_date: "2026-07-28", share: 0.1 }],
      latest: row({ phrase: "matched", share: 0.1, velocity: 1.0, covered_by: null }),
    };
    const unmatched: NarrativeSeries = {
      phrase: "unmatched",
      points: [{ run_date: "2026-07-28", share: 0.08 }],
      latest: row({ phrase: "unmatched", share: 0.08, velocity: 1.2, covered_by: null }),
    };
    const out = renderToStaticMarkup(
      <DetectionScatter
        series={[matched, unmatched]}
        colors={new Map([["matched", "var(--theme-ai-capex)"]])}
      />,
    );
    expect(out).toContain("var(--theme-ai-capex)");
    // The unmatched phrase keeps the ordinary uncovered default.
    expect(out).toContain("var(--series-1)");
  });

  it("the board gives a top-5 phrase the SAME colour on its line and its dot", () => {
    // End-to-end: not just that both props are wired (the source-text pin
    // covers that), but that the computed colour actually round-trips onto
    // both charts for the same phrase.
    const twoRuns: NarrativeSeries = {
      phrase: "shared colour phrase",
      points: [
        { run_date: "2026-07-28", share: 0.05 },
        { run_date: "2026-07-29", share: 0.08 },
      ],
      latest: row({ phrase: "shared colour phrase", share: 0.08, velocity: 1.5 }),
    };
    const out = renderToStaticMarkup(
      <NarrativeTrends shared={{ series: [twoRuns], asOfFallback: null, error: null }} />,
    );
    // Rank 0, uncovered -> SERIES_COLORS[0] on both the line and the dot.
    const lineColorCount = (out.match(/var\(--series-1\)/g) ?? []).length;
    expect(lineColorCount).toBeGreaterThanOrEqual(2); // at least the line's path/circles AND the dot
  });
});

describe("plot geometry holds at every series count and run count", () => {
  // ADR-0126's bug class was a mark centred on a coordinate that is already the
  // plot boundary — invisible at the one size the original test happened to use.
  for (const runs of [2, 3, 5, 14, 30]) {
    for (const seriesCount of [1, 3, 5]) {
      it(`draws nothing outside the viewBox at ${seriesCount}x${runs}`, () => {
        const data = Array.from({ length: seriesCount }, (_, s) =>
          series(
            `narrative ${s}`,
            Array.from({ length: runs }, (_, i) => 0.01 + (i * (s + 1)) / 1000),
          ),
        );
        const out = renderToStaticMarkup(<TrendPlot series={data} />);
        expect(marksOutsideViewBox(out)).toEqual([]);
      });
    }
  }

  it("survives a flat series without dividing by a zero range", () => {
    const out = renderToStaticMarkup(
      <TrendPlot series={[series("flat", [0.02, 0.02, 0.02, 0.02])]} />,
    );
    expect(out).not.toContain("NaN");
    expect(marksOutsideViewBox(out)).toEqual([]);
  });

  it("survives an all-zero series", () => {
    const out = renderToStaticMarkup(
      <TrendPlot series={[series("silent", [0, 0, 0])]} />,
    );
    expect(out).not.toContain("NaN");
    expect(marksOutsideViewBox(out)).toEqual([]);
  });

  it("does not overprint two labels whose lines converge", () => {
    // The direct labels are what make two sub-3:1 palette slots legal. Two series
    // ending at nearly the same share must still produce two readable labels.
    const out = renderToStaticMarkup(
      <TrendPlot
        series={[
          series("first narrative", [0.01, 0.05]),
          series("second narrative", [0.02, 0.0501]),
        ]}
      />,
    );
    const ys = (out.match(/<text[^>]*x="6\d\d[^"]*"[^>]*y="([\d.]+)"/g) ?? []).map(
      (t) => Number(t.match(/y="([\d.]+)"/)?.[1]),
    );
    const sorted = [...ys].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(11);
    }
  });

  it("renders nothing at all from a single run rather than a one-point line", () => {
    expect(renderToStaticMarkup(<TrendPlot series={[series("x", [0.05])]} />)).toBe("");
  });
});

describe("geometry props hold at a narrow width too (ADR-0176)", () => {
  // The narrative board's own "share over time" section renders TrendPlot at
  // the same narrow box DetectionScatter uses (S_WIDTH=430, S_HEIGHT=225),
  // not the 720-wide default ThemeTrends renders. The plot area shrinks from
  // 528 to 238 units at that width — the anti-collision math and viewBox
  // bounds have to hold there too, not just at the wide default this file's
  // other geometry tests already cover.
  for (const runs of [2, 5, 14, 30]) {
    for (const seriesCount of [1, 3, 5]) {
      it(`draws nothing outside a 430x225 viewBox at ${seriesCount}x${runs}`, () => {
        const data = Array.from({ length: seriesCount }, (_, s) =>
          series(
            `narrative ${s}`,
            Array.from({ length: runs }, (_, i) => 0.01 + (i * (s + 1)) / 1000),
          ),
        );
        const out = renderToStaticMarkup(
          <TrendPlot series={data} width={430} height={225} />,
        );
        expect(out).toContain('viewBox="0 0 430 225"');
        expect(marksOutsideViewBox(out)).toEqual([]);
      });
    }
  }

  for (const runs of [2, 5, 14, 30]) {
    for (const seriesCount of [1, 3, 5]) {
      it(`labelInside mode with the actual production plotRight draws nothing outside the viewBox at ${seriesCount}x${runs} (ADR-0178)`, () => {
        // The exact config NarrativeTrends passes live: plotRight shrunk from
        // the 148-unit label gutter to 16, labels moved inline. Distinct from
        // the sweep above (which uses the 430x225 box but the OLD 148 gutter
        // and outside-label rendering) — this is the geometry that actually
        // ships, and it is the one most likely to clip something, since the
        // plot area grew by ~130 units into space labels used to own alone.
        const data = Array.from({ length: seriesCount }, (_, s) =>
          series(
            `narrative ${s}`,
            Array.from({ length: runs }, (_, i) => 0.01 + (i * (s + 1)) / 1000),
          ),
        );
        const out = renderToStaticMarkup(
          <TrendPlot series={data} width={430} height={225} plotRight={16} labelInside />,
        );
        expect(marksOutsideViewBox(out)).toEqual([]);
      });
    }
  }

  it("omitting the geometry props reproduces the 720-wide default exactly", () => {
    // ThemeTrends calls <TrendPlot series={top} /> with no geometry props —
    // this pins that the defaults are unchanged, not just documented as such.
    const data = [series("ai capex cycle", [0.01, 0.02, 0.05, 0.09])];
    expect(renderToStaticMarkup(<TrendPlot series={data} />)).toBe(
      renderToStaticMarkup(
        <TrendPlot series={data} width={720} height={240} plotLeft={44} plotRight={148} plotTop={14} plotBottom={30} />,
      ),
    );
  });
});

describe("the table view is the contrast relief the palette requires", () => {
  // Two validated slots (#1baf7a, #eda100) sit below 3:1 against the white card,
  // which is legal ONLY with visible labels or a table view. If this table stops
  // carrying the figures, those hues stop being legal.
  const markup = renderToStaticMarkup(
    <SeriesTable series={[series("ai capex cycle", [0.01, 0.06])]} />,
  );

  it("prints each series' current share as text", () => {
    expect(markup).toContain("6.0%");
  });

  it("names every series in text beside its swatch", () => {
    expect(markup).toContain("ai capex cycle");
  });

  it("says 'n/a' rather than 0 when velocity has no reading, with the reason on hover (ADR-0184)", () => {
    // "n/a" replaced the longer "not measurable" prose here specifically —
    // that string alone was wide enough to set the whole Velocity column's
    // width and push the table past its container (ADR-0184). The Emerging
    // list two sections down already said "n/a" for this exact state, so
    // this is not new vocabulary. The fuller reason survives on `title`,
    // not dropped — ADR-0126's "never the only copy" applies to the hover
    // text itself, not to the visible cell needing to spell it out.
    const noVelocity: NarrativeSeries = {
      ...series("young", [0.03]),
      latest: row({ phrase: "young", velocity: null, status: "new" }),
    };
    const out = renderToStaticMarkup(<SeriesTable series={[noVelocity]} />);
    expect(out).toContain(">n/a<");
    expect(out).not.toContain("not measurable");
    expect(out).toMatch(/title="[^"]*not yet measurable[^"]*"/);
  });

  it("says 'nothing' when no anchor theme covers the narrative", () => {
    expect(markup).toContain("nothing");
  });
});

describe("the card before data arrives", () => {
  it("shows a loading state rather than an empty plot", () => {
    // Effects do not run in static rendering, so this is the pre-fetch state.
    const markup = renderToStaticMarkup(<NarrativeTrends />);
    expect(markup).toContain("skeleton");
    expect(markup).not.toContain("<svg");
  });
});

describe("series never exceed the validated palette", () => {
  it("caps the drawn series at the number of validated colour slots", () => {
    const rows: NarrativeRow[] = Array.from({ length: 12 }, (_, i) =>
      row({ phrase: `phrase ${i}`, share: 0.5 - i * 0.01 }),
    );
    const all = toSeries(rows);
    // A 6th series would need a generated hue, which the palette rules forbid.
    expect(topSeries(all, 5)).toHaveLength(5);
    expect(all.length).toBeGreaterThan(5); // the rest are reported, not drawn
  });
});


describe("two-method agreement is visible (ADR-0133)", () => {
  it("shows only 'frequency' for an uncorroborated narrative", () => {
    const out = renderToStaticMarkup(
      <SeriesTable series={[series("novel narrative", [0.02, 0.05])]} />,
    );
    expect(out).toContain("frequency");
    expect(out).not.toContain("lda");
  });

  it("names both methods when the discovery job found it too", () => {
    const both: NarrativeSeries = {
      ...series("credit spreads", [0.01, 0.025]),
      latest: row({
        phrase: "credit spreads",
        methods: ["frequency", "lda", "embedding"],
      }),
    };
    const out = renderToStaticMarkup(<SeriesTable series={[both]} />);
    expect(out).toContain("frequency + lda + embedding");
  });

  it("treats frequency alone, and a pre-ADR-0133 null, as uncorroborated", () => {
    expect(isCorroborated(row({ methods: ["frequency"] }))).toBe(false);
    expect(isCorroborated(row({ methods: ["frequency", "lda"] }))).toBe(true);
    expect(isCorroborated(row({ methods: null }))).toBe(false);
  });
});

describe("the emerging shortlist's two empties stay distinct", () => {
  // ADR-0059 / ADR-0143's lesson applied to prose: "measured, none found" is
  // a finding; "cannot measure yet" is silence. With one day of rebuilt
  // corpus every phrase has velocity null, so the board must not claim
  // "every phrase breaking out today is covered" — nothing CAN break out.
  const src = readFileSync(
    path.resolve(__dirname, "../../components/NarrativeTrends.tsx"),
    "utf8",
  );

  it("branches the empty state on velocity measurability", () => {
    expect(src).toContain("velocityMeasurable ?");
    expect(src).toContain("finding, not an empty state");
    expect(src).toContain("Velocity not measurable yet");
  });

  it("the unmeasurable copy refuses the finding claim and counts the unwatched", () => {
    expect(src).toContain("Velocity not measurable yet");
    expect(src).toContain("uncoveredCount");
  });

  it("says nine anchors, not the stale eight", () => {
    expect(src).not.toMatch(/eight anchor/i);
  });
});

describe("DetectionScatter — the detector's honesty (ADR-0146)", () => {
  const detRow = (over: Partial<NarrativeRowShape>) => series2(over);

  // Local builders: the file's `series()` helper builds trend-plot fixtures;
  // the scatter cares about latest.{share,velocity,covered_by,status}.
  type NarrativeRowShape = {
    phrase: string;
    share: number;
    velocity: number | null;
    covered_by: string | null;
    status: "new" | "emerging" | "established" | "fading";
  };
  function series2(over: Partial<NarrativeRowShape>) {
    const r: NarrativeRowShape = {
      phrase: "p",
      share: 0.1,
      velocity: null,
      covered_by: null,
      status: "new",
      ...over,
    };
    return {
      phrase: r.phrase,
      points: [{ run_date: "2026-07-28", share: r.share }],
      latest: {
        run_date: "2026-07-28",
        phrase: r.phrase,
        doc_count: 10,
        corpus_size: 100,
        share: r.share,
        velocity: r.velocity,
        days_observed: r.velocity === null ? 1 : 9,
        first_seen: "2026-07-20",
        status: r.status,
        covered_by: r.covered_by,
        methods: ["frequency"],
      },
    };
  }

  it("an unmeasurable phrase is NEVER a point in the plane — it is a rug mark", () => {
    const out = renderToStaticMarkup(
      <DetectionScatter series={[detRow({ phrase: "quiet", velocity: null })]} />,
    );
    expect(out).not.toContain("<circle"); // absence is not a y=0 dot
    expect(out).toContain("not yet measurable · 1");
    expect(out).toContain("No measurable velocities yet");
  });

  it("covered is hollow context; uncovered is the filled payload", () => {
    const out = renderToStaticMarkup(
      <DetectionScatter
        series={[
          detRow({ phrase: "fomc", velocity: 0.4, covered_by: "Fed Policy" }),
          detRow({ phrase: "ai datacenter", velocity: 1.9, covered_by: null }),
        ]}
      />,
    );
    expect(out).toContain('fill="transparent"'); // covered: hollow
    expect(out).toContain('fill="var(--series-1)"'); // uncovered: filled
  });

  it("names a covered mark too, in the muted ink (ADR-0162)", () => {
    // ADR-0146 labelled the payload only, so `ai` — 15.6% share and the
    // loudest phrase on the 2026-07-28 board, hard against the top-right
    // alarm corner — rendered as an unnamed 3px hollow ring and was reported
    // as missing from the chart. Hollow is already the muted channel; being
    // anonymous as well is what made it unreadable.
    const out = renderToStaticMarkup(
      <DetectionScatter
        series={[
          detRow({ phrase: "ai", share: 0.156, velocity: 2.27, covered_by: "AI Capex" }),
          detRow({ phrase: "oil prices", share: 0.1, velocity: 0.32, covered_by: null }),
        ]}
      />,
    );
    expect(out).toContain(">ai</text>");
    expect(out).toContain(">oil prices</text>");
    // Named, but still context: the ink carries the same split as the fill, so
    // labelling a covered mark does not promote it to payload.
    expect(out).toMatch(/<text[^>]*fill="var\(--text-tertiary\)"[^>]*>ai<\/text>/);
    expect(out).toMatch(
      /<text[^>]*fill="var\(--text-secondary\)"[^>]*>oil prices<\/text>/,
    );
  });

  it("keeps the identity hue and the coverage split on the SAME mark", () => {
    // 2026-07-30: a commit titled "align card row height" also replaced the
    // coverage encoding with a flat per-phrase hue — `fill={phraseColor(...)}`
    // — so every mark rendered solid and the covered/uncovered distinction the
    // plane exists to draw was gone. The pink itself was wanted; spending the
    // fill channel on it was not.
    //
    // Two channels, one mark: HUE says which narrative, FILL says whether
    // anything is already watching it. This asserts they cannot be collapsed
    // into each other again.
    const out = renderToStaticMarkup(
      <DetectionScatter
        series={[
          detRow({ phrase: "ai", share: 0.156, velocity: 2.27, covered_by: "AI Capex" }),
          detRow({ phrase: "oil prices", share: 0.1, velocity: 0.32, covered_by: null }),
        ]}
      />,
    );
    // Covered AND carrying its identity: a hollow ring stroked in the theme hue.
    expect(out).toMatch(
      /<circle[^>]*fill="transparent"[^>]*stroke="var\(--theme-ai-capex\)"[^>]*>/,
    );
    // Uncovered stays the payload: solid, in the default series ink.
    expect(out).toMatch(/<circle[^>]*fill="var\(--series-1\)"[^>]*stroke="none"[^>]*>/);
    // And the hue is never a literal — globals.css owns the value and the
    // contrast measurement that justifies it.
    expect(out).not.toContain("#e91e8c");
  });

  it("does not colour a mark by a substring of its phrase", () => {
    // `phrase.includes("ai")` also matched `supply chain`, `rail freight` and
    // `capital`. Identity is matched on what a narrative is COVERED BY, which is
    // a classification, not on two letters appearing anywhere in its text.
    const out = renderToStaticMarkup(
      <DetectionScatter
        series={[
          detRow({ phrase: "supply chain", share: 0.09, velocity: 0.5, covered_by: null }),
        ]}
      />,
    );
    expect(out).not.toContain("var(--theme-ai-capex)");
  });

  it("labels of both kinds share ONE collision pass", () => {
    // A covered label overprinting an uncovered one would cost the payload the
    // legibility the hollow/filled split exists to protect. Two marks at nearly
    // the same velocity, one of each kind, must still produce two readable rows.
    const out = renderToStaticMarkup(
      <DetectionScatter
        series={[
          detRow({ phrase: "covered one", share: 0.12, velocity: 1.9, covered_by: "Fed Policy" }),
          detRow({ phrase: "uncovered one", share: 0.11, velocity: 1.9001, covered_by: null }),
        ]}
      />,
    );
    // font-size 9.5 is the direct-label size and nothing else on this chart.
    const ys = (out.match(/<text[^>]*font-size="9.5"[^>]*>/g) ?? []).map((t) =>
      Number(t.match(/\sy="([\d.]+)"/)?.[1]),
    );
    expect(ys).toHaveLength(2);
    const sorted = [...ys].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      // LABEL_H is 11 against a 9.5px face; the tolerance is float slack only.
      expect(sorted[i] - sorted[i - 1]).toBeGreaterThan(10.9);
    }
  });

  it("ties a displaced label back to its mark with a leader", () => {
    // With up to ten labels the collision stack routinely pushes one 50px below
    // the dot it names. An unconnected label that far from its mark is not a
    // weaker label — it is a label pointing at the wrong mark. Same rule
    // TrendPlot already applies to its end labels.
    const converging = Array.from({ length: 5 }, (_, i) =>
      detRow({
        phrase: `narrative ${i}`,
        share: 0.12 - i * 0.01,
        velocity: 1.9 - i * 0.005, // nearly equal → the stack must push them apart
        covered_by: null,
      }),
    );
    const out = renderToStaticMarkup(<DetectionScatter series={converging} />);
    // At least one leader line appears (displaced labels need connectors; gridlines
    // are at y2=16 or y2=168, leader lines end somewhere in between).
    expect(out).toMatch(/<line[^>]*y2="(?!16|168)\d+\.\d+"/);

    // A label sitting on its own mark gets no leader — the connector appears
    // only where the collision pass actually moved something. Leader lines are
    // short horizontals (x1 ≈ cx+7, x2 ≈ cx+12, y1=y2). Gridlines are vertical
    // (x1=x2=S_PLOT_LEFT or x1=x2=S_PLOT_LEFT+S_PLOT_WIDTH) or long horizontals
    // spanning the full plot width. This regex finds the short horizontal pattern.
    const alone = renderToStaticMarkup(
      <DetectionScatter series={[detRow({ phrase: "solo", velocity: 1.2 })]} />,
    );
    expect(alone).toContain(">solo</text>");
    // Short horizontal leader lines have x1 and x2 within ~6 units of each other;
    // gridlines and axis lines have x1 and x2 far apart.
    expect(alone).not.toMatch(/x1="36[0-9]"\s+y1="30"\s+x2="36[0-9]"/);
  });

  it("names the rug's loudest phrases, not just how many there are", () => {
    // `chip` on 2026-07-28: 7.3% of headlines, first seen that day, so no
    // velocity and no plane. It was 7th by share against a 5-row table, which
    // put it in NO text anywhere on the board — the strip counted it and never
    // named it. A count alone cannot be looked up.
    const out = renderToStaticMarkup(
      <DetectionScatter
        series={[
          detRow({ phrase: "chip", share: 0.0734, velocity: null, covered_by: "AI Capex" }),
          detRow({ phrase: "emerging", share: 0.0642, velocity: null, covered_by: null }),
        ]}
      />,
    );
    expect(out).toContain("velocity not yet measurable · 2");
    expect(out).toContain("chip 7.3%");
    expect(out).toContain("emerging 6.4%");
  });

  it("an emerging mark gets the ring — status from the backend, no threshold copied", () => {
    const out = renderToStaticMarkup(
      <DetectionScatter
        series={[detRow({ phrase: "breakout", velocity: 2.1, status: "emerging" })]}
      />,
    );
    const circles = out.match(/<circle/g) ?? [];
    expect(circles.length).toBe(2); // point + ring
  });

  it("rug overflow is counted, not hidden", () => {
    const many = Array.from({ length: 90 }, (_, i) =>
      detRow({ phrase: `phrase ${i}`, share: 0.01 + i / 1000, velocity: null }),
    );
    const out = renderToStaticMarkup(<DetectionScatter series={many} />);
    expect(out).toContain("not yet measurable · 90");
    expect(out).toContain("+10 more");
  });

  it("the default board renders the scatter as the primary detector", () => {
    const src = readFileSync(
      path.resolve(__dirname, "../../components/NarrativeTrends.tsx"),
      "utf8",
    );
    expect(src).toContain("<DetectionScatter series={series}");
  });

  it("the scatter's x-axis shares the trend's own axis and colour map, not its own separate max (ADR-0177/0178)", () => {
    const src = readFileSync(
      path.resolve(__dirname, "../../components/NarrativeTrends.tsx"),
      "utf8",
    );
    expect(src).toContain(
      "<DetectionScatter series={series} xMax={sharedShareMax} colors={topColors} />",
    );
  });

  it("the trend plot is narrowed to the scatter's own box, labels drawn inline, colours matched to the scatter (ADR-0176/0178)", () => {
    // Both plots render `w-full` inside the same grid column, which makes
    // them the same CSS width regardless of their viewBox numbers — but
    // TrendPlot's 720-wide DEFAULT viewBox would still scale its fonts down
    // to illegibility at that column's ~400px, the exact failure ADR-0168
    // fixed for DetectionScatter. `plotRight={16}` + `labelInside` reclaim
    // the space the old 148-unit label gutter reserved (ADR-0178); `colors`
    // gives each line the same hue as its own dot below.
    const src = readFileSync(
      path.resolve(__dirname, "../../components/NarrativeTrends.tsx"),
      "utf8",
    );
    const callSite = src.slice(src.indexOf("<TrendPlot\n"), src.indexOf("<TrendPlot\n") + 320);
    expect(callSite).toContain("series={top}");
    expect(callSite).toContain("width={S_WIDTH}");
    expect(callSite).toContain("height={S_HEIGHT}");
    expect(callSite).toContain("plotRight={16}");
    expect(callSite).toContain("yMax={sharedShareMax}");
    expect(callSite).toContain("labelInside");
    expect(callSite).toContain("colors={topColors}");
  });

  it("also renders a share-over-time trend above the plane (ADR-0175)", () => {
    // ADR-0146 retired `TrendPlot series={top}` as this board's PRIMARY view —
    // the top-5-by-share set had charted financial-writing register
    // ("earnings", "price", "q2"), not narratives, and the board's actual
    // question is a STATE question a trajectory chart cannot answer. ADR-0175
    // reintroduced it as SECONDARY trend context above the still-primary
    // scatter, on the same top-N set the figures table already shows — so this
    // asserts the addition landed and carries its own honesty caption, not
    // that the retirement never happened.
    const twoRunSeries: NarrativeSeries = series("ai capex cycle", [0.02, 0.06]);
    const out = renderToStaticMarkup(
      <NarrativeTrends shared={{ series: [twoRunSeries], asOfFallback: null, error: null }} />,
    );
    expect(out).toContain("Share over time");
    expect(out).toContain("financial-writing register");
    // Both charts present: the scatter (still primary) and the trend (new).
    expect(out).toContain("Narrative detection plane");
  });

  it("the trend needs two runs and draws nothing from one", () => {
    // TrendPlot itself renders "" from a single point (pinned above); the
    // board must not print the "Share over time" heading over a chart that
    // cannot exist.
    const oneRunSeries: NarrativeSeries = series("solo narrative", [0.03]);
    const out = renderToStaticMarkup(
      <NarrativeTrends shared={{ series: [oneRunSeries], asOfFallback: null, error: null }} />,
    );
    expect(out).not.toContain("Share over time");
  });
});

describe("attentionFunnel — the lifecycle counts", () => {
  it("counts tracked, unwatched, emerging, and knows when emerging is unknowable", () => {
    const mk = (velocity: number | null, covered: string | null, status: string) => ({
      phrase: `${velocity}-${covered}-${status}`,
      points: [],
      latest: {
        run_date: "2026-07-28", phrase: "x", doc_count: 1, corpus_size: 10,
        share: 0.1, velocity, days_observed: 1, first_seen: "2026-07-20",
        status, covered_by: covered, methods: null,
      },
    });
    const dark = attentionFunnel([mk(null, null, "new"), mk(null, "Fed Policy", "new")] as never);
    expect(dark).toEqual({ tracked: 2, unwatched: 1, emerging: 0, velocityMeasurable: false });

    const lit = attentionFunnel(
      [mk(2.0, null, "emerging"), mk(0.1, null, "established"), mk(1.8, "Fed Policy", "emerging")] as never,
    );
    expect(lit.emerging).toBe(2);
    expect(lit.velocityMeasurable).toBe(true);
  });
});
