// frontend/components/risk/DeltaChip.tsx
//
// A signed change chip for a risk metric vs the previous portfolio_risk run.
// Whether an increase is good or bad depends on the metric — a bigger VaR is
// worse, a bigger Sharpe is better — so the caller says which via `higherIsWorse`
// and the chip colours accordingly. A null delta (only one run exists) renders
// nothing, never a fake "0.00".

"use client";
import { isNum } from "@/lib/risk/analytics";
import type { MetricDelta } from "@/lib/risk/riskBoard";

export function DeltaChip({
  delta,
  format,
  higherIsWorse = true,
}: {
  delta: MetricDelta;
  /** Formats the absolute delta magnitude into display units. */
  format: (v: number) => string;
  /** true → an increase is bad (red); false → an increase is good (green). */
  higherIsWorse?: boolean;
}) {
  if (!isNum(delta.delta)) return null;
  const d = delta.delta;
  if (d === 0) {
    return (
      <span
        className="num text-[10px] px-1.5 py-px rounded bg-bg-elevated text-text-tertiary border border-border"
        title={
          delta.previousDate
            ? `unchanged vs ${delta.previousDate}`
            : "unchanged vs previous run"
        }
      >
        ±0
      </span>
    );
  }
  const worse = higherIsWorse ? d > 0 : d < 0;
  const cls = worse ? "bg-short-dim text-short" : "bg-long-dim text-long";
  const arrow = d > 0 ? "▲" : "▼";
  return (
    <span
      className={`num text-[10px] px-1.5 py-px rounded ${cls}`}
      title={
        delta.previous !== null
          ? `previous ${format(delta.previous)}${
              delta.previousDate ? ` (${delta.previousDate})` : ""
            } · Δ vs prior run`
          : "Δ vs prior run"
      }
    >
      {arrow} {format(Math.abs(d))}
    </span>
  );
}
