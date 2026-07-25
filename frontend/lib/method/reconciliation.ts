// frontend/lib/method/reconciliation.ts
//
// "Does the arithmetic reproduce the number we published?"
//
// This is the single question /method exists to answer, and it was answered twice
// by hand — once for HypeScore (app/method/page.tsx, tolerance 0.05) and once for
// EdgeScore (tolerance 0.005) — each inlining its own recomputed/persisted/delta
// comparison, its own tolerance test, and its own verdict copy. Two copies of a
// correctness claim is one copy too many: they can disagree about what
// "reconciles" means, and neither could be tested, because both lived inside a
// Next route file that cannot export anything but `default`.
//
// The verdict lives here as a pure function so it can be tested directly, and so
// /book's lineage steps can carry the same verdict rather than inventing a third.

/**
 * HypeScore is persisted on 0–100, so 0.05 is a rounding-level gap.
 * EdgeScore is persisted on [-1, 1], a hundredth of the scale, so it needs a
 * tolerance an order of magnitude tighter — and its sign is the trade direction,
 * which is why a "small" absolute gap there is not small.
 *
 * Named here rather than inlined at each call site because the verdict tile and
 * its failure note are separate pieces of markup that both test the threshold: two
 * literals is how they come to disagree about whether the book reconciles.
 */
export const HYPE_TOLERANCE = 0.05;
export const EDGE_TOLERANCE = 0.005;

/** The outcome of comparing a recomputation against what was persisted. */
export interface ReconciliationVerdict {
  /** What applying the live weights to the persisted components yields. */
  recomputed: number | null;
  /** What the database actually holds — what the rest of the product reads. */
  persisted: number | null;
  /** recomputed − persisted. Null when either side is missing. */
  delta: number | null;
  /**
   * True when |delta| is within tolerance, false when it is not, and **null when
   * the comparison could not be made at all**.
   *
   * The three-state result is the point. Collapsing "no persisted value to
   * compare" into `false` would report a reconciliation *failure* for a row that
   * simply has not been scored yet — an accusation rather than a gap — and
   * collapsing it into `true` would claim a proof that never ran. Callers must
   * handle null explicitly.
   */
  reconciles: boolean | null;
  /** The threshold the verdict used, kept for the audit trail. */
  tolerance: number;
}

const isNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/**
 * Compare a recomputed value against a persisted one.
 *
 * `tolerance` is a absolute magnitude on the same scale as the values: HypeScore
 * lives on 0–100 and tolerates 0.05, EdgeScore lives on [-1,1] and tolerates
 * 0.005. Passing the wrong scale's tolerance is the way this goes quietly wrong,
 * so it is always explicit — there is no default.
 */
export function reconcile(
  recomputed: number | null | undefined,
  persisted: number | null | undefined,
  tolerance: number,
): ReconciliationVerdict {
  const r = isNum(recomputed) ? recomputed : null;
  const p = isNum(persisted) ? persisted : null;
  const delta = r !== null && p !== null ? r - p : null;
  return {
    recomputed: r,
    persisted: p,
    delta,
    reconciles: delta === null ? null : Math.abs(delta) < tolerance,
    tolerance,
  };
}

/** Stat tone for the delta tile. Muted when there was nothing to compare. */
export function deltaTone(
  v: ReconciliationVerdict,
): "good" | "bad" | "muted" {
  if (v.reconciles === null) return "muted";
  return v.reconciles ? "good" : "bad";
}

/** One-line verdict for the delta tile's caption. */
export function deltaCaption(v: ReconciliationVerdict): string {
  if (v.reconciles === null) return "no persisted value to compare";
  return v.reconciles ? "reconciles exactly" : "does NOT reconcile";
}
