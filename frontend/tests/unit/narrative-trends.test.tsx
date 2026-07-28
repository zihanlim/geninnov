import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  emergingUncovered,
  sharePct,
  topSeries,
  toSeries,
  type NarrativeRow,
  type NarrativeSeries,
} from "@/lib/narratives";
import NarrativeTrends, {
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

  it("says 'not measurable' rather than 0 when velocity has no reading", () => {
    const noVelocity: NarrativeSeries = {
      ...series("young", [0.03]),
      latest: row({ phrase: "young", velocity: null, status: "new" }),
    };
    const out = renderToStaticMarkup(<SeriesTable series={[noVelocity]} />);
    expect(out).toContain("not measurable");
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
