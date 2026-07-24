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

export type Staleness = {
  /** Business days since the run date. 0 = today's run. */
  businessDays: number;
  /** True once a run should have happened and did not. */
  stale: boolean;
  /** Plain sentence for the reader, or null when current. */
  message: string | null;
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
    return { businessDays: 0, stale: false, message: null };
  }
  const parsed = new Date(`${runDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return { businessDays: 0, stale: false, message: null };
  }
  const businessDays = businessDaysBetween(parsed, today);
  if (businessDays < 2) {
    return { businessDays, stale: false, message: null };
  }
  return {
    businessDays,
    stale: true,
    message:
      `This book is from ${runDate} — ${businessDays} business days ago. ` +
      `The pipeline runs every weekday after the US close, so a book this old means ` +
      `recent runs have not completed. These are not today's positions.`,
  };
}
