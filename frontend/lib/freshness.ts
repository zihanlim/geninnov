// How old is the book, in the only unit that matters for a weekday pipeline?
//
// The daily job runs weekdays after the US close. When a run dies — as it did on
// 2026-07-24, aborting on a single dropped quote — nothing on the site said so. The
// book page printed "RUN DATE 2026-07-22" and the status bar said "2d ago", both
// factual, neither alarming, in the same neutral grey as "5 min ago". A reader
// scanning a $100M book had no signal that these were stale positions.
//
// Calendar days are the wrong unit: a Friday book read on Sunday is two days old and
// perfectly current. Business days are the honest measure of "how many runs should
// have happened since".

/** Business days strictly between two dates (Mon–Fri, no holiday calendar). */
export function businessDaysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  if (b <= a) return 0;
  let count = 0;
  const cur = new Date(a);
  while (cur.getTime() < b) {
    cur.setUTCDate(cur.getUTCDate() + 1);
    const d = cur.getUTCDay();
    if (d !== 0 && d !== 6) count += 1;
  }
  return count;
}

/**
 * Three states, not two — and the third is the point.
 *
 * `stale` alone cannot distinguish "we judged this book and it is current" from "we could
 * not judge it at all", because both answer `false`. A book row whose `run_date` is null
 * or unparseable therefore rendered with **no freshness signal whatsoever**, which reads
 * as currency to anyone scanning it. That is the `known` / `unknown` conflation design
 * goal 2 exists to forbid, on the one field that tells a reader whether these are today's
 * positions.
 *
 * The original code returned `stale: false` here on purpose, reasoning that inventing a
 * staleness warning from a missing date would be a fabricated claim. That half is right
 * and is preserved: `businessDays` stays 0 and `stale` stays false, because a business-day
 * count we cannot compute must not be asserted. What was missing is that `stale: false`
 * is *itself* a claim — "a run has not been missed" — and we have no basis for it either.
 */
export type FreshnessVerdict =
  /** Judged, and within the window. */
  | "current"
  /** Judged, and a run that should have happened did not. */
  | "stale"
  /** Not judgeable — there was no usable run date to measure against. */
  | "unjudgeable";

export type Staleness = {
  /** Business days since the run date. 0 = today's run, and 0 when unjudgeable. */
  businessDays: number;
  /**
   * True only when a run should have happened and did not.
   *
   * Read `verdict` instead when the distinction matters: `stale === false` covers both
   * "current" and "we could not tell", and those are different claims.
   */
  stale: boolean;
  /** Plain sentence for the reader, or null when current. */
  message: string | null;
  /** Which of the three states this is. */
  verdict: FreshnessVerdict;
  /**
   * Why the verdict is `unjudgeable`, and null otherwise.
   *
   * Required in practice for the same reason `pick_outcomes.void_reason` is required by a
   * CHECK constraint (ADR-0090): an absence with no stated cause is the shape that lets a
   * gap pass for a pass.
   */
  unjudgeableReason: string | null;
};

/**
 * Judge a run_date. `today` is injectable so this is a pure function and testable
 * without freezing the clock.
 *
 * Threshold is 2 business days, not 1. The pipeline runs AFTER the close, so on any
 * given weekday morning the newest book is legitimately yesterday's — flagging at 1
 * would cry wolf every single morning, and a warning that is always on is a warning
 * nobody reads.
 */
export function assessStaleness(
  runDate: string | null | undefined,
  today: Date = new Date(),
): Staleness {
  if (!runDate) {
    return {
      businessDays: 0,
      stale: false,
      message: null,
      verdict: "unjudgeable",
      unjudgeableReason:
        "No run date was returned with this record, so its age cannot be measured.",
    };
  }
  const parsed = new Date(`${runDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return {
      businessDays: 0,
      stale: false,
      message: null,
      verdict: "unjudgeable",
      unjudgeableReason: `The run date ${JSON.stringify(runDate)} is not a date, so its age cannot be measured.`,
    };
  }
  const businessDays = businessDaysBetween(parsed, today);
  if (businessDays < 2) {
    return {
      businessDays,
      stale: false,
      message: null,
      verdict: "current",
      unjudgeableReason: null,
    };
  }
  return {
    businessDays,
    stale: true,
    verdict: "stale",
    unjudgeableReason: null,
    message:
      `This book is from ${runDate} — ${businessDays} business days ago. ` +
      `The pipeline runs every weekday after the US close, so a book this old means ` +
      `recent runs have not completed. These are not today's positions.`,
  };
}
