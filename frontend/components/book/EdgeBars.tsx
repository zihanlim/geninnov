// frontend/components/book/EdgeBars.tsx
//
// The EdgeScore 5-component decomposition, per position. This is the CROWN JEWEL
// of /book: it shows *why* a position is long or short, decomposed into the five
// signals the engine weights — Trend, Regime, Carry, Value and a contrarian
// Sentiment tilt — whose weights are read live from scoring_config (ADR-0033), not
// hardcoded here. It demonstrates they RECONCILE to the EdgeScore whose sign is the
// resolved side: Carry/Value are null for names where they are not computable, so the
// weights renormalise over what is present (ADR-0036) — Σ(w·v) ÷ Σ(w) — and the panel
// prints that division rather than leaving the raw contributions visibly failing to
// sum to the score.
//
// Replaces the stale 2-component (Trend + Regime only) view. Each row is a
// diverging bar centred on zero: the bar length is the WEIGHTED contribution
// (what moves the score), and the raw [-1, 1] component is shown alongside so a
// PM can see both "how strong is the signal" and "how much did it matter".

"use client";
import type { ResolvedEdge } from "@/lib/book/positionEdge";
import {
  edgeContributions,
  recomputeEdgeScore,
  type EdgeWeights,
  type ThemeEdge,
} from "@/lib/themeSignals";

const fmtSigned = (v: number | null, dp = 2): string =>
  v === null || v === undefined || Number.isNaN(v)
    ? "n/a"
    : `${v >= 0 ? "+" : ""}${v.toFixed(dp)}`;

// The half-width the longest possible weighted contribution can occupy. A single
// component's contribution is bounded by its weight (since |raw| ≤ 1), so we
// scale each bar against the largest weight to keep the axis honest across rows.
function ContributionBar({
  contribution,
  maxAbs,
  present,
}: {
  contribution: number;
  maxAbs: number;
  present: boolean;
}) {
  const frac = maxAbs > 0 ? Math.min(Math.abs(contribution) / maxAbs, 1) : 0;
  const widthPct = frac * 50; // half the track, diverging from centre
  const positive = contribution >= 0;
  return (
    <div className="relative h-3 bg-bg-elevated rounded-sm overflow-hidden">
      {/* zero axis */}
      <div className="absolute left-1/2 top-0 bottom-0 w-px bg-border-strong" />
      {present && frac > 0 && (
        <div
          className="absolute top-0 bottom-0"
          style={{
            width: `${widthPct}%`,
            ...(positive
              ? { left: "50%", background: "var(--long)", borderRadius: "0 2px 2px 0" }
              : { right: "50%", background: "var(--short)", borderRadius: "2px 0 0 2px" }),
          }}
        />
      )}
    </div>
  );
}

export default function EdgeBars({
  edge,
  weights,
  direction,
}: {
  edge: ResolvedEdge | ThemeEdge;
  weights: EdgeWeights;
  direction: "long" | "short";
}) {
  const contribs = edgeContributions(edge, weights);
  const dirColor = direction === "long" ? "var(--long)" : "var(--short)";

  // Scale bars against the largest single weight so the widest possible
  // contribution (|raw|=1) fills the half-track — magnitudes stay comparable.
  const maxAbs = Math.max(weights.trend, weights.regime, weights.carry, weights.value);

  // Reconcile the way the pipeline computes, not by summing raw contributions.
  // `compute_edge_score` drops a null component and renormalises the weights over
  // what is present (ADR-0036), so a plain Σ understates |EdgeScore| whenever any
  // component is missing and fired a false "differs from the sum" warning on every
  // such position. Same root cause as /method's RECONCILIATION FAILURE (ADR-0064).
  const recomp = recomputeEdgeScore(edge, weights);
  const anyPresent = contribs.some((c) => c.raw !== null);
  // When Carry/Value are absent the shown "× wt" contributions sum to `weightedSum`
  // but the EdgeScore is `weightedSum / weightPresent`. Without printing that division
  // the panel reads "+0.19 +0.01 +0.004 → +0.43" and the numbers visibly do not add up.
  const renormalised =
    anyPresent && recomp.weightPresent > 0 && recomp.weightPresent < 0.999;

  return (
    <div>
      <div
        className="grid items-center gap-x-2.5 gap-y-1.5 text-[11.5px]"
        style={{ gridTemplateColumns: "58px 1fr 46px 52px" }}
      >
        <span className="text-text-tertiary uppercase tracking-[0.08em] text-[10px]">
          Signal
        </span>
        <span className="text-text-tertiary text-[10px] text-center">
          short ← contribution → long
        </span>
        <span className="text-text-tertiary text-[10px] text-right">raw</span>
        <span className="text-text-tertiary text-[10px] text-right">× wt</span>

        {contribs.map((c) => {
          const present = c.raw !== null;
          return (
            <FragmentRow
              key={c.key}
              name={c.key}
              raw={c.raw}
              weight={c.weight}
              contribution={c.contribution}
              maxAbs={maxAbs}
              present={present}
            />
          );
        })}
      </div>

      {/* Sum → EdgeScore → side */}
      <div className="mt-2.5 pt-2.5 border-t border-border flex items-center justify-between text-[12px]">
        <span className="text-text-secondary">
          Σ contributions → EdgeScore →{" "}
          <span className="font-semibold" style={{ color: dirColor }}>
            {direction.toUpperCase()}
          </span>
        </span>
        <span className="num font-semibold" style={{ color: dirColor }}>
          {edge.edge_score !== null
            ? fmtSigned(edge.edge_score, 3)
            : anyPresent
              ? `${fmtSigned(recomp.edgeScore, 3)} (derived)`
              : "—"}
        </span>
      </div>
      {renormalised && (
        <p className="m-0 mt-1 text-[10.5px] text-text-tertiary leading-[1.5]">
          <span className="num">{fmtSigned(recomp.weightedSum, 3)}</span> weighted sum ÷{" "}
          <span className="num">{recomp.weightPresent.toFixed(2)}</span> present weight ={" "}
          <span className="num">{fmtSigned(recomp.edgeScore, 3)}</span> — the shown
          contributions renormalise over the components scored for this name; Carry and
          Value are not, so their weight is not spread onto the rest (ADR-0036).
        </p>
      )}
      {edge.edge_score !== null &&
        anyPresent &&
        Math.abs(recomp.edgeScore - edge.edge_score) > 0.01 && (
          <p className="m-0 mt-1 text-[10.5px] text-text-tertiary leading-[1.5]">
            Persisted EdgeScore differs from this derivation by{" "}
            <span className="num">
              {fmtSigned(edge.edge_score - recomp.edgeScore, 3)}
            </span>{" "}
            — a component or weight changed since this book was sized.
          </p>
        )}
    </div>
  );
}

function FragmentRow({
  name,
  raw,
  weight,
  contribution,
  maxAbs,
  present,
}: {
  name: string;
  raw: number | null;
  weight: number;
  contribution: number;
  maxAbs: number;
  present: boolean;
}) {
  return (
    <>
      <span
        className="text-text-secondary"
        title={`${name} weight ${weight.toFixed(2)}`}
      >
        {name}
      </span>
      <ContributionBar
        contribution={contribution}
        maxAbs={maxAbs}
        present={present}
      />
      <span
        className={`num text-right ${present ? "text-text-primary" : "text-text-tertiary"}`}
      >
        {fmtSigned(raw)}
      </span>
      <span
        className={`num text-right ${present ? "text-text-secondary" : "text-text-tertiary"}`}
      >
        {present ? fmtSigned(contribution, 3) : "—"}
      </span>
    </>
  );
}
