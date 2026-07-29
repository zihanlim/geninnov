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
import Sparkline from "@/components/Sparkline";
import {
  emergingUncovered,
  fetchNarratives,
  isCorroborated,
  latestMeasuredDate,
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

// ── The detection view (ADR-0146) ───────────────────────────────────────────
//
// The narrative board is a DETECTOR, not a comparison: its question is "is
// anything accelerating that nothing watches?", which is a state question, not
// a trajectory question. So the board's plane is share × velocity, with
// covered phrases drawn hollow (context — an anchor is on them) and uncovered
// phrases filled (the payload). Phrases whose velocity is not yet measurable
// are NEVER plotted at y = 0 — absence is not zero (ADR-0066) — they sit in a
// labelled rug below the plane, positioned by the one thing that IS measured
// (share), and rise into the plane as their history accrues.
//
// EVERY REGION OF THIS CHART NAMES ITS LOUDEST MARKS (ADR-0162). Hollow/filled
// and plane/rug are the encodings; neither is allowed to also mean "anonymous".
// The failure both halves were written against is the same one: a mark a reader
// can see but cannot identify is a mark they report as absent.

const S_HEIGHT = 252;
const S_PLOT_TOP = 16;
const S_PLOT_H = 152;
const RUG_TOP = S_PLOT_TOP + S_PLOT_H + 16;
const RUG_H = 14;
/** Rug marks are capped to bound the DOM; the overflow is counted, not hidden. */
const RUG_CAP = 80;
/** Direct labels in the plane, per encoding. The payload is named more deeply
 *  than the context, but neither is named zero times — see the label pass. */
const LABEL_CAP_UNCOVERED = 6;
const LABEL_CAP_COVERED = 4;
/** How many rug phrases are named in text beneath the strip. The rug's marks are
 *  ticks on one axis with no room for per-mark labels, so the loudest few are
 *  named in a line instead — otherwise the strip says only how MANY phrases it
 *  is withholding a velocity for, never which. `chip` (7.3% of headlines on
 *  2026-07-28, first seen that day) appeared nowhere in text on the whole board:
 *  not in the plane, not in the rug, and 7th by share against a 5-row table. */
const RUG_NAMED = 4;

export function DetectionScatter({ series }: { series: NarrativeSeries[] }) {
  const xMax = Math.max(...series.map((s) => s.latest.share), 0.01) * 1.08;
  const x = (share: number) => PLOT_LEFT + clamp(share / xMax, 0, 1) * PLOT_WIDTH;

  const measurable = series.filter((s) => s.latest.velocity !== null);
  const unmeasurable = series
    .filter((s) => s.latest.velocity === null)
    .sort((a, b) => b.latest.share - a.latest.share);

  const vs = measurable.map((s) => s.latest.velocity as number);
  const vMin = Math.min(0, ...vs);
  const vMax = Math.max(0, ...vs);
  const vPad = (vMax - vMin) * 0.12 || 1;
  const yLo = vMin - vPad;
  const yHi = vMax + vPad;
  const y = (v: number) =>
    S_PLOT_TOP + S_PLOT_H - clamp((v - yLo) / (yHi - yLo), 0, 1) * S_PLOT_H;
  const yTicks = measurable.length > 0 ? niceTicks(yLo, yHi, 4) : [];

  const xTicks = niceTicks(0, xMax, 4);
  const xStep = xTicks.length > 1 ? xTicks[1] - xTicks[0] : xMax;
  const xDigits = xStep * 100 >= 1 ? 0 : 1;
  const fmtX = (v: number) => `${(v * 100).toFixed(xDigits)}%`;

  // Direct labels on BOTH encodings (ADR-0162), not on the payload alone.
  //
  // ADR-0146 labelled only the uncovered marks, on the reasoning that covered
  // ones are context. But a hollow 3px ring is already the muted channel, and
  // leaving it unnamed as well meant the loudest phrase on the board could sit
  // in the top-right alarm corner looking like a gridline artefact. On
  // 2026-07-28 that phrase was `ai` — 15.6% share, velocity +2.27, the maximum
  // of both axes, so it SET the x-scale — and a reader asked why it was missing
  // from the plot. It was not missing. It was unlabelled.
  //
  // Two caps rather than one: the payload is what the board is for, so it is
  // named more deeply than the context. Both sets are ranked by share and share
  // ONE collision pass — a covered label overprinting an uncovered one would
  // cost the payload exactly the legibility this split exists to protect.
  const LABEL_H = 11;
  const byShare = (a: NarrativeSeries, b: NarrativeSeries) =>
    b.latest.share - a.latest.share;
  const labelled = [
    ...measurable
      .filter((s) => s.latest.covered_by === null)
      .sort(byShare)
      .slice(0, LABEL_CAP_UNCOVERED),
    ...measurable
      .filter((s) => s.latest.covered_by !== null)
      .sort(byShare)
      .slice(0, LABEL_CAP_COVERED),
  ]
    .map((s) => ({
      s,
      covered: s.latest.covered_by !== null,
      xr: x(s.latest.share),
      yRaw: y(s.latest.velocity as number),
    }))
    .sort((a, b) => a.yRaw - b.yRaw);
  let prevLabelY = -Infinity;
  for (const l of labelled) {
    const placed = Math.max(l.yRaw, prevLabelY + LABEL_H);
    prevLabelY = placed;
    (l as { yLabel?: number }).yLabel = clamp(placed, S_PLOT_TOP + 5, RUG_TOP - 8);
  }

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${S_HEIGHT}`}
      className="w-full h-auto"
      role="img"
      aria-label={`Narrative detection plane: ${measurable.length} phrases with measurable velocity, ${unmeasurable.length} not yet measurable`}
    >
      {/* y: velocity gridlines; the zero line is the one that matters. */}
      {yTicks.map((v) => (
        <g key={`vy-${v}`}>
          <line
            x1={PLOT_LEFT}
            x2={PLOT_LEFT + PLOT_WIDTH}
            y1={y(v)}
            y2={y(v)}
            stroke="var(--border)"
            opacity={v === 0 ? 1 : 0.5}
          />
          <text x={PLOT_LEFT - 5} y={y(v) + 3} textAnchor="end" fill="var(--text-tertiary)" fontSize="9">
            {v > 0 ? `+${v}` : `${v}`}
          </text>
        </g>
      ))}
      <text x={PLOT_LEFT - 5} y={S_PLOT_TOP - 5} textAnchor="end" fill="var(--text-tertiary)" fontSize="9">
        velocity
      </text>

      {/* x: share ticks along the bottom, below the rug. */}
      {xTicks.map((v) => (
        <g key={`vx-${v}`}>
          <line
            x1={x(v)}
            x2={x(v)}
            y1={S_PLOT_TOP}
            y2={S_PLOT_TOP + S_PLOT_H}
            stroke="var(--border)"
            opacity={0.35}
          />
          <text x={x(v)} y={S_HEIGHT - 4} textAnchor="middle" fill="var(--text-tertiary)" fontSize="9">
            {fmtX(v)}
          </text>
        </g>
      ))}
      <text
        x={PLOT_LEFT + PLOT_WIDTH}
        y={S_HEIGHT - 4}
        textAnchor="start"
        fill="var(--text-tertiary)"
        fontSize="9"
        dx="8"
      >
        share
      </text>

      {measurable.length === 0 && (
        <text
          x={PLOT_LEFT + PLOT_WIDTH / 2}
          y={S_PLOT_TOP + S_PLOT_H / 2}
          textAnchor="middle"
          fill="var(--text-tertiary)"
          fontSize="10.5"
        >
          No measurable velocities yet — marks rise into this plane as each phrase
          accrues enough observed days.
        </text>
      )}

      {/* The plane: hollow = an anchor already watches it; filled = nothing does. */}
      {measurable.map((s) => {
        const uncovered = s.latest.covered_by === null;
        const cx = x(s.latest.share);
        const cy = y(s.latest.velocity as number);
        return (
          <g key={s.phrase}>
            {s.latest.status === "emerging" && (
              <circle cx={cx} cy={cy} r={6.5} fill="none" stroke="var(--series-1)" strokeWidth={1} opacity={0.8} />
            )}
            <circle
              cx={cx}
              cy={cy}
              r={uncovered ? 3.5 : 3}
              fill={uncovered ? "var(--series-1)" : "transparent"}
              stroke={uncovered ? "none" : "var(--text-tertiary)"}
              strokeWidth={uncovered ? 0 : 1.2}
            >
              <title>{`${s.phrase} — ${sharePct(s.latest.share)} share, velocity ${(s.latest.velocity as number).toFixed(2)}, ${s.latest.covered_by ? `watched by ${s.latest.covered_by}` : "watched by nothing"}`}</title>
            </circle>
          </g>
        );
      })}
      {/* Leader lines wherever the collision pass moved a label off its own mark
          — the rule TrendPlot already applies to its end labels, brought here
          because this plane now carries up to ten labels instead of six and the
          anti-collision stack routinely pushes one 50px below the dot it names.
          An unconnected label 50px from its mark is not a weaker label; it is a
          label pointing at the wrong mark. */}
      {labelled.map((l) => {
        const yLabel = (l as { yLabel?: number }).yLabel ?? l.yRaw;
        const displaced = Math.abs(yLabel - l.yRaw) > 1.5;
        // The leader carries the same payload/context ink as the mark it leaves,
        // so following one never loses which of the two encodings you are in.
        const ink = l.covered ? "var(--text-tertiary)" : "var(--series-1)";
        return (
          <g key={`dl-${l.s.phrase}`}>
            {displaced && (
              <polyline
                points={[
                  `${(l.xr + 7).toFixed(2)},${l.yRaw.toFixed(2)}`,
                  `${(l.xr + 10).toFixed(2)},${l.yRaw.toFixed(2)}`,
                  `${(l.xr + 10).toFixed(2)},${yLabel.toFixed(2)}`,
                  `${(l.xr + 12).toFixed(2)},${yLabel.toFixed(2)}`,
                ].join(" ")}
                fill="none"
                stroke={ink}
                strokeWidth={1}
                opacity={0.55}
              />
            )}
            <text
              x={l.xr + (displaced ? 14 : 7)}
              y={yLabel + 3}
              // The ink carries the covered/uncovered split that the fill already
              // carries, so naming a context mark does not promote it to payload.
              fill={l.covered ? "var(--text-tertiary)" : "var(--text-secondary)"}
              fontSize="9.5"
            >
              {l.s.phrase.length > 18 ? `${l.s.phrase.slice(0, 17)}…` : l.s.phrase}
            </text>
          </g>
        );
      })}

      {/* The rug: measured in x (share), honest about y (nothing to plot).
          Label sits ABOVE the strip, start-anchored — end-anchored in the
          44px left gutter it clipped through the viewBox edge. */}
      <text x={PLOT_LEFT} y={RUG_TOP - 4} textAnchor="start" fill="var(--text-tertiary)" fontSize="9">
        velocity not yet measurable · {unmeasurable.length}
      </text>
      {unmeasurable.slice(0, RUG_CAP).map((s) => (
        <line
          key={`rug-${s.phrase}`}
          x1={x(s.latest.share)}
          x2={x(s.latest.share)}
          y1={RUG_TOP}
          y2={RUG_TOP + RUG_H}
          stroke={s.latest.covered_by === null ? "var(--series-1)" : "var(--text-tertiary)"}
          strokeWidth={1.5}
          opacity={0.65}
        >
          <title>{`${s.phrase} — ${sharePct(s.latest.share)} share, velocity not yet measurable, ${s.latest.covered_by ? `watched by ${s.latest.covered_by}` : "watched by nothing"}`}</title>
        </line>
      ))}
      {unmeasurable.length > RUG_CAP && (
        <text
          x={PLOT_LEFT + PLOT_WIDTH}
          y={RUG_TOP + RUG_H - 3}
          textAnchor="start"
          dx="8"
          fill="var(--text-tertiary)"
          fontSize="9"
        >
          +{unmeasurable.length - RUG_CAP} more
        </text>
      )}

      {/* The rug's loudest phrases, NAMED (ADR-0162). The strip's own header
          says how many phrases are waiting; without this line it never says
          which, and a phrase can be the 7th-loudest on the board while appearing
          in no text anywhere on it. Shares travel with the names because a
          <title> is never the only copy of a number (ADR-0126). */}
      {unmeasurable.length > 0 && (
        <text
          x={PLOT_LEFT}
          y={RUG_TOP + RUG_H + 11}
          textAnchor="start"
          fill="var(--text-tertiary)"
          fontSize="9"
        >
          {unmeasurable
            .slice(0, RUG_NAMED)
            .map((s) => `${s.phrase} ${sharePct(s.latest.share)}`)
            .join("  ·  ")}
        </text>
      )}
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
            <th className="font-normal py-1 pr-3">Trend</th>
            <th className="font-normal py-1 pr-3 text-right">Share</th>
            <th className="font-normal py-1 pr-3 text-right">Velocity</th>
            <th className="font-normal py-1 pr-3">Status</th>
            <th className="font-normal py-1 pr-3">Already watched by</th>
            <th className="font-normal py-1">Found by</th>
          </tr>
        </thead>
        <tbody>
          {series.map((s) => (
            <tr key={s.phrase} className="border-t border-border align-top">
              <td className="py-1 pr-3">
                <span className="text-text-primary">{s.phrase}</span>
              </td>
              {/* Own-scale mini-trend (ADR-0146): trajectory context moved here
                  from the retired top-5 line chart. Identity is the row itself,
                  so no colour slot is spent on it. */}
              <td className="py-1 pr-3 w-[84px]">
                {s.points.length > 1 ? (
                  <Sparkline
                    points={s.points.map((p) => p.share)}
                    color="var(--text-tertiary)"
                    height={16}
                  />
                ) : (
                  <span className="text-text-tertiary">—</span>
                )}
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
  // Non-null when the plane is showing an EARLIER day than the newest run,
  // because the newest had no measurable velocity. The date must be stated.
  const [asOfFallback, setAsOfFallback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // THE ARCHIVE SERIES, not the dense one (ADR-0153).
    //
    // This board is a share x velocity DETECTION PLANE (ADR-0146) and its question
    // is "is anything accelerating that nothing watches?" — a question about change
    // over time. Only the archive series can answer it: `combined` is denser
    // (~98 docs/day against ~27) but its composition changes as providers come and
    // go, so it holds one run_date and zero measurable velocities, and every mark
    // would sit in the "not yet measurable" rug forever.
    //
    // The archive is GDELT alone — sparser, but counted out of ONE definition back
    // to 2026-06-14, which is what makes a velocity mean anything. It carries 103
    // measured velocities where `combined` carries none.
    //
    // `combined` becomes the better instrument once it has four runs of its own
    // history and stops changing composition; this default should move then.
    fetchNarratives(30, "archive").then(({ rows, error }) => {
      if (error) {
        setError(error);
        return;
      }
      // If the newest day carries no measurable velocity, read the most recent
      // day that does, and say which (ADR-0159). The newest publication day is
      // structurally the thinnest — GDELT publishes with a lag — so keying the
      // plane to max(run_date) blanks it on top of a series full of velocities.
      const newest = toSeries(rows);
      const measurable = newest.some((x) => x.latest.velocity !== null);
      const measuredDay = measurable ? null : latestMeasuredDate(rows);
      setSeries(measuredDay ? toSeries(rows, measuredDay) : newest);
      setAsOfFallback(measuredDay);
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
          <span className="card-title">Narrative detection</span>
          <span className="text-text-tertiary text-[11px] ml-2">
            loudness &times; breakout &middot; phrases nobody named in advance
          </span>
        </div>
        {latestRun && (
          <span className="text-[11px] text-text-tertiary num">
            run {latestRun}
            {corpus ? ` · ${corpus} headlines` : ""}
            {asOfFallback ? " · last measured day" : ""}
          </span>
        )}
      </div>

      <div className="p-4">
        {asOfFallback && (
          <p className="m-0 mb-3 text-[12px] text-text-secondary leading-[1.6] border-l-2 border-border pl-3">
            Showing <span className="num">{asOfFallback}</span>, the most recent day
            with a measurable velocity — not the newest day in the window. A
            velocity compares a phrase&rsquo;s share against its own history, and
            the newest publication day is always the thinnest because GDELT
            publishes with a lag, so it is the day most often withheld. Both
            coordinates below come from{" "}
            <span className="num">{asOfFallback}</span>; plotting today&rsquo;s
            share against an older velocity would not be a point on this plane.
          </p>
        )}
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
              Counted out of the <strong>archive corpus</strong> (GDELT alone,
              ~27 headlines/day back to 2026-06-14) rather than the denser combined
              one. A share is a fraction OF a corpus, so a velocity is only
              meaningful where the corpus is defined the same way every day, and the
              combined corpus is not — Brave contributes ~90 headlines/day inside an
              8-day window and none before it (ADR-0153).{" "}
              A detector, not a comparison (ADR-0146): each phrase is placed by how
              loud it is (share of the day&rsquo;s headlines — not mention counts,
              which rise on a day the fetcher simply worked better) and whether it is
              breaking out against its own history (velocity). Hollow marks are
              phrases an anchor theme already watches — context. Filled marks are
              watched by nothing — the payload. The alarm sits top-right. Both
              kinds are named, the covered ones in lighter ink, so no mark on this
              plane is one you can see but cannot identify. Phrases whose velocity
              cannot be measured yet wait in the strip below the plane, with its
              loudest few named beneath it; they rise into the plane as history
              accrues.
            </p>

            {/* Plane ‖ figures, 2fr / 1fr. `items-start` so neither column stretches
                to the other's height, and `min-w-0` on both because a grid item
                defaults to min-width:auto and will refuse to shrink below its
                content — without it the table's `overflow-x-auto` never engages and
                the whole card scrolls sideways instead.

                Gated at `wide` (1424px) rather than `lg`. This table is SEVEN
                columns; at a third of a narrower canvas it becomes a horizontal
                scroller, and a scroller is how a column stops being read. Below the
                gate the two stack exactly as they did. */}
            <div className="grid wide:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-5 items-start [&>*]:min-w-0">
              <DetectionScatter series={series} />

              <div>
                <SeriesTable series={top} />

                {dropped > 0 && (
                  <p className="m-0 mt-2 text-[11px] text-text-tertiary leading-[1.55]">
                    The table details the {top.length} loudest of{" "}
                    <span className="num">{series.length}</span> tracked narratives —
                    every one of the {series.length} is a mark in the plane or the
                    strip beside it.
                  </p>
                )}
              </div>
            </div>

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
