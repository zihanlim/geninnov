// frontend/lib/book/lensProbe.ts
//
// Which lenses published a book for the latest run_date.
//
// THE ONE LENS-UNQUALIFIED READ IN THE TREE, AND THE ONLY ONE ALLOWED TO BE.
//
// Every other read of `research_recommendations` carries an explicit lens
// filter, and tests/unit/lens-qualified-reads.test.ts parses the source to
// prove it rather than trusting a comment. The reason is migration 062: a
// run_date can now carry BOTH the multi-asset book and the credit-lens book,
// so `.order("run_date", desc).limit(1)` with no lens filter returns whichever
// of today's two books Postgres happens to order first. That bug is invisible
// in review — the query looks exactly like the single-book code that was
// correct for years.
//
// This read is exempt because it is the DISCOVERY query. It does not fetch a
// book; it asks which books exist. Filtering it by lens would be circular: it
// could only ever confirm the lens the caller already assumed, and it could
// never report a lens the caller did not think to ask about — which is the
// entire question. So the exemption is not a relaxation of the rule, it is the
// one place the rule cannot be stated.
//
// It lives in its own module rather than being added to `lensView.ts` because
// lensView.ts is pure by contract: its header says "no query inside either
// one", and its tests run the resolution logic against fixed arrays with no
// Supabase anywhere in the graph. Putting a network call in it would make the
// one function that DECIDES which lens a page shows untestable without a
// client. The decision stays pure over there; the fetch is this thin wrapper
// around it.

import { supabase } from "@/lib/supabase";
import { availableLensesForLatestRun, DEFAULT_LENS } from "@/lib/book/lensView";
import type { Lens } from "@/components/LensSelector";

// Re-exported so a caller that consumes `lenses` gets the fallback value from
// the same import. Two import paths for "what do I show when discovery came
// back empty" is how the answer drifts between the pages that ask it.
export { DEFAULT_LENS };

/**
 * The lenses with a published book on the most recent `run_date` present in
 * `research_recommendations`.
 *
 * Returns `{ runDate: null, lenses: [] }` on a read error AND on an empty
 * table. The caller decides what to do with that, deliberately: "the query
 * failed", "no run has ever published", and "one lens published" are three
 * different facts, and a fallback baked in here would flatten the first two
 * into a lens list that looks measured. A page that wants
 * `DEFAULT_LENS`-on-empty says so at its own call site, where it can also say
 * why on screen.
 */
export async function fetchLensesForLatestRun(): Promise<{
  runDate: string | null;
  lenses: Lens[];
}> {
  // LENS-DISCOVERY-EXEMPT: this read is intentionally not lens-qualified.
  const { data, error } = await supabase
    .from("research_recommendations")
    .select("run_date, lens")
    .order("run_date", { ascending: false })
    // 40 rows, not 1. A `limit(1)` here would return ONE of today's books and
    // report "one lens published today" however many actually did — the same
    // wrong-book failure this module exists to avoid, one level up. 40 spans
    // several run_dates at up to six lenses each, so the newest date's full set
    // is inside the window even on a run that wrote every lens.
    .limit(40);

  if (error || !data) return { runDate: null, lenses: [] };

  // The reducer, not a reimplementation of it: `availableLensesForLatestRun`
  // already owns the NULL-lens-means-multi_asset rule (migration 062 backfilled
  // exactly one such row) and the "newest run_date only" scope. A second copy
  // of either would be a second answer.
  return availableLensesForLatestRun(
    data as Array<{ run_date: string | null; lens: string | null }>,
  );
}
