// frontend/components/book/PositionMarginalRisk.tsx
//
// P1 per-position marginal risk, shown inside an expanded row. Answers "how much
// of the book's risk is THIS line, and what is it doubling up with?" — the two
// questions an IC asks about any single position's contribution to the whole.
//
// Both numbers are best-effort from data already fetched by the page:
//   • gross/net contribution from the picks' notionals (marginalContribution)
//   • the top correlated sibling from research_recommendations.correlation_pairs
//
// A null sibling means "no flagged correlation for this leg" — not "uncorrelated
// with everything" — because only pairs above the flagging threshold persist.

"use client";
import type {
  MarginalContribution,
  TopSibling,
} from "@/lib/book/positionEdge";

const fmtPct = (v: number | null, dp = 1): string =>
  v === null || v === undefined || Number.isNaN(v)
    ? "—"
    : `${(v * 100).toFixed(dp)}%`;

const fmtSignedPct = (v: number | null, dp = 1): string =>
  v === null || v === undefined || Number.isNaN(v)
    ? "—"
    : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(dp)}%`;

const fmtSignedBeta = (v: number): string =>
  `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;

export default function PositionMarginalRisk({
  marginal,
  sibling,
}: {
  marginal: MarginalContribution;
  sibling: TopSibling | null;
}) {
  return (
    <div className="rounded-[8px] border border-border overflow-hidden text-[12px]">
      <div className="px-3 py-2 flex justify-between gap-3 border-b border-border">
        <span
          className="text-text-secondary"
          title="This position's notional as a share of book gross (|long| + |short|)."
        >
          Share of book gross
        </span>
        <span className="num font-semibold text-right">
          {fmtPct(marginal.grossShare)}
        </span>
      </div>
      <div className="px-3 py-2 flex justify-between gap-3 border-b border-border">
        <span
          className="text-text-secondary"
          title="Signed contribution to book net exposure (+ long, − short), over the same gross base. Summing across positions recovers the book's net/gross."
        >
          Contribution to net
        </span>
        <span
          className="num font-semibold text-right"
          style={{
            color:
              marginal.netContribution === null
                ? undefined
                : marginal.netContribution >= 0
                  ? "var(--long)"
                  : "var(--short)",
          }}
        >
          {fmtSignedPct(marginal.netContribution)}
        </span>
      </div>
      <div
        className="px-3 py-2 flex justify-between gap-3 items-baseline"
        style={{ background: "var(--bg-elevated)" }}
      >
        <span
          className="text-text-secondary"
          title="Strongest flagged correlation involving this asset. Only pairs above the backend flagging threshold are persisted."
        >
          Top correlated sibling
        </span>
        {sibling ? (
          <span className="text-right">
            <span className="num font-semibold">{sibling.asset}</span>{" "}
            <span
              className="num"
              style={{
                color: sibling.sameDirection ? "var(--short)" : "var(--long)",
              }}
            >
              ρ {fmtSignedBeta(sibling.corr)}
            </span>
            <span className="text-text-tertiary text-[10.5px] ml-1.5">
              {sibling.sameDirection ? "doubling" : "hedge"}
            </span>
          </span>
        ) : (
          <span
            className="text-text-tertiary text-[11px] text-right"
            title="No pair involving this asset cleared the flagging threshold in research_recommendations.correlation_pairs."
          >
            none flagged
          </span>
        )}
      </div>
    </div>
  );
}
