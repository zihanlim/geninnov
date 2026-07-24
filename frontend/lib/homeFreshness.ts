// What date labels the landing page, and what clock measures its freshness?
//
// These are two different things and conflating them put a wrong date on the site's
// first screen. The theme data shown is identified by its `run_date` — the
// forward-dated market date the run is FOR (e.g. "2026-07-25"), the same identifier
// the status bar, /method and /book all display. Its freshness — "Updated 8m ago" —
// is measured from when the pipeline actually FINISHED writing, a wall-clock
// timestamp (e.g. 2026-07-24T20:13Z) that is hours earlier and on the previous
// calendar day.
//
// The landing header had sourced its "RUN DATE" from `themes.updated_at`, a write
// timestamp: on 2026-07-25 the themes row held the 07-25 hype scores while updated_at
// read 2026-07-24T20:13, so the page dated the current run 2026-07-24 —
// contradicting its own status bar. And it measured age from that same date, which is
// only safe because updated_at is a timestamp; the run_date is NOT — `new
// Date("2026-07-25")` is in the future relative to a 20:13Z finish, so measuring age
// from it clamps to 0 ("just now") over data that is hours old. Hence the split.

export interface RunDateSources {
  /** pipeline_runs.run_date — the canonical run identifier. */
  pipeRunDate?: string | null;
  /** pipeline_runs.finished_at — the wall-clock finish time. */
  pipeFinishedAt?: string | null;
  /** themes.updated_at — a fallback write timestamp when pipeline_runs is unread. */
  themeUpdatedAt?: string | null;
}

export interface ResolvedRunDates {
  /** The date to DISPLAY as RUN DATE / LAST PIPELINE RUN. */
  display: string | null;
  /** The timestamp to measure "Updated N ago" freshness from. Never a bare run_date,
   *  which has no time component and would sit in the future relative to the finish. */
  freshnessTs: string | null;
}

export function resolveRunDates(s: RunDateSources): ResolvedRunDates {
  return {
    display: s.pipeRunDate ?? s.themeUpdatedAt ?? null,
    freshnessTs: s.pipeFinishedAt ?? s.themeUpdatedAt ?? null,
  };
}

/** Seconds between `ts` and `now`, floored at 0. Infinity when `ts` is absent. */
export function ageSeconds(ts: string | null, now: number): number {
  if (!ts) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor((now - new Date(ts).getTime()) / 1000));
}
