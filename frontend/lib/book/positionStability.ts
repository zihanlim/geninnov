// Which of these positions does the agent actually pick every time?
//
// ADR-0050's replication harness re-runs the reasoning step on frozen inputs and
// reports how much of the book changes. It answered 25% overall / 33% long / 13%
// short — a useful aggregate, and the wrong shape for the question Q1 asks. "A third
// of the long side is a coin flip" tells a reader the book is partly arbitrary
// without telling them WHICH part, which is worse than not knowing: it taints the
// names that were in fact unanimous.
//
// The harness already records both lists (`stable_names`, `unstable_names`). Joined
// to the book they say, per position, whether this specific trade survived every
// sample. On 2026-07-25: JPM, NUE, SVXY and all four shorts appeared in all three
// samples; XLE and UNH did not. That is a per-trade conviction statement of exactly
// the kind Q1 asks for, and it was being thrown away in favour of a percentage.
//
// The join is only valid within a run. A replication measured against a different
// candidate pool says nothing about today's names, so a date mismatch yields
// "unmeasured" rather than a stale label — the same rule the correlation column
// follows with its em dash.

export type Stability = "stable" | "coinflip" | "unmeasured";

export interface ReplicationNames {
  /** Signed names ("L:JPM") present in every sample. */
  stable: string[];
  /** Signed names present in some samples but not all. */
  unstable: string[];
  /** run_date the replication was measured on. */
  endDate: string | null;
  /** How many model samples the figure rests on. */
  samples: number;
}

export function signedName(direction: string, asset: string): string {
  return `${(direction || "?")[0].toUpperCase()}:${asset}`;
}

/**
 * Classify one held position.
 *
 * `bookRunDate` and `repl.endDate` must match: the replication is a statement about
 * one pool on one day, and carrying it forward would attach yesterday's variance to
 * today's names.
 */
export function positionStability(
  direction: string,
  asset: string,
  repl: ReplicationNames | null | undefined,
  bookRunDate: string | null | undefined,
): Stability {
  if (!repl || !repl.endDate || !bookRunDate) return "unmeasured";
  if (repl.endDate !== bookRunDate) return "unmeasured";
  // One sample cannot disagree with itself, so it can never establish stability.
  if (repl.samples < 2) return "unmeasured";
  const key = signedName(direction, asset);
  if (repl.stable.includes(key)) return "stable";
  if (repl.unstable.includes(key)) return "coinflip";
  return "unmeasured";
}

/** Short label for the row. Deliberately not a verdict — a coin flip is not a bad
 *  trade, it is one of several the agent rates equally. */
export function stabilityLabel(s: Stability, samples: number): string | null {
  switch (s) {
    case "stable":
      return `in all ${samples} reruns`;
    case "coinflip":
      return `in some of ${samples} reruns`;
    default:
      return null;
  }
}
