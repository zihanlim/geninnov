// Does an unheld candidate express a bet the book already has?
//
// The first version of this answered with raw price correlation and got three rows
// backwards on the live book. Today the book is SHORT ARKK. QQQ, IWM and SPY are all
// long candidates correlated +0.77 to +0.80 with ARKK, and the panel labelled each of
// them "largely already held". A long SPY against a short ARKK is not a duplicate of
// a held position — it is close to its reverse. The page was telling a reader the
// opposite of the truth, in the one column that exists to explain omissions.
//
// Correlation between two PRICES says nothing about whether two POSITIONS express the
// same bet. That needs both directions:
//
//     aligned = rho x sign(candidate side) x sign(held side)
//
// +1 means the candidate would add to a bet the book already has. -1 means it would
// net against one. The threshold is applied to `aligned`, never to |rho|, because the
// absolute value throws away exactly the bit that decides which sentence is true —
// the same mistake ADR-0042 removed from HypeScore's correlation sub-score.

/** |aligned| at or above which a candidate is not an independent idea. Matches
 *  book_metrics.HIGH_CORR_THRESHOLD, the level /risk uses to flag a correlated pair
 *  inside the book — one threshold, one meaning across the site. */
export const HIGH_CORR_THRESHOLD = 0.7;

export type OverlapKind =
  /** Would add to a bet the book already holds. */
  | "same-bet"
  /** Would net against a bet the book already holds. */
  | "offsets"
  /** Neither — a genuinely separate idea that was passed over. */
  | "independent"
  /** No return history, or the held side is unknown: not classifiable. */
  | "unmeasured";

export interface Overlap {
  /** Direction-adjusted correlation, or null when not classifiable. */
  aligned: number | null;
  kind: OverlapKind;
}

const sign = (d: string | undefined | null) => (d === "short" ? -1 : 1);

export function classifyOverlap(
  candidateDirection: "long" | "short",
  heldDirection: "long" | "short" | null | undefined,
  corr: number | null | undefined,
): Overlap {
  if (corr === null || corr === undefined || Number.isNaN(corr)) {
    return { aligned: null, kind: "unmeasured" };
  }
  if (heldDirection !== "long" && heldDirection !== "short") {
    // The correlation is real but unclassifiable without the held side. Saying
    // "independent" here would be a guess wearing a verdict's clothes.
    return { aligned: null, kind: "unmeasured" };
  }
  const aligned = corr * sign(candidateDirection) * sign(heldDirection);
  if (aligned >= HIGH_CORR_THRESHOLD) return { aligned, kind: "same-bet" };
  if (aligned <= -HIGH_CORR_THRESHOLD) return { aligned, kind: "offsets" };
  return { aligned, kind: "independent" };
}

/** The sentence shown in the Read column. Stated as a consequence for the book, not
 *  as a reason attributed to L5 — the agent's rationale belongs in the thesis. */
export function overlapLabel(kind: OverlapKind, closest: string | null): string {
  switch (kind) {
    case "same-bet":
      return "largely already held";
    case "offsets":
      return closest ? `would net against ${closest}` : "would net against a holding";
    case "independent":
      return "independent — passed over";
    default:
      return "unmeasured";
  }
}
