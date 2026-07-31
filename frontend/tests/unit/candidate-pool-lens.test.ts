// frontend/tests/unit/candidate-pool-lens.test.ts
//
// `trade_candidates` has no lens column. It is the single L1 pool every lens
// screens from, so /book reading it unfiltered described the MULTI-ASSET pool
// under every lens: on the 2026-07-30 run, `/book?lens=credit` listed 31 names
// its own screening funnel had removed at the `lens = credit` stage as
// candidates that "passed every screen", summarised them as "39 held back · 13
// short", and sat two panels below a Pool depth reading `11 candidates → 3
// independent ideas → 3 held`.
//
// The fixtures below are the real 2026-07-30 rows, trimmed. They are what make
// this test worth having: the numbers 42 / 31 / 11 / 3 are the ones that were on
// screen disagreeing with each other, so a regression reproduces the actual
// defect rather than a synthetic one.
//
// The invariant that outranks the fix: under a lens whose funnel stage removed
// NOTHING, no filter is applied and the list is byte-for-byte today's. That is
// gated on the measurement (`removed > 0`), never on the string "multi_asset" —
// a lens added later must not need an edit here to behave correctly.

import { describe, expect, it } from "vitest";
import {
  inLensCandidates,
  lensRemoved,
  poolAssets,
  restrictToLensPool,
  type FunnelStage,
  type IndependentIdeasLike,
} from "@/lib/book/candidatePool";

/** research_recommendations.screening_funnel, lens='credit', run 2026-07-30. */
const CREDIT_FUNNEL: FunnelStage[] = [
  { stage: "L1 ranked candidates", removed: 0, remaining: 42 },
  { stage: "conviction override (ADR-0046)", removed: 0, remaining: 42 },
  { stage: "lens = credit", removed: 31, remaining: 11 },
  { stage: "factor R^2 >= 0.10", removed: 0, remaining: 11 },
  { stage: "dedupe (asset, direction)", removed: 0, remaining: 11 },
  { stage: "editorial veto (ADR-0171)", removed: 0, remaining: 11 },
  { stage: "candidate pool (cap 30)", removed: 0, remaining: 11 },
];

/** The same run's multi_asset funnel — the lens stage removes nothing. */
const MULTI_ASSET_FUNNEL: FunnelStage[] = [
  { stage: "L1 ranked candidates", removed: 0, remaining: 42 },
  { stage: "lens = multi_asset", removed: 0, remaining: 42 },
  { stage: "candidate pool (cap 30)", removed: 12, remaining: 30 },
];

/** research_recommendations.independent_ideas, lens='credit', run 2026-07-30. */
const CREDIT_IDEAS: IndependentIdeasLike = {
  long: {
    complexes: [
      {
        members: ["AGG", "ANGL", "EMB", "HYG", "IEF", "JNK", "LQD", "SHY", "TLT"],
      },
    ],
    standalone: ["BKLN", "BIL"],
  },
  short: { complexes: [], standalone: [] },
};

type Cand = { asset: string; direction: "long" | "short" };

/** The 42 rows of `trade_candidates` for 2026-07-30, sides as published. */
const POOL_42: Cand[] = [
  // The 11 the credit lens admitted, all long.
  ...(["AGG", "ANGL", "EMB", "HYG", "IEF", "JNK", "LQD", "SHY", "TLT", "BKLN", "BIL"].map(
    (asset) => ({ asset, direction: "long" as const }),
  )),
  // The 13 shorts — every one of them outside the credit lens.
  ...(["BABA", "GLD", "SLV", "KWEB", "GDX", "UNG", "PDD", "NOC", "ARKK", "MSFT", "MCHI", "F", "XLV"].map(
    (asset) => ({ asset, direction: "short" as const }),
  )),
  // The remaining 18 longs, also outside the credit lens.
  ...(["QQQ", "SPY", "IWM", "SMH", "TSM", "VRT", "VST", "GEV", "UNH", "JPM", "XLF", "XLU", "EEM", "EFA", "EWJ", "FXI", "JD", "RTX"].map(
    (asset) => ({ asset, direction: "long" as const }),
  )),
];

describe("lensRemoved", () => {
  it("reads the count off the funnel's own lens stage", () => {
    // Matched on the `lens = ` PREFIX: the stage carries the lens in its label
    // (`lens = credit`), so an exact-string match would never fire.
    expect(lensRemoved(CREDIT_FUNNEL)).toBe(31);
    expect(lensRemoved(MULTI_ASSET_FUNNEL)).toBe(0);
  });

  it("returns null, not 0, when the row predates the stage", () => {
    // Zero means the lens admitted everything; null means nobody recorded it.
    // Collapsing them would make an old row look like a lens that filtered
    // nothing, which is a claim the row cannot support.
    expect(lensRemoved([{ stage: "L1 ranked candidates", removed: 0, remaining: 42 }])).toBeNull();
    expect(lensRemoved(null)).toBeNull();
    expect(lensRemoved(undefined)).toBeNull();
  });
});

describe("poolAssets", () => {
  it("enumerates both complex members and standalones, keyed by side", () => {
    const pool = poolAssets(CREDIT_IDEAS);
    expect(pool).not.toBeNull();
    expect(pool!.size).toBe(11);
    expect(pool!.has("EMB::long")).toBe(true);   // a complex member
    expect(pool!.has("BIL::long")).toBe(true);   // a standalone
  });

  it("keys on the SIDE the pool recorded, not the ticker alone", () => {
    // The lens admitted TLT long. It did not admit TLT short, and the agent was
    // never shown it: a ticker-only membership test would list a side this book
    // never screened.
    const pool = poolAssets(CREDIT_IDEAS)!;
    expect(pool.has("TLT::long")).toBe(true);
    expect(pool.has("TLT::short")).toBe(false);
  });

  it("returns null rather than an empty set when nothing is recorded", () => {
    // An empty set filters every candidate away, so a row written before
    // independent_ideas existed would render as "no candidate cleared the
    // screen" — a false claim manufactured from a missing column.
    expect(poolAssets(null)).toBeNull();
    expect(poolAssets({})).toBeNull();
    expect(poolAssets({ long: { complexes: [], standalone: [] } })).toBeNull();
  });
});

describe("restrictToLensPool", () => {
  it("restricts the credit pool to the 11 the lens admitted", () => {
    const { pool, removed } = restrictToLensPool(CREDIT_IDEAS, CREDIT_FUNNEL);
    expect(removed).toBe(31);
    const inLens = inLensCandidates(POOL_42, pool);
    expect(POOL_42).toHaveLength(42);
    expect(inLens).toHaveLength(11);
    // 42 − 11 = 31, the funnel's own figure. The panel and the funnel now agree.
    expect(POOL_42.length - inLens.length).toBe(removed);
  });

  it("drops every short under a long-only lens", () => {
    // The credit book's thesis says no short candidates exist in the pool while
    // the panel summarised "13 short". Both sentences were on one page.
    const { pool } = restrictToLensPool(CREDIT_IDEAS, CREDIT_FUNNEL);
    const inLens = inLensCandidates(POOL_42, pool);
    expect(inLens.filter((c) => c.direction === "short")).toHaveLength(0);
  });

  it("leaves the multi-asset pool identical, and by identity", () => {
    // THE INVARIANT. The default page must not move. `inLensCandidates` returns
    // the SAME array reference, so not even a re-sort or a copy can perturb it.
    const { pool, removed } = restrictToLensPool(null, MULTI_ASSET_FUNNEL);
    expect(removed).toBe(0);
    expect(pool).toBeNull();
    expect(inLensCandidates(POOL_42, pool)).toBe(POOL_42);
  });

  it("does not fold in the cap-30 stage", () => {
    // The multi_asset funnel's cap-30 removed 12 names. Those DID clear every
    // filter and were truncated out of the LLM's context by conviction rank, so
    // the honest answer is to label the row, not to hide it — a different defect
    // with a different fix. This filter must stay out of it.
    const { pool } = restrictToLensPool(
      { long: { standalone: ["QQQ"] }, short: { standalone: ["GLD"] } },
      MULTI_ASSET_FUNNEL,
    );
    expect(pool).toBeNull();
  });

  it("fails OPEN when the lens filtered but the pool was never recorded", () => {
    // An over-long candidate list is the bug we already had; a wrongly-empty one
    // claims the screen cleared nothing, which is worse. So a funnel that says
    // the lens removed names, with no `independent_ideas` to restrict to,
    // renders today's unfiltered list rather than a blank panel.
    const { pool, removed } = restrictToLensPool(null, CREDIT_FUNNEL);
    expect(removed).toBe(31);
    expect(pool).toBeNull();
    expect(inLensCandidates(POOL_42, pool)).toBe(POOL_42);
  });
});
