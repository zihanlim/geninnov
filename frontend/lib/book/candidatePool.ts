// frontend/lib/book/candidatePool.ts
//
// Which candidates belong to the book the reader is looking at.
//
// THE BUG THIS EXISTS TO CLOSE. `trade_candidates` is the L1 pool and has NO
// lens column — migration 062 gave one to `research_recommendations` and
// `book_holdings`, and L1 ranks names before a lens is chosen, so there is only
// ever one candidate table for every lens. /book reads it unfiltered, which was
// correct while one book existed per run_date and is wrong now: on
// `/book?lens=credit` the "Cleared the screen — not taken" panel listed UNG,
// GLD, BABA, SLV, KWEB, GDX, MSFT, QQQ and 23 others as candidates that
// "passed every screen" for a credit book, and summarised them as "39 held back
// · 13 short" on a page whose own thesis says no short candidates exist in the
// pool.
//
// Those 31 names did not pass the screen. The page said so itself, two panels
// apart: the screening funnel's own `lens = credit` stage reads
// `removed: 31, remaining: 11`, and Pool depth reads `11 candidates → 3
// independent ideas → 3 held`. The panel between them said 42. One page, three
// pool sizes, and the largest one was the multi-asset book's.
//
// WHY THE POOL IS TAKEN FROM `independent_ideas` AND NOT FROM A TICKER LIST.
// The lens membership rule is `LENS_TICKER_FALLBACK` in
// backend/services/q1_agent.py — a hardcoded per-asset-class ticker set. A copy
// of it here would be a second authority on what "credit" means, drifting the
// first time a ticker is added to one and not the other, and the drift would be
// invisible: the panel would simply list a name the agent never saw, which is
// the defect we are fixing. `independent_ideas` is written by the SAME node that
// applied the filter, is keyed on (run_date, lens), and enumerates the pool BY
// NAME and BY SIDE — complex members plus standalones, per side. It is already
// read by /book for Pool depth. So this module derives the pool from the book's
// own record of it and imports no ticker list at all.
//
// `candidate_correlations` would have been the shorter route and is the wrong
// one: it holds only candidates with a measurable 252-day correlation, so a
// name with no usable return history is absent from it. Keying off that map
// would silently drop in-lens candidates for lacking history — the exact
// unmeasured-is-not-absent error ClearedNotTaken's own docstring warns about.
//
// WHAT THIS DELIBERATELY DOES NOT DO. It does not touch the default page. The
// gate is measured, not named: `restrictToLensPool` returns a pool only when the
// funnel's own `lens = …` stage removed something. Under multi_asset that stage
// reads `removed: 0` — there is nothing for this filter to remove, so it returns
// null and the panel renders exactly as it does today. No lens is special-cased
// by name, so a lens that admits everything is correctly a no-op and a lens
// added later needs no change here.
//
// It also does not address the cap-30 stage. Under multi_asset that stage
// removed 12 names from a 42-candidate pool, so the panel lists 12 names the
// agent was never shown either. That is a DIFFERENT defect with a different
// answer — those names did clear every filter and were truncated out of the LLM
// context by conviction rank, so the honest fix is to say so in the row, not to
// hide it. Left alone on purpose rather than folded in here.
//
// Pure: no React, no Supabase. Generic over the candidate row so it does not
// import from `components/`.

/** A `research_recommendations.screening_funnel` stage, as /book reads it. */
export interface FunnelStage {
  stage: string;
  remaining: number;
  removed: number;
}

/** One correlation complex from `independent_ideas`, as PoolDepth reads it. */
interface IdeaComplexLike {
  members?: string[];
}

/** One side of `independent_ideas`. */
interface SideDepthLike {
  complexes?: IdeaComplexLike[];
  standalone?: string[];
}

/** `research_recommendations.independent_ideas`, both sides optional. */
export type IndependentIdeasLike = Partial<
  Record<"long" | "short", SideDepthLike | null | undefined>
>;

export type Side = "long" | "short";

/** The key a pool membership test is made on. Side matters: a lens that admits
 *  TLT long has not admitted TLT short, and the pool is recorded per side. */
export function poolKey(asset: string, direction: string): string {
  return `${asset}::${direction}`;
}

/**
 * Every (asset, side) the agent for this lens was shown, from the lens-keyed
 * `independent_ideas` row.
 *
 * Returns null — not an empty set — when the field is missing or names nothing.
 * The two must not collapse: an empty set filters every candidate away and would
 * blank the panel on any row written before `independent_ideas` existed, turning
 * a missing field into the false claim that no candidate cleared the screen.
 * Null means "no pool recorded, do not filter"; the caller decides.
 */
export function poolAssets(
  ideas: IndependentIdeasLike | null | undefined,
): Set<string> | null {
  if (!ideas) return null;
  const keys = new Set<string>();
  for (const side of ["long", "short"] as Side[]) {
    const depth = ideas[side];
    if (!depth) continue;
    for (const cx of depth.complexes ?? []) {
      for (const member of cx.members ?? []) {
        if (member) keys.add(poolKey(member, side));
      }
    }
    for (const name of depth.standalone ?? []) {
      if (name) keys.add(poolKey(name, side));
    }
  }
  return keys.size > 0 ? keys : null;
}

/**
 * How many candidates the lens stage removed, or null when the stage is absent.
 *
 * Matched on the `lens = ` prefix rather than an exact string, because the stage
 * is written as `lens = credit` — it carries the lens in its own label
 * (q1_agent.screen_candidates). Null for a row written before the stage existed,
 * which is not the same fact as zero: zero means the lens admitted everything.
 */
export function lensRemoved(
  funnel: FunnelStage[] | null | undefined,
): number | null {
  const stage = (funnel ?? []).find((s) => s?.stage?.startsWith("lens = "));
  if (!stage) return null;
  return Number.isFinite(stage.removed) ? stage.removed : null;
}

/**
 * How many candidates the `candidate pool (cap N)` stage truncated away, or null
 * when the stage is absent. Prefix-matched for the same reason as the lens
 * stage: the label carries the cap in it.
 */
export function capRemoved(
  funnel: FunnelStage[] | null | undefined,
): number | null {
  const stage = (funnel ?? []).find((s) => s?.stage?.startsWith("candidate pool (cap"));
  if (!stage) return null;
  return Number.isFinite(stage.removed) ? stage.removed : null;
}

/**
 * What the panel should DO about candidates that never reached the agent.
 *
 * Two stages can keep a `trade_candidates` row out of the pool the agent saw,
 * and they call for opposite treatments — which is the whole reason this is a
 * mode and not a boolean:
 *
 *   "filter" — the LENS removed names. Those were never in this book's universe,
 *              so listing them under "cleared the screen" is a false claim about
 *              the book's own selection. Excluded, and counted.
 *   "mark"   — the CAP truncated names. Those cleared every filter and were cut
 *              from the LLM's context window by conviction rank, which is a fact
 *              ABOUT THE CAP and the only on-page evidence that it binds at all.
 *              Hiding them would delete that evidence. Kept, and marked.
 *   "none"   — nothing to say, or nothing to say it with.
 *
 * A run where BOTH stages removed names resolves to "filter", not to a third
 * mode. Per-name attribution is impossible — `independent_ideas` records what
 * SURVIVED both stages, so a missing name could owe its absence to either — and
 * between the two errors available, hiding a cap-truncated in-lens name costs a
 * row while showing an out-of-lens name is the defect this module exists to
 * close. The counts are reported separately so the sentence can still be true.
 */
export type PoolMode = "filter" | "mark" | "none";

export interface PoolRestriction {
  /** Every (asset, side) that reached the agent, or null when unrecorded. */
  pool: Set<string> | null;
  mode: PoolMode;
  /** Candidates the lens stage removed. Null when unrecorded, 0 when none. */
  lensRemoved: number | null;
  /** Candidates the cap stage truncated. Null when unrecorded, 0 when none. */
  capRemoved: number | null;
}

/**
 * What /book should do with an unfiltered `trade_candidates` read, given the
 * lens-keyed book row it is rendering beside.
 *
 * `mode` is never anything but "none" unless `independent_ideas` enumerates a
 * pool. Failing OPEN is the right direction: an over-long candidate list is a
 * page that shows more than it should, while a wrongly-empty one is a page
 * claiming the screen cleared nothing. The first is the bug we already had; the
 * second would be worse than the bug.
 */
export function restrictToLensPool(
  ideas: IndependentIdeasLike | null | undefined,
  funnel: FunnelStage[] | null | undefined,
): PoolRestriction {
  const lens = lensRemoved(funnel);
  const cap = capRemoved(funnel);
  const base = { lensRemoved: lens, capRemoved: cap };

  // Order matters: lens before cap. A run where both removed names must filter,
  // because it is the lens error that puts another book's names on this page.
  const mode: PoolMode =
    lens && lens > 0 ? "filter" : cap && cap > 0 ? "mark" : "none";
  if (mode === "none") return { ...base, pool: null, mode };

  const pool = poolAssets(ideas);
  return { ...base, pool, mode: pool ? mode : "none" };
}

/**
 * Drop the candidates this book's lens never admitted.
 *
 * Only mode "filter" removes anything. Mode "mark" deliberately passes
 * everything through, and the distinction is a factual one rather than a
 * convenience: a cap-truncated name **did** clear every screen and **was not**
 * taken, so a held row's "also cleared, not taken" footer states nothing false
 * about it — dropping it would delete a true statement. A lens-removed name
 * never cleared this book's screen at all, so the same footer would be a false
 * one. Filter the false claim, keep the true one.
 *
 * A consumer that can distinguish the two (`ClearedNotTaken`, which has a row to
 * mark) should not call this at all for mode "mark"; it should ask
 * `reachedAgent` per row.
 *
 * Modes "mark" and "none" pass the array through BY IDENTITY, so the default
 * page cannot be perturbed even by a re-sort or a copy.
 */
export function inLensCandidates<T extends { asset: string; direction: string }>(
  candidates: T[],
  restriction: PoolRestriction | Set<string> | null,
): T[] {
  const pool =
    restriction instanceof Set
      ? restriction
      : restriction?.mode === "filter"
        ? restriction.pool
        : null;
  if (!pool) return candidates;
  return candidates.filter((c) => pool.has(poolKey(c.asset, c.direction)));
}

/** Did this candidate reach the agent? `null` when the pool is unrecorded — not
 *  the same fact as "no", and it must not render as one. */
export function reachedAgent(
  candidate: { asset: string; direction: string },
  restriction: PoolRestriction | null | undefined,
): boolean | null {
  if (!restriction || restriction.mode === "none" || !restriction.pool) return null;
  return restriction.pool.has(poolKey(candidate.asset, candidate.direction));
}
