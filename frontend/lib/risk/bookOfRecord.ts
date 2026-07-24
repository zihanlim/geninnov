// Are the positions /risk is computing on the same names the book publishes?
//
// ADR-0040 made the published book the book of record: /book and /risk describe the
// same names, and every risk number is computed on them. That invariant holds once a
// run finishes — and breaks for the several minutes in the middle of one.
//
// The daily pipeline writes L1's FULL candidate set to portfolio_positions, computes
// VaR/CVaR/Sharpe/HHI on it, hands that to L5 as a reasoning input, and only then
// reconciles the table down to the names L5 actually picked and recomputes. Caught in
// the act on 2026-07-25: /risk said "39 positions" and reported HHI 138 while the
// published book held 8. Both numbers were real; neither described the book.
//
// The check is the disagreement itself rather than a pipeline status flag. A status
// field says what the telemetry believes; comparing the two tables says what is
// actually on the page — and it also catches a run where L5 failed outright and the
// reconciliation never happened at all.

export interface Reconciliation {
  /** True when every position corresponds to a published pick and vice versa. */
  reconciled: boolean;
  positionCount: number;
  bookCount: number;
  /** Held in portfolio_positions but not published. Sorted, capped by the caller. */
  extra: string[];
  /** True when there is no published book to compare against yet. */
  bookMissing: boolean;
}

export function reconcileToBook(
  positionAssets: readonly string[],
  bookAssets: readonly string[] | null | undefined,
): Reconciliation {
  const positions = Array.from(new Set(positionAssets.filter(Boolean)));
  if (!bookAssets) {
    // No published book at all. Not a disagreement — there is nothing to disagree
    // with, and calling that "unreconciled" would flag a first-ever run as broken.
    return {
      reconciled: true,
      positionCount: positions.length,
      bookCount: 0,
      extra: [],
      bookMissing: true,
    };
  }
  const book = new Set(bookAssets.filter(Boolean));
  const extra = positions.filter((a) => !book.has(a)).sort();
  const missing = Array.from(book).filter((a) => !positions.includes(a));
  return {
    reconciled: extra.length === 0 && missing.length === 0,
    positionCount: positions.length,
    bookCount: book.size,
    extra,
    bookMissing: false,
  };
}
