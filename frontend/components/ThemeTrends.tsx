"use client";

// frontend/components/ThemeTrends.tsx
//
// The anchor themes' attention over time — the Google-Trends view of the NINE
// named themes, beside NarrativeTrends' view of the phrases nobody named.
//
// Same chart contract as the narrative board (ADR-0126): a value axis, direct
// end-labels with leader lines, and a figures table that is the relief for the
// two low-contrast palette slots. The PLOT IS SHARED — `TrendPlot` from
// NarrativeTrends renders both boards, so a geometry fix lands on each at once
// (ADR-0064 applied to chart code). Five colour slots, fixed order, no sixth:
// themes past the fifth live in the table, not in a generated hue.
//
// The metric's honesty note lives in the caption and in lib/themeTrends.ts:
// this is relative attention AMONG the anchors (each theme is counted by its
// own query), not share of an unbiased corpus — that claim belongs to the
// narrative board (ADR-0141), and this board deliberately does not make it.

import { useEffect, useState } from "react";
import { SERIES_COLORS, seriesColor, TrendPlot } from "@/components/NarrativeTrends";
import {
  MIN_DAY_MENTIONS_FOR_SHARE,
  fetchThemeTrends,
  latestSampleShortfall,
  themeSharePct,
  topThemeSeries,
  toThemeTrendSeries,
  type ThemeTrendSeries,
} from "@/lib/themeTrends";

export function ThemeTrendsTable({ series }: { series: ThemeTrendSeries[] }) {
  // The day these figures are actually FROM. When the newest run is too thin to
  // carry a share it becomes a gap (MIN_DAY_MENTIONS_FOR_SHARE), and the table
  // then shows the last day that qualified. Heading it "Share today" would
  // assert a date the numbers do not have — the same mislabel ADR-0159 fixed on
  // the narrative plane, where the header read "run 2026-07-29" over a plot of
  // 07-27.
  const asOf =
    series.find((s) => s.points.length > 0)?.points.slice(-1)[0]?.run_date ?? null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11.5px] border-collapse">
        <thead>
          <tr className="text-text-tertiary text-left">
            <th className="font-normal py-1 pr-3">Theme</th>
            <th className="font-normal py-1 pr-3 text-right">
              {asOf ? <>Share &middot; <span className="num">{asOf}</span></> : "Share"}
            </th>
            <th className="font-normal py-1 pr-3 text-right">Mentions</th>
            <th className="font-normal py-1 text-right">&Delta; vs prior run</th>
          </tr>
        </thead>
        <tbody>
          {series.map((s, i) => (
            <tr key={s.phrase} className="border-t border-border align-top">
              <td className="py-1 pr-3">
                <span className="inline-flex items-center gap-1.5">
                  {/* Only the five plotted series get a dot; a sixth rotation
                      hue does not exist, so a sixth row simply has no dot. AI
                      Capex is forced into the chart and carries its own fixed
                      identity hue, so it gets one at any rank — which is the
                      case `seriesColor` exists to keep in one place. */}
                  {i < SERIES_COLORS.length || s.phrase === "AI Capex" ? (
                    <span
                      aria-hidden="true"
                      className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ background: seriesColor(s.phrase, i) }}
                    />
                  ) : (
                    <span className="inline-block w-2.5 h-2.5 shrink-0" aria-hidden="true" />
                  )}
                  <span className="text-text-primary">{s.phrase}</span>
                </span>
              </td>
              <td className="py-1 pr-3 text-right num">{themeSharePct(s.latest.share)}</td>
              <td className="py-1 pr-3 text-right num">
                {s.latest.mentions === null ? (
                  <span className="text-text-tertiary">not reported</span>
                ) : (
                  s.latest.mentions
                )}
              </td>
              <td className="py-1 text-right num">
                {s.latest.delta === null ? (
                  <span className="text-text-tertiary">—</span>
                ) : (
                  `${s.latest.delta >= 0 ? "+" : ""}${(s.latest.delta * 100).toFixed(1)}pp`
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ThemeTrends() {
  const [series, setSeries] = useState<ThemeTrendSeries[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Why the latest day carries no share, when it carries none. Held separately
  // from `series` because the reason is a property of the DAY, not of a theme.
  const [thin, setThin] = useState<{ run_date: string; total: number } | null>(null);

  useEffect(() => {
    fetchThemeTrends().then(({ rows, error }) => {
      if (error) {
        setError(error);
        return;
      }
      setSeries(toThemeTrendSeries(rows));
      setThin(latestSampleShortfall(rows));
    });
  }, []);

  const top = series ? topThemeSeries(series, SERIES_COLORS.length, ["AI Capex"]) : [];
  const runs = series
    ? new Set(series.flatMap((s) => s.points.map((p) => p.run_date))).size
    : 0;
  const dropped = series ? Math.max(0, series.length - top.length) : 0;

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Theme trends</span>
        <span className="text-[10.5px] text-text-tertiary">
          share of theme-news mentions · {runs} runs
        </span>
      </div>
      <div className="p-4 pt-3">
        <p className="m-0 mb-3 text-[12px] text-text-secondary leading-[1.6]">
          Each anchor theme&rsquo;s share of the day&rsquo;s theme-news mentions —
          relative attention among the nine anchors, since every theme is counted by
          its own query. Not a share of an unbiased corpus: that claim belongs to
          the narrative board above (ADR-0141). A missing day is a gap, never a zero.
        </p>

        {thin && (
          <p className="m-0 mb-3 text-[12px] text-text-secondary leading-[1.6] border-l-2 border-border pl-3">
            The {thin.run_date} run collected{" "}
            <span className="num">{thin.total}</span>{" "}
            same-day {thin.total === 1 ? "mention" : "mentions"} across all nine
            themes, below the {MIN_DAY_MENTIONS_FOR_SHARE} a share is reported
            from. That day is a <strong>gap</strong> in the lines below, not a set
            of zeros — at this sample one article moves a theme&rsquo;s share by{" "}
            <span className="num">
              {(100 / Math.max(thin.total, 1)).toFixed(0)}pp
            </span>
            , so the figures would describe the sample rather than the news.
          </p>
        )}

        {/* Chart ‖ figures, 2fr / 1fr. `items-start` so the shorter column does not
            stretch, and `min-w-0` on both because a grid item defaults to
            min-width:auto and refuses to shrink below its content — without it the
            table's own `overflow-x-auto` never engages and the CARD scrolls instead.

            Gated at `figures` (1248px), matching the narrative board so the two
            cards in this section split at the same width — the gate is derived from
            THAT board's seven-column table, which is the binding constraint of the
            pair (this table is four columns and fits in 297px).

            The old `wide` gate was justified here by the plot's direct end labels,
            but that misread the geometry: TrendPlot is a viewBox, so a narrower
            column scales labels and lines by the SAME factor and they can never
            collide. What narrowing costs is label SIZE — 10px of a 720-unit box
            renders ~11px at the 765px 2fr column this gate produces. Below the gate
            both stack as before. */}
        <div className="grid figures:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-5 items-start [&>*]:min-w-0">
          <div>
            {error ? (
              <div className="text-[12.5px] text-text-secondary leading-[1.6]">
                theme_signals_history could not be read:{" "}
                <span className="num">{error}</span>
              </div>
            ) : series === null ? (
              <div className="skeleton h-[240px]" />
            ) : runs < 2 ? (
              <div className="text-[12.5px] text-text-secondary leading-[1.6]">
                Only {runs === 1 ? "one run" : "no runs"} of theme history so far — a
                trend needs two. The table beside this carries today&rsquo;s readings;
                the lines arrive with tomorrow&rsquo;s run.
              </div>
            ) : (
              <>
                <TrendPlot series={top} />
                {dropped > 0 && (
                  <p className="m-0 mt-1 text-[11px] text-text-tertiary leading-[1.5]">
                    Top {top.length} by today&rsquo;s share drawn — the palette has
                    five validated slots and a sixth hue would be a guess. All{" "}
                    {series.length} themes are in the table.
                  </p>
                )}
              </>
            )}
          </div>

          {series !== null && series.length > 0 && (
            <ThemeTrendsTable series={series} />
          )}
        </div>
      </div>
    </div>
  );
}
