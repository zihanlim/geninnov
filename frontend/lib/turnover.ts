// How much of the book changed since the last run?
//
// "Would you get the same answer tomorrow?" is the first thing anyone asks of a
// systematic book, and nothing here answered it. The data was always present —
// research_recommendations keeps one row per run_date — but no code compared two of
// them, so the question could only be answered by hand-diffing two days.
//
// Names, not weights. A position that survives at a different size is the same idea;
// a position that appears or disappears is a different book. Weight drift is real but
// second-order, and conflating the two would hide the question that matters.
//
// Pure module rather than a function inside the component, so it is unit-testable:
// the vitest project is `environment: node` with no JSX loader, and importing a .tsx
// to reach one pure function does not compile.

export interface Turnover {
  /** Names in both books, sorted. */
  kept: string[];
  /** Names in today's book only. */
  opened: string[];
  /** Names in the previous book only. */
  closed: string[];
  /** Jaccard distance: share of the COMBINED name set not common to both, 0..1. */
  pct: number;
}

export function turnover(current: string[], previous: string[]): Turnover {
  // Arrays + Array.from rather than Set spreads: the tsconfig target predates
  // downlevelIteration, so [...set] does not compile here.
  const a = Array.from(new Set(current));
  const b = Array.from(new Set(previous));
  const inA = new Set(a);
  const inB = new Set(b);
  const kept = a.filter((x) => inB.has(x)).sort();
  const opened = a.filter((x) => !inB.has(x)).sort();
  const closed = b.filter((x) => !inA.has(x)).sort();
  const union = new Set(a.concat(b)).size;
  // Denominator is the union, not today's count: closing a name is as much a change
  // as opening one, and dividing by today's book alone would hide a book that halved.
  const pct = union === 0 ? 0 : 1 - kept.length / union;
  return { kept, opened, closed, pct };
}

/** Below this size ratio the two books are not the same kind of object and the
 *  turnover number is measuring the pipeline, not the view. Half is the line: a book
 *  that lost or gained more than half its names between runs did not "rotate". */
const COMPARABLE_RATIO = 0.5;

/**
 * Is a turnover reading a like-for-like comparison?
 *
 * On 2026-07-24 the book holds 8 names and the previous run holds 2, so turnover
 * reads 100% — arithmetically correct and nearly meaningless: the earlier run was
 * produced by a narrower universe, not by a different market view. Printing "100% of
 * the book changed" without saying that is precisely the failure this codebase keeps
 * removing — a correct number presented as if it meant something.
 *
 * Returns null when the two books are comparable, or a sentence naming the mismatch.
 */
export function comparabilityCaveat(
  currentN: number,
  previousN: number,
): string | null {
  if (currentN === 0 || previousN === 0) return null;
  const ratio = Math.min(currentN, previousN) / Math.max(currentN, previousN);
  if (ratio >= COMPARABLE_RATIO) return null;
  return (
    `The previous run held ${previousN} name${previousN === 1 ? "" : "s"} against ` +
    `today's ${currentN}, so this is not a like-for-like comparison — it mostly ` +
    `measures how much the candidate universe changed between runs, not how much ` +
    `the view did. Treat it as a floor on stability once both runs are full books.`
  );
}
