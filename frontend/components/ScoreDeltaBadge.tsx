"use client";
import { useState } from "react";

/**
 * Inline delta badge with hover tooltip that breaks down the HypeScore change
 * by sub-component (Volume, Sentiment, Correlation, Momentum).
 *
 * Usage:
 *   <ScoreDeltaBadge
 *     delta={theme.delta_1d}
 *     components={{
 *       volume: +8.0,
 *       sentiment: -2.0,
 *       correlation: +1.0,
 *       momentum: -3.0,
 *     }}
 *   />
 */
interface Props {
  /** Net HypeScore change vs prior day. */
  delta: number | undefined;
  /** Optional sub-score breakdown (signed deltas). */
  components?: {
    volume?: number;
    sentiment?: number;
    correlation?: number;
    momentum?: number;
  };
  /** Optional override label. */
  label?: string;
  /** Render as "wow" (week-over-week) or "1d" (day-over-day). */
  variant?: "1d" | "wow";
}

const LABELS: Record<keyof NonNullable<Props["components"]>, string> = {
  volume: "Volume",
  sentiment: "Sent.",
  correlation: "Corr",
  momentum: "Mom.",
};

function fmtSigned(n: number, digits = 1) {
  return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}`;
}

export default function ScoreDeltaBadge({ delta, components, label, variant = "1d" }: Props) {
  const [open, setOpen] = useState(false);
  const d = delta ?? 0;
  const positive = d >= 0;
  const color = positive ? "text-long" : "text-short";
  const glyph = positive ? "▲" : "▼";

  const hasComponents = components && Object.values(components).some((v) => v !== undefined);

  return (
    <span
      className="relative inline-block"
      onMouseEnter={() => hasComponents && setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span
        className={`text-[12px] num ${color} ${hasComponents ? "cursor-help border-b border-dotted border-current" : ""}`}
        title={hasComponents ? "Hover for sub-score breakdown" : undefined}
      >
        {glyph} {fmtSigned(d)} {label ?? variant}
      </span>
      {open && hasComponents && (
        <span
          className="absolute z-20 left-1/2 -translate-x-1/2 top-full mt-1.5 px-3 py-2 rounded-md text-[11.5px] whitespace-nowrap pointer-events-none"
          style={{
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-strong)",
            color: "var(--text-primary)",
            boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
          }}
        >
          <span className="block text-[10px] uppercase tracking-[0.08em] text-text-tertiary mb-1">
            Sub-score breakdown
          </span>
          <span className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-left num">
            {(["volume", "sentiment", "correlation", "momentum"] as const).map((k) => {
              const v = components![k];
              if (v === undefined) return null;
              return (
                <span key={k} className="contents">
                  <span className="text-text-tertiary text-[11px]">{LABELS[k]}</span>
                  <span
                    className={`text-right num ${v >= 0 ? "text-long" : "text-short"}`}
                  >
                    {fmtSigned(v, 1)}
                  </span>
                </span>
              );
            })}
          </span>
        </span>
      )}
    </span>
  );
}
