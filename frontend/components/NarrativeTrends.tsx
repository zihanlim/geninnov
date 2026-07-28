"use client";

// frontend/components/NarrativeTrends.tsx
//
// The trends board: share of voice per narrative, over time (ADR-0128).
//
// This is the Google-Trends-shaped view of the attention signal, over phrases
// NOBODY NAMED IN ADVANCE. The anchor themes (nine since migration 050) have
// had a time series since migration 001; what they never had is a peer group. A phrase here arrived
// because the market news was about it, so the chart can show a narrative the
// pipeline is not watching next to one it is.
//
// Three constraints this file is written against:
//
// 1. ADR-0126 — every chart carries a VALUE AXIS, and a tooltip is never the only
//    copy of a number. So: gridlines with tick labels, every line direct-labelled
//    at its right end, and a table underneath carrying each series' current
//    figure. The <title> tooltips are an enhancement on top of that, never the
//    record.
//
// 2. The palette is VALIDATED, not chosen. `#2a78d6,#eb6834,#1baf7a,#eda100,
//    #4a3aa7` passes lightness, chroma, CVD separation (worst adjacent pair
//    ΔE 9.1 protan) and normal-vision separation (ΔE 22.9) against this app's
//    white card surface. Two slots carry a CONTRAST warning below 3:1, which
//    obligates visible labels or a table view — both are present below, which is
//    what makes those two hues legal here.
//
//    The app's own --long/--short are deliberately NOT used: ADR-0126 measured
//    them at ΔE 6.1 under deuteranopia, and they already mean direction
//    everywhere else in this app. A narrative has no direction.
//
// 3. ADR-0054 — a daily publication, not a scanner. No filter panel, no query
//    composition, no realtime. The machine picks the series; the reader reads it.

import { useEffect, useState } from "react";
import {
  emergingUncovered,
  fetchNarratives,
  isCorroborated,
  sharePct,
  topSeries,
  toSeries,
  type NarrativeSeries,
  type NarrativeStatus,
} from "@/lib/narratives";

const WIDTH = 720;
const HEIGHT = 240;
const PLOT_LEFT = 44;
// Wide enough for a direct end-label PLUS the leader-line gutter that ties a
// displaced label back to its line. The alternative is identity-by-colour-only,
// which the contrast warning above forbids.
const PLOT_RIGHT = 148;
/** Horizontal run of the leader before it turns toward the label. */
const LEADER_RUN = 14;
/** Where label text starts, measured from the right edge of the plot. */
const LABEL_X = LEADER_RUN + 6;
const PLOT_TOP = 14;
const PLOT_BOTTOM = 30;
const PLOT_WIDTH = WIDTH - PLOT_LEFT - PLOT_RIGHT;
const PLOT_HEIGHT = HEIGHT - PLOT_TOP - PLOT_BOTTOM;

/** Validated categorical slots, assigned in FIXED order and never cycled.
 *  Read as tokens, not hex: the values, their validation record and the reason
 *  they are not --long/--short all live in globals.css beside the rest of the
 *  palette. A sixth series would need a generated hue, so there is no sixth.
 *  Exported for ThemeTrends, which draws on the SAME five slots — a second
 *  palette would be a second thing to validate. */
export const SERIES_COLORS = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
  "var(--series-5)",
];

/** The minimal shape TrendPlot needs. NarrativeSeries satisfies it structurally;
 *  ThemeTrends supplies its own. One plot implementation for both boards —
 *  ADR-0064's one-formula-one-place, applied to chart geometry, so an axis or
 *  label-collision fix lands on every trends board at once. */
export interface TrendSeries {
  phrase: string;
  points: Array<{ run_date: string; share: number }>;
}

const STATUS_COPY: Record<NarrativeStatus, string> = {
  new: "too little history to judge",
  emerging: "young and accelerating",
  established: "present, not breaking out",
  fading: "decelerating against its own history",
};

/** Rounded tick values across [min, max]; 1/2/5 x 10^n steps. Mirrors the
 *  helper in RiskCharts so both boards tick the same way. */
function niceTicks(min: number, max: number, target = 4): number[] {
  if (!(max > min)) return [min];
  const raw = (max - min) / Math.max(1, target);
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const normalised = raw / magnitude;
  const step = (normalised >= 5 ? 5 : normalised >= 2 ? 2 : 1) * magnitude;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) {
    // Snap a floating-point near-zero to exact 0, so the baseline tick reads "0%"
    // rather than "-0%" and the zero gridline is drawn at full opacity.
    out.push(Math.abs(v) < step * 1e-6 ? 0 : v);
  }
  return out;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(Math.max(v, lo), hi);
}

/** Exported for test: the geometry is the part ADR-0126's bug class lives in, and
 *  a test that cannot render the plot can only assert on source text. */
export function TrendPlot({ series }: { series: TrendSeries[] }) {
  // One shared date axis across every series, so two lines at the same x are the
  // same day. Building each line against its own point count would compress a
  // sparse series to fill the plot and make it look denser than it is.
  const dates = Array.from(
    new Set(series.flatMap((s) => s.points.map((p) => p.run_date))),
  ).sort();
  if (dates.length < 2) return null;

  const xIndex = new Map(dates.map((d, i) => [d, i]));
  const maxShare = Math.max(...series.flatMap((s) => s.points.map((p) => p.share)));
  // Zero is always in frame: share of voice is a proportion of a fixed whole, and
  // a y-axis floating above zero would exaggerate every wobble.
  const yMax = maxShare > 0 ? maxShare * 1.1 : 0.01;
  const ticks = niceTicks(0, yMax, 4);

  const x = (d: string) =>
    PLOT_LEFT + ((xIndex.get(d) ?? 0) / (dates.length - 1)) * PLOT_WIDTH;
  const y = (v: number) =>
    PLOT_TOP + PLOT_HEIGHT - clamp(v / yMax, 0, 1) * PLOT_HEIGHT;

  // Label collision: end-labels are placed at each line's last point, then pushed
  // apart top-down so two near-identical finals do not overprint. Without this the
  // direct labels — the thing that makes the low-contrast hues legal — become
  // unreadable exactly when two series converge.
  const LABEL_H = 12;
  const ends = series
    .map((s, i) => {
      const last = s.points[s.points.length - 1];
      return { i, phrase: s.phrase, share: last.share, yRaw: y(last.share) };
    })
    .sort((a, b) => a.yRaw - b.yRaw);
  let prevY = -Infinity;
  for (const e of ends) {
    const placed = Math.max(e.yRaw, prevY + LABEL_H);
    prevY = placed;
    (e as { yLabel?: number }).yLabel = clamp(placed, PLOT_TOP + 6, HEIGHT - 6);
  }
  const labelY = new Map(ends.map((e) => [e.i, (e as { yLabel?: number }).yLabel ?? e.yRaw]));

  // Decimal places come from the tick STEP, not from each value. Choosing per
  // value printed the baseline as "0.0%" beside siblings reading "2%" and "4%" —
  // an axis whose own labels disagree about precision reads as two axes.
  const step = ticks.length > 1 ? Math.abs(ticks[1] - ticks[0]) : yMax;
  const digits = step * 100 >= 1 ? 0 : 1;
  const tickLabel = (v: number) => `${(v * 100).toFixed(digits)}%`;
  const firstDate = dates[0];
  const lastDate = dates[dates.length - 1];

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="w-full h-auto"
      role="img"
      aria-label={`Share of voice over ${dates.length} runs for ${series
        .map((s) => s.phrase)
        .join(", ")}`}
    >
      {ticks.map((v) => (
        <g key={`t-${v}`}>
          <line
            x1={PLOT_LEFT}
            x2={PLOT_LEFT + PLOT_WIDTH}
            y1={y(v)}
            y2={y(v)}
            stroke="var(--border)"
            opacity={v === 0 ? 1 : 0.5}
          />
          <text
            x={PLOT_LEFT - 5}
            y={y(v) + 3}
            textAnchor="end"
            fill="var(--text-tertiary)"
            fontSize="9"
          >
            {tickLabel(v)}
          </text>
        </g>
      ))}
      <text
        x={PLOT_LEFT - 5}
        y={PLOT_TOP - 4}
        textAnchor="end"
        fill="var(--text-tertiary)"
        fontSize="9"
      >
        share
      </text>

      <text x={PLOT_LEFT} y={HEIGHT - 8} fill="var(--text-tertiary)" fontSize="9" className="num">
        {firstDate}
      </text>
      <text
        x={PLOT_LEFT + PLOT_WIDTH}
        y={HEIGHT - 8}
        textAnchor="end"
        fill="var(--text-tertiary)"
        fontSize="9"
        className="num"
      >
        {lastDate}
      </text>

      {series.map((s, i) => {
        const color = SERIES_COLORS[i % SERIES_COLORS.length];
        const d = s.points
          .map((p, j) => `${j === 0 ? "M" : "L"}${x(p.run_date).toFixed(2)},${y(p.share).toFixed(2)}`)
          .join(" ");
        return (
          <g key={s.phrase}>
            <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
            {s.points.map((p) => (
              <circle
                key={p.run_date}
                cx={x(p.run_date)}
                cy={y(p.share)}
                r={2}
                fill={color}
              >
                <title>{`${s.phrase} - ${p.run_date} - ${sharePct(p.share)} of headlines`}</title>
              </circle>
            ))}
          </g>
        );
      })}

      {/* Direct labels. Identity never depends on a colour lookup. */}
      {series.map((s, i) => {
        const color = SERIES_COLORS[i % SERIES_COLORS.length];
        const yl = labelY.get(i) ?? PLOT_TOP;
        const last = s.points[s.points.length - 1];
        const yEnd = y(last.share);
        // A leader line wherever the anti-collision pass moved a label off its
        // own line's end. Without it, three narratives converging at ~3% get
        // three stacked labels whose only tie to their lines is hue — which is
        // precisely the colour-alone identification the low-contrast slots in
        // this palette are not allowed to rely on.
        const displaced = Math.abs(yl - yEnd) > 1.5;
        return (
          <g key={`lbl-${s.phrase}`}>
            {displaced && (
              <polyline
                points={[
                  `${PLOT_LEFT + PLOT_WIDTH},${yEnd.toFixed(2)}`,
                  `${PLOT_LEFT + PLOT_WIDTH + LEADER_RUN * 0.4},${yEnd.toFixed(2)}`,
                  `${PLOT_LEFT + PLOT_WIDTH + LEADER_RUN * 0.8},${yl.toFixed(2)}`,
                  `${PLOT_LEFT + PLOT_WIDTH + LEADER_RUN},${yl.toFixed(2)}`,
                ].join(" ")}
                fill="none"
                stroke={color}
                strokeWidth={1}
                opacity={0.7}
              />
            )}
            <text
              x={PLOT_LEFT + PLOT_WIDTH + LABEL_X}
              y={yl + 3}
              fill={color}
              fontSize="10"
            >
              {s.phrase.length > 20 ? `${s.phrase.slice(0, 19)}…` : s.phrase}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** The table view. ADR-0126: a tooltip is never the only copy of a number, and
 *  the two low-contrast palette slots require exactly this relief. Exported so a
 *  test can assert the relief exists, rather than trusting this comment. */
export function SeriesTable({ series }: { series: NarrativeSeries[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11.5px] border-collapse">
        <thead>
          <tr className="text-text-tertiary text-left">
            <th className="font-normal py-1 pr-3">Narrative</th>
            <th className="font-normal py-1 pr-3 text-right">Share</th>
            <th className="font-normal py-1 pr-3 text-right">Velocity</th>
            <th className="font-normal py-1 pr-3">Status</th>
            <th className="font-normal py-1 pr-3">Already watched by</th>
            <th className="font-normal py-1">Found by</th>
          </tr>
        </thead>
        <tbody>
          {series.map((s, i) => (
            <tr key={s.phrase} className="border-t border-border align-top">
              <td className="py-1 pr-3">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }}
                  />
                  <span className="text-text-primary">{s.phrase}</span>
                </span>
              </td>
              <td className="py-1 pr-3 text-right num">{sharePct(s.latest.share)}</td>
              <td className="py-1 pr-3 text-right num">
                {s.latest.velocity === null ? (
                  <span className="text-text-tertiary">not measurable</span>
                ) : (
                  `${s.latest.velocity >= 0 ? "+" : ""}${s.latest.velocity.toFixed(2)}`
                )}
              </td>
              <td className="py-1 pr-3 text-text-secondary">{s.latest.status}</td>
              <td className="py-1 pr-3 text-text-secondary">
                {s.latest.covered_by ?? (
                  <span className="text-text-tertiary">nothing</span>
                )}
              </td>
              {/* Two methods that fail differently agreeing is the strongest
                  claim this board makes, so it is a column and not a tooltip.
                  "frequency" alone is the norm, so it stays muted -- only
                  corroboration is worth the reader's eye. */}
              <td className="py-1 text-text-secondary">
                {isCorroborated(s.latest) ? (
                  <span title="Also proposed by the monthly LDA-intersect-embedding discovery job">
                    {(s.latest.methods ?? []).join(" + ")}
                  </span>
                ) : (
                  <span className="text-text-tertiary">frequency</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function NarrativeTrends() {
  const [series, setSeries] = useState<NarrativeSeries[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchNarratives(30).then(({ rows, error }) => {
      if (error) {
        setError(error);
        return;
      }
      setSeries(toSeries(rows));
    });
  }, []);

  const top = series ? topSeries(series, SERIES_COLORS.length) : [];
  const emerging = series ? emergingUncovered(series) : [];
  // Distinguishes the two empties (ADR-0059 / ADR-0143): "measured, none
  // found" is a finding; "cannot measure yet" is silence. With no measurable
  // velocity anywhere, NOTHING can be classified emerging regardless of what
  // the market is doing, and the copy below must not claim otherwise.
  const velocityMeasurable = series?.some((s) => s.latest.velocity !== null) ?? false;
  const uncoveredCount = series?.filter((s) => s.latest.covered_by === null).length ?? 0;
  const latestRun = series?.[0]?.latest.run_date ?? null;
  const corpus = series?.[0]?.latest.corpus_size ?? null;
  const dropped = series ? Math.max(0, series.length - top.length) : 0;

  return (
    <div className="card">
      <div className="card-header flex-wrap gap-2">
        <div>
          <span className="card-title">Narrative trends</span>
          <span className="text-text-tertiary text-[11px] ml-2">
            share of voice over time &middot; phrases nobody named in advance
          </span>
        </div>
        {latestRun && (
          <span className="text-[11px] text-text-tertiary num">
            run {latestRun}
            {corpus ? ` · ${corpus} headlines` : ""}
          </span>
        )}
      </div>

      <div className="p-4">
        {error ? (
          <div className="text-[12.5px] text-text-tertiary leading-[1.6]">
            Could not read <code className="num">narrative_signals</code>: {error}.
            Apply migration <code className="num">049</code>.
          </div>
        ) : series === null ? (
          <div className="skeleton h-[240px]" />
        ) : series.length === 0 ? (
          <div className="text-[12.5px] text-text-secondary leading-[1.6]">
            No narrative signals recorded yet. The daily job collects general
            market news (<code className="num">market_news</code>) alongside the
            nine anchor themes, then tracks every phrase&rsquo;s share of voice in{" "}
            <code className="num">narrative_signals</code>. Velocity needs several
            runs of history before it reports anything, so the first few days will
            show every phrase as <span className="num">new</span>.
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="m-0 text-[11px] text-text-tertiary leading-[1.55]">
              Share of the day&rsquo;s headlines mentioning each phrase. Not mention
              counts: the corpus size swings with how many articles the fetch
              returned, so a raw count rises on a day the fetcher simply worked
              better.
            </p>

            <TrendPlot series={top} />

            <SeriesTable series={top} />

            {dropped > 0 && (
              <p className="m-0 text-[11px] text-text-tertiary leading-[1.55]">
                Showing the {top.length} loudest of{" "}
                <span className="num">{series.length}</span> tracked narratives.
                The other <span className="num">{dropped}</span> are recorded in{" "}
                <code className="num">narrative_signals</code> and are not drawn
                here.
              </p>
            )}

            <div className="border-t border-border pt-3">
              <h4 className="m-0 mb-1 text-[11px] uppercase tracking-[0.1em] text-text-secondary">
                Emerging &middot; watched by nothing
              </h4>
              {emerging.length === 0 ? (
                velocityMeasurable ? (
                  <p className="m-0 text-[12px] text-text-secondary leading-[1.6]">
                    No narrative is currently both accelerating and outside the nine
                    anchor themes. That is a finding, not an empty state: every phrase
                    breaking out today is one an anchor theme already asks for.
                  </p>
                ) : (
                  <p className="m-0 text-[12px] text-text-secondary leading-[1.6]">
                    Not measurable yet. Velocity compares each phrase against its own
                    history, and no tracked phrase has enough observed days since the
                    corpus rebuild (ADR-0141) — so nothing <em>can</em> be classified
                    as accelerating, whatever the market is doing. This silence is an
                    empty instrument, not a finding:{" "}
                    <span className="num">{uncoveredCount}</span> of the{" "}
                    <span className="num">{series?.length ?? 0}</span> tracked phrases
                    are watched by no anchor theme, and whether any is breaking out
                    cannot be said until the history accrues.
                  </p>
                )
              ) : (
                <ul className="m-0 p-0 list-none flex flex-col gap-1.5">
                  {emerging.slice(0, 6).map((s) => (
                    <li key={s.phrase} className="text-[12px] leading-[1.5]">
                      <span className="text-text-primary">{s.phrase}</span>
                      <span className="text-text-tertiary">
                        {" "}
                        &mdash; <span className="num">{sharePct(s.latest.share)}</span> of
                        headlines, velocity{" "}
                        <span className="num">
                          {s.latest.velocity === null
                            ? "n/a"
                            : `${s.latest.velocity >= 0 ? "+" : ""}${s.latest.velocity.toFixed(2)}`}
                        </span>
                        , first seen <span className="num">{s.latest.first_seen}</span> (
                        {STATUS_COPY[s.latest.status]})
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <p className="m-0 text-[11px] text-text-tertiary leading-[1.55]">
              Shadow signal. Nothing here enters the theme board, sizes a position,
              or reaches the reasoning agent &mdash; a phrase trending in the news is
              evidence a narrative exists, not evidence it is tradeable.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
