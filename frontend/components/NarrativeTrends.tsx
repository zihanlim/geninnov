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

import {
  attentionFunnel,
  emergingUncovered,
  isCorroborated,
  sharePct,
  topSeries,
  type NarrativeSeries,
  type NarrativeStatus,
} from "@/lib/narratives";
import { useNarrativeSeries } from "@/lib/useNarrativeSeries";
import { useState, useRef } from "react";

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
        const color = s.phrase === "AI Capex" ? "#e91e8c" : SERIES_COLORS[i % SERIES_COLORS.length];
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

// ── Scatter geometry, DELIBERATELY NARROWER THAN TrendPlot's ────────────────
//
// The detection plane draws in its own coordinate space so it can sit BESIDE
// the figures table inside one card. `TrendPlot` keeps WIDTH = 720 — it is
// rendered by `ThemeTrends`, which is still full width — and the two no longer
// share a horizontal scale.
//
// Why a narrower viewBox rather than a smaller rendering. An SVG with a viewBox
// and `w-full` scales UNIFORMLY: squeezing the 720-wide plane into a 484px
// column renders every label at 0.672x, i.e. the 9px axis ticks at 6.0px, which
// was measured and rejected. Narrowing the viewBox instead keeps the type at
// its designed size and spends the saving on DATA space — the plane holds the
// same marks over fewer horizontal units. Less room to separate marks, full-size
// labels; the other way round is a chart you cannot read at all.
//
// S_WIDTH is set at roughly the NARROWEST column this card will offer, so the
// plot scales up from 1.0 and never down: below 1.0 the labels shrink, above it
// they grow, and only one of those directions is recoverable.
const S_WIDTH = 430;
const S_PLOT_LEFT = 40;
/** Right gutter for the in-plane labels, which extend rightward from their own
 *  marks, plus the "share" axis caption. Smaller than TrendPlot's 148 because
 *  those are END labels for lines that run the full width; these hang off dots. */
const S_PLOT_RIGHT = 42;
const S_PLOT_WIDTH = S_WIDTH - S_PLOT_LEFT - S_PLOT_RIGHT;

const S_HEIGHT = 225;
const S_PLOT_TOP = 16;
const S_PLOT_H = 152;
/** x-axis tick labels sit here — plot ends at S_PLOT_TOP+S_PLOT_H=168. */
const XLABEL_Y = 177;
const RUG_H = 14;
/** Rug marks are capped to bound the DOM; the overflow is counted, not hidden. */
const RUG_CAP = 80;
/** Direct labels in the plane, per encoding. The payload is named more deeply
 *  than the context, but neither is named zero times — see the label pass. */
const LABEL_CAP_UNCOVERED = 3;
const LABEL_CAP_COVERED = 0;
/** How many rug phrases are named in text beneath the strip. The rug's marks are
 *  ticks on one axis with no room for per-mark labels, so the loudest few are
 *  named in a line instead — otherwise the strip says only how MANY phrases it
 *  is withholding a velocity for, never which. `chip` (7.3% of headlines on
 *  2026-07-28, first seen that day) appeared nowhere in text on the whole board:
 *  not in the plane, not in the rug, and 7th by share against a 5-row table. */
const RUG_NAMED = 3;

export function DetectionScatter({ series }: { series: NarrativeSeries[] }) {
  const [tooltip, setTooltip] = useState<{ screenX: number; screenY: number; text: string } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const xMax = Math.max(...series.map((s) => s.latest.share), 0.01) * 1.08;
  const x = (share: number) => S_PLOT_LEFT + clamp(share / xMax, 0, 1) * S_PLOT_WIDTH;

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
  const labelled = measurable
    .filter((s) => s.phrase !== "global" && s.phrase !== "us")
    .sort(byShare)
    .slice(0, LABEL_CAP_UNCOVERED)
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
    (l as { yLabel?: number }).yLabel = clamp(placed, S_PLOT_TOP + 5, S_PLOT_TOP + S_PLOT_H);
  }

  return (
    <div className="relative inline-block w-full">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${S_WIDTH} ${S_HEIGHT}`}
        className="w-full h-auto"
        role="img"
        aria-label={`Narrative detection plane: ${measurable.length} phrases with measurable velocity, ${unmeasurable.length} not yet measurable`}
        onMouseLeave={() => setTooltip(null)}
      >
      {/* y: velocity gridlines; the zero line is the one that matters. */}
      {yTicks.map((v) => (
        <g key={`vy-${v}`}>
          <line
            x1={S_PLOT_LEFT}
            x2={S_PLOT_LEFT + S_PLOT_WIDTH}
            y1={y(v)}
            y2={y(v)}
            stroke="var(--border)"
            opacity={v === 0 ? 1 : 0.5}
          />
          <text x={S_PLOT_LEFT - 5} y={y(v) + 3} textAnchor="end" fill="var(--text-tertiary)" fontSize="9">
            {v > 0 ? `+${v}` : `${v}`}
          </text>
        </g>
      ))}
      <text x={S_PLOT_LEFT - 5} y={S_PLOT_TOP - 5} textAnchor="end" fill="var(--text-tertiary)" fontSize="9">
        velocity
      </text>

      {/* x: share ticks along the bottom, above the rug. */}
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
          <text x={x(v)} y={XLABEL_Y - 4} textAnchor="middle" fill="var(--text-tertiary)" fontSize="9">
            {fmtX(v)}
          </text>
        </g>
      ))}
      <text
        x={S_PLOT_LEFT + S_PLOT_WIDTH}
        y={XLABEL_Y - 4}
        textAnchor="start"
        fill="var(--text-tertiary)"
        fontSize="9"
        dx="8"
      >
        share
      </text>

      {measurable.length === 0 && (
        <text
          x={S_PLOT_LEFT + S_PLOT_WIDTH / 2}
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
              onMouseEnter={(e) => {
                const rect = svgRef.current?.getBoundingClientRect();
                if (!rect) return;
                setTooltip({
                  screenX: e.clientX - rect.left,
                  screenY: e.clientY - rect.top,
                  text: `${s.phrase} — ${sharePct(s.latest.share)} share, velocity ${(s.latest.velocity as number).toFixed(2)}, ${s.latest.covered_by ? `watched by ${s.latest.covered_by}` : "watched by nothing"}`,
                });
              }}
              onMouseLeave={() => setTooltip(null)}
            />
          </g>
        );
      })}
      {/* Direct labels beside each mark. A simple vertical drop from the dot
          to the label is cleaner than a polyline in a narrow column — the
          mark and label are close enough to associate without a horizontal run. */}
      {labelled.map((l) => {
        const yLabel = (l as { yLabel?: number }).yLabel ?? l.yRaw;
        const displaced = Math.abs(yLabel - l.yRaw) > 1.5;
        const ink = l.covered ? "var(--text-tertiary)" : "var(--series-1)";
        return (
          <g key={`dl-${l.s.phrase}`}>
            {displaced && (
              <line
                x1={l.xr + 6}
                y1={l.yRaw}
                x2={l.xr + 6}
                y2={yLabel}
                stroke={ink}
                strokeWidth={1}
                opacity={0.6}
              />
            )}
            <text
              x={l.xr + 9}
              y={yLabel + 3}
              fill={l.covered ? "var(--text-tertiary)" : "var(--text-secondary)"}
              fontSize="9.5"
            >
              {l.s.phrase.length > 18 ? `${l.s.phrase.slice(0, 17)}…` : l.s.phrase}
            </text>
          </g>
        );
      })}

      {/* The rug: measured in x (share), honest about y (nothing to plot).
          Sits BELOW the x-axis label, start-anchored in the left gutter. */}
      <text x={S_PLOT_LEFT} y={XLABEL_Y + 14} textAnchor="start" fill="var(--text-tertiary)" fontSize="9">
        velocity not yet measurable · {unmeasurable.length}
      </text>
      {unmeasurable.slice(0, RUG_CAP).map((s) => (
        <line
          key={`rug-${s.phrase}`}
          x1={x(s.latest.share)}
          x2={x(s.latest.share)}
          y1={XLABEL_Y + 22}
          y2={XLABEL_Y + 22 + RUG_H}
          stroke={s.latest.covered_by === null ? "var(--series-1)" : "var(--text-tertiary)"}
          strokeWidth={1.5}
          opacity={0.65}
        >
          <title>{`${s.phrase} — ${sharePct(s.latest.share)} share, velocity not yet measurable, ${s.latest.covered_by ? `watched by ${s.latest.covered_by}` : "watched by nothing"}`}</title>
        </line>
      ))}
      {unmeasurable.length > RUG_CAP && (
        <text
          x={S_PLOT_LEFT + S_PLOT_WIDTH}
          y={XLABEL_Y + 22 + RUG_H - 3}
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
          x={S_PLOT_LEFT}
          y={XLABEL_Y + 22 + RUG_H + 11}
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
    {/* Immediate tooltip on hover — no browser-native delay.
        Positioned in screen pixels relative to the SVG. */}
    {tooltip && (
      <div
        style={{
          position: "absolute",
          left: tooltip.screenX + 10,
          top: tooltip.screenY - 8,
          whiteSpace: "nowrap",
          backgroundColor: "var(--series-1)",
          border: "1px solid var(--series-1)",
          borderRadius: "6px",
          padding: "4px 8px",
          fontSize: "10.5px",
          color: "#ffffff",
          lineHeight: "1.4",
          boxShadow: "0 1px 3px rgba(0,0,0,0.12)",
          pointerEvents: "none",
          zIndex: 10,
        }}
      >
        {tooltip.text}
      </div>
    )}
    </div>
  );
}

/** The table view. ADR-0126: a tooltip is never the only copy of a number, and
 *  the two low-contrast palette slots require exactly this relief. Exported so a
 *  test can assert the relief exists, rather than trusting this comment.
 *
 *  Column gutters are `pr-2` (8px), not the `pr-3` the sibling ThemeTrendsTable
 *  uses. Six columns pay that gutter five times, and the 4px is real slack:
 *  every column width is min-content over a live value ("established",
 *  "AI Capex", "not measurable"), so the next 4px would truncate a reading
 *  rather than tighten a rule.
 *
 *  NO SPARKLINE COLUMN, and that is a width decision taken with its eyes open.
 *  ADR-0146 put an own-scale mini-trend here when the top-5 line chart was
 *  retired, as the row's trajectory context. It cost ~50px of an unavoidable
 *  minimum: with it this table would not go below 358px, and the card it now
 *  lives in (`NarrativeFigures`, in the 1fr column beside the board) offers
 *  358px inside its padding — a fit with ZERO headroom, which is a layout that
 *  works until the first theme name longer than "Geopolitical Risk". Without it
 *  the table measures ~308px and has ~50px to give. Trajectory is the least
 *  load-bearing column here: the plane beside it already encodes velocity as an
 *  axis, and `Velocity` remains a column, so what is lost is the SHAPE of the
 *  path, not the direction or the magnitude. Nothing else could go — see the
 *  paragraph above. */
export function SeriesTable({ series }: { series: NarrativeSeries[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11.5px] border-collapse">
        <thead>
          <tr className="text-text-tertiary text-left">
            <th className="font-normal py-1 pr-2">Narrative</th>
            <th className="font-normal py-1 pr-2 text-right">Share</th>
            <th className="font-normal py-1 pr-2 text-right">Velocity</th>
            <th className="font-normal py-1 pr-2">Status</th>
            {/* "Anchor", not "Already watched by". Measured at the `figures` gate
                the long form wrapped to THREE lines in a 53px column — the column
                is sized by its widest WORD, and "watched" (48px) was wider than
                any value in it. The repo's own vocabulary for this field is the
                anchor theme (see the card caption above, and ADR-0128), and it
                reads correctly against the null value: "Anchor — nothing". Every
                other header here is one line; this was the only one that was not. */}
            <th className="font-normal py-1 pr-2">Anchor</th>
            <th className="font-normal py-1">Found by</th>
          </tr>
        </thead>
        <tbody>
          {series.map((s) => (
            <tr key={s.phrase} className="border-t border-border align-top">
              <td className="py-1 pr-2">
                <span className="text-text-primary">{s.phrase}</span>
              </td>
              <td className="py-1 pr-2 text-right num">{sharePct(s.latest.share)}</td>
              <td className="py-1 pr-2 text-right num">
                {s.latest.velocity === null ? (
                  <span className="text-text-tertiary">not measurable</span>
                ) : (
                  `${s.latest.velocity >= 0 ? "+" : ""}${s.latest.velocity.toFixed(2)}`
                )}
              </td>
              <td className="py-1 pr-2 text-text-secondary">{s.latest.status}</td>
              <td className="py-1 pr-2 text-text-secondary">
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
  // The archive corpus and the last-measured-day rule both live in the hook now
  // (see its header). They were inlined here, and `AttentionFunnel` inlined its
  // own copy with a different corpus argument — which is how the two cards came
  // to disagree on the same screen. One choice, one place.
  const { series, asOfFallback, error } = useNarrativeSeries();

  const top = series ? topSeries(series, SERIES_COLORS.length) : [];
  const emerging = series ? emergingUncovered(series) : [];
  // Derived from the same series the funnel uses, so the two halves of this
  // section cannot disagree on what "N of M attributed" means. The hook is
  // the single source; the funnel reads it directly, this card derives its
  // one number.
  const funnel = series ? attentionFunnel(series) : null;
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

      <div className="px-4 pb-4">
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
            {/* LEGEND VISIBLE, METHOD COLLAPSED — and the split is not arbitrary.
                This block was 136px of a card that had grown to 829px beside a
                393px neighbour, and it is the only part of the card that is
                neither the chart nor a finding. But it was carrying two different
                jobs in one paragraph:

                  • the ENCODING (filled vs hollow, where the alarm is) — without
                    which the marks cannot be read at all, so hiding it would make
                    the chart a shape (ADR-0126's own failure mode);
                  • the METHOD (which corpus, why archive not combined, what the
                    rug is) — genuine "why", and exactly what design goal 7 says
                    to collapse rather than delete or leave always-on.

                So the legend stays inline as one line and the method goes behind
                a <details>. Note the ordering rule this does NOT break: goal 6's
                "the rationale is never hidden behind an expand" is about a
                POSITION explaining its own side before a reader decodes a figure.
                This is a shadow board that sizes nothing. */}
            <div className="flex flex-col gap-1.5">
              <p className="m-0 text-[11px] text-text-tertiary leading-[1.55]">
                A detector, not a comparison (ADR-0146). Each phrase sits at how{" "}
                <strong>loud</strong> it is (share of the day&rsquo;s headlines) ×
                whether it is <strong>breaking out</strong> against its own history
                (velocity). <strong>Filled</strong> marks are watched by nothing —
                the payload; <strong>hollow</strong> marks are ones an anchor theme
                already watches — context. The alarm sits top-right.
              </p>
              <details className="group">
                <summary className="text-[11px] text-text-tertiary cursor-pointer marker:text-text-tertiary hover:text-text-secondary">
                  Which corpus, and what the strip below the plane is
                </summary>
                <p className="m-0 mt-1.5 text-[11px] text-text-tertiary leading-[1.55]">
                  Counted out of the <strong>archive corpus</strong> (GDELT alone,
                  ~27 headlines/day back to 2026-06-14) rather than the denser
                  combined one. A share is a fraction OF a corpus, so a velocity is
                  only meaningful where the corpus is defined the same way every
                  day, and the combined corpus is not — Brave contributes ~90
                  headlines/day inside an 8-day window and none before it
                  (ADR-0153). Share is used rather than mention counts, which rise
                  on a day the fetcher simply worked better. Both kinds of mark are
                  named, the covered ones in lighter ink, so no mark on this plane
                  is one you can see but cannot identify. Phrases whose velocity
                  cannot be measured yet wait in the strip below the plane, with
                  its loudest few named beneath it; they rise into the plane as
                  history accrues.
                </p>
              </details>
            </div>

            {/* Plane ‖ figures, in ONE card, with the plane narrowed to make
                room rather than the pair split across cards.

                The table column is FIXED at 340px, not a fraction. It has a hard
                minimum (319px min-content, measured) and no use for more, so a
                fraction would either starve it at narrow widths or waste width at
                wide ones; fixing it hands every remaining pixel to the plane,
                which is the element that can actually use them.

                The plane then fits whatever is left by narrowing its own viewBox
                (S_WIDTH, see the geometry note above) instead of scaling down
                into the column. That distinction is the whole reason this layout
                is possible at all: at 780px card / 746px inner, the plot column
                is 386px, and the previous 720-wide viewBox rendered there at
                0.672x with its 9px axis labels at 6.0px. Same column, same
                marks, legible type — the difference is which quantity gives.

                `items-start` so neither column stretches; `min-w-0` on both
                because a grid item defaults to min-width:auto and would refuse
                to shrink below its content, which is what makes the table's
                `overflow-x-auto` engage instead of the card scrolling. */}
            <div className="grid gap-5 items-start figures:grid-cols-[minmax(0,1fr)_340px] [&>*]:min-w-0">
              <DetectionScatter series={series} />

              <div className="border-l border-border pl-5">
                <SeriesTable series={top} />

                {dropped > 0 && (
                  <p className="m-0 mt-2 text-[11px] text-text-tertiary leading-[1.55]">
                    The {top.length} loudest of{" "}
                    <span className="num">{series.length}</span> tracked
                    narratives — every one of the {series.length} is a mark in
                    the plane or a tick in the strip below it.
                  </p>
                )}

                {/* Emerging block: same width as the table, separated by a border. */}
                <div className="mt-3 pt-2.5 border-t border-border">
                  <h4 className="m-0 mb-1 text-[10.5px] uppercase tracking-[0.1em] text-text-secondary">
                    Emerging
                  </h4>
                  {emerging.length === 0 ? (
                    velocityMeasurable ? (
                      <p className="m-0 text-[11px] text-text-secondary leading-[1.55]">
                        None of the <span className="num">{funnel ? funnel.tracked - funnel.unwatched : 0}</span> attributed
                        phrases are accelerating <em>outside</em> an anchor — that is a
                        finding, not an empty state.
                      </p>
                    ) : (
                      <p className="m-0 text-[11px] text-text-secondary leading-[1.55]">
                        Velocity not measurable yet (ADR-0141): {uncoveredCount} of{" "}
                        <span className="num">{series?.length ?? 0}</span> tracked
                        phrases are watched by no anchor theme, and whether any is
                        breaking out cannot be said until the history accrues.
                      </p>
                    )
                  ) : (
                    <ul className="m-0 p-0 list-none flex flex-col gap-1">
                      {emerging.slice(0, 6).map((s) => (
                        <li key={s.phrase}>
                          <span className="text-text-primary">{s.phrase}</span>
                          <span className="text-text-tertiary">
                            {" "}
                            — <span className="num">{sharePct(s.latest.share)}</span>,
                            velocity{" "}
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
                  <p className="m-0 mt-1.5 text-[11px] text-text-tertiary">
                    Shadow signal.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
