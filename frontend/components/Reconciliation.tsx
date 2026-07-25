// frontend/components/Reconciliation.tsx
//
// One presentation of "does the arithmetic reproduce the published number".
//
// /method rendered this twice from scratch — three hand-rolled <Stat> tiles for
// HypeScore and three more for EdgeScore, each with its own tone logic and its own
// verdict copy. The numbers differ (0-100 vs [-1,1], 2dp vs 4dp, unsigned vs
// signed) but the claim is identical, and a claim rendered two ways can be made
// two ways. /book's lineage steps now carry the same verdict through
// WorkedExampleStep.reconciliation rather than growing a third.
//
// The verdict itself is computed in lib/method/reconciliation.ts and tested there;
// this file only draws it. The `null` state — nothing to compare — is drawn
// explicitly rather than as a failure, per §2 of docs/design-goals.md.

import {
  deltaCaption,
  deltaTone,
  type ReconciliationVerdict,
} from "@/lib/method/reconciliation";
import { Stat } from "@/components/method/primitives";

export interface ReconciliationLabels {
  /** e.g. "Recomputed from sub-scores" */
  recomputed: string;
  /** e.g. "Persisted themes.hype_score" */
  persisted: string;
  /** Caption under the recomputed tile. */
  recomputedSub?: string;
  /** Caption under the persisted tile. */
  persistedSub?: string;
}

export interface ReconciliationFormat {
  /** Decimal places. HypeScore reads at 2, EdgeScore at 4. */
  decimals: number;
  /** Whether to force an explicit +/-. EdgeScore's sign IS the trade direction. */
  signed: boolean;
}

function fmt(
  n: number | null,
  { decimals, signed }: ReconciliationFormat,
): string {
  if (n === null) return "—";
  const body = n.toFixed(decimals);
  return signed && n >= 0 ? `+${body}` : body;
}

/**
 * Three tiles: what the arithmetic yields, what the database holds, and the gap.
 *
 * `compact` swaps the tiles for an inline three-row block, for use inside a
 * lineage step where a row of cards would dominate the step it belongs to.
 */
export function Reconciliation({
  verdict,
  labels,
  format,
  compact = false,
}: {
  verdict: ReconciliationVerdict;
  labels: ReconciliationLabels;
  format: ReconciliationFormat;
  compact?: boolean;
}) {
  const tone = deltaTone(verdict);
  const caption = deltaCaption(verdict);
  const delta = fmt(verdict.delta, format);

  if (compact) {
    const toneClass =
      tone === "good"
        ? "text-long"
        : tone === "bad"
          ? "text-short"
          : "text-text-tertiary";
    return (
      <div
        className="mt-2 rounded-[6px] border border-border overflow-hidden text-[11.5px]"
        data-testid="reconciliation"
      >
        {[
          [labels.recomputed, fmt(verdict.recomputed, format), ""],
          [labels.persisted, fmt(verdict.persisted, format), ""],
          ["Δ", delta, toneClass],
        ].map(([label, value, cls], i) => (
          <div
            key={label}
            className={`px-2.5 py-1.5 flex justify-between gap-3 items-baseline ${
              i < 2 ? "border-b border-border" : ""
            }`}
          >
            <span className="text-text-secondary">{label}</span>
            <span className={`num font-semibold text-right ${cls}`}>{value}</span>
          </div>
        ))}
        <div className="px-2.5 pb-1.5 text-[10.5px] text-text-tertiary">
          {caption}
        </div>
      </div>
    );
  }

  return (
    <div
      className="grid grid-cols-1 sm:grid-cols-3 gap-3"
      data-testid="reconciliation"
    >
      <Stat
        label={labels.recomputed}
        value={fmt(verdict.recomputed, format)}
        sub={labels.recomputedSub}
      />
      <Stat
        label={labels.persisted}
        value={fmt(verdict.persisted, format)}
        sub={labels.persistedSub}
      />
      <Stat label="Δ" value={delta} tone={tone} sub={caption} />
    </div>
  );
}
