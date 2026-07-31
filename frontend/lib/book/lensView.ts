// frontend/lib/book/lensView.ts
//
// Which lens /book shows, and how it decides.
//
// Migration 062 re-keyed `research_recommendations` and `book_holdings` on
// (run_date, lens) — more than one row can now exist for the same run_date.
// A page that queries either table without an explicit lens filter gets
// whichever row Postgres happens to return, which is exactly the ambiguity
// this module exists to remove: /book resolves ONE lens, from the URL,
// before it ever queries the book itself.
//
// Pure functions only — no query inside either one — so the resolution logic
// is testable against fixed arrays rather than a live Supabase call, the same
// separation `lib/book/positionEdge.ts` and `lib/turnover.ts` already use.

import type { Lens } from "@/components/LensSelector";

export const DEFAULT_LENS: Lens = "multi_asset";

const KNOWN_LENSES: readonly Lens[] = [
  "multi_asset",
  "credit",
  "rates",
  "equity",
  "fx",
  "commodity",
];

export function isLens(value: string | null | undefined): value is Lens {
  return !!value && (KNOWN_LENSES as readonly string[]).includes(value);
}

/**
 * Which lenses have a published book for the MOST RECENT run_date present in
 * `rows`, given a plain (run_date, lens) row list ordered newest-first.
 *
 * A NULL `lens` predates migration 062's NOT NULL default and means
 * multi_asset — the migration backfilled exactly this for the one row that
 * carried it. This function does not sort `rows`; the caller's own
 * `ORDER BY run_date DESC` is the source of truth for "most recent".
 */
export function availableLensesForLatestRun(
  rows: Array<{ run_date: string | null; lens: string | null }>,
): { runDate: string | null; lenses: Lens[] } {
  const latest = rows.find((r) => r.run_date)?.run_date ?? null;
  if (!latest) return { runDate: null, lenses: [] };
  const seen = new Set<Lens>();
  for (const r of rows) {
    if (r.run_date !== latest) continue;
    seen.add(isLens(r.lens) ? r.lens : DEFAULT_LENS);
  }
  return { runDate: latest, lenses: Array.from(seen) };
}

/**
 * The lens /book actually queries.
 *
 * The URL's `?lens=` value wins only when it BOTH names a real lens and has a
 * published book today; multi_asset otherwise. An unrecognised string and a
 * lens that quietly stopped publishing fail the same way, on purpose — a
 * reader who follows a stale link to a lens with no book today should land on
 * the default book, never an empty page with no explanation of why.
 */
export function resolveLens(
  requested: string | null | undefined,
  available: Lens[],
): Lens {
  if (isLens(requested) && available.includes(requested)) return requested;
  return DEFAULT_LENS;
}
