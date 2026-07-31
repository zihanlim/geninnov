// The funnel exists to make ONE claim readable: which step removed the position
// that is not in the book. These tests are built around the live 2026-07-30 run,
// because that run is the reason the panel was written — the agent chose five
// longs and five shorts, and the sizer zeroed EMB against the turnover cap.
//
// Everything here is a pure-function test against fixed objects. No Supabase, no
// React: the derivations are what must not drift, and a component test would let
// a wrong number pass as long as it rendered.

import { describe, expect, it } from "vitest";
import {
  buildBookFunnel,
  funnelBounds,
  funnelHeadline,
  removingStages,
  splitPicks,
  splitSigned,
  type FunnelInputs,
} from "@/lib/book/bookFunnel";

/** The 2026-07-30 multi-asset run, trimmed to the columns the funnel reads. */
const LIVE: FunnelInputs = {
  screeningFunnel: [
    { stage: "L1 ranked candidates", removed: 0, remaining: 42 },
    { stage: "conviction override (ADR-0046)", removed: 0, remaining: 42 },
    { stage: "lens = multi_asset", removed: 0, remaining: 42 },
    { stage: "factor R^2 >= 0.10", removed: 0, remaining: 42 },
    { stage: "dedupe (asset, direction)", removed: 0, remaining: 42 },
    { stage: "editorial veto (ADR-0171)", removed: 0, remaining: 42 },
    { stage: "candidate pool (cap 30)", removed: 12, remaining: 30 },
  ],
  independentIdeas: {
    long: {
      count: 10,
      names: 19,
      complexes: [
        {
          members: ["ANGL", "EMB", "HYG", "IEF", "JNK", "LQD", "SHY", "TLT"],
          strongest: "EMB",
        },
        { members: ["SMH", "TSM", "VRT"], strongest: "SMH" },
      ],
      standalone: ["GEV", "UNH", "JD", "RTX", "F", "BKLN", "JPM", "BIL"],
      shortfall: {
        held: 4,
        available: 5,
        empty_slots: 1,
        passed_over: ["EMB", "JD", "RTX", "BKLN", "JPM", "BIL"],
        named: ["EMB"],
        unexplained: ["JD", "RTX", "BKLN", "JPM", "BIL"],
        satisfied: true,
      },
    },
    short: {
      count: 7,
      names: 11,
      complexes: [
        { members: ["BABA", "KWEB", "MCHI"], strongest: "BABA" },
        { members: ["GDX", "GLD", "SLV"], strongest: "GLD" },
      ],
      standalone: ["UNG", "PDD", "NOC", "ARKK", "MSFT"],
    },
  },
  heuristicWeights: {
    F: 0.0548, EMB: 0.2, GEV: 0.066, GLD: -0.1196, NOC: -0.0807,
    PDD: -0.0853, SMH: 0.0736, UNG: -0.0711, UNH: 0.0749, BABA: -0.0932,
  },
  picks: [
    { asset: "BABA", direction: "short" }, { asset: "UNH", direction: "long" },
    { asset: "GLD", direction: "short" }, { asset: "NOC", direction: "short" },
    { asset: "SMH", direction: "long" }, { asset: "GEV", direction: "long" },
    { asset: "PDD", direction: "short" }, { asset: "UNG", direction: "short" },
    { asset: "F", direction: "long" },
  ],
  optimizerResult: {
    zeroed: ["EMB"],
    binding_constraints: ["turnover at cap"],
    realised_turnover: 0.5999999699999999,
    turnover_cap: 0.6,
    forced_exit_turnover: 0.3522691,
    feasible: true,
  },
};

describe("splitSigned", () => {
  it("counts longs and shorts by sign", () => {
    const s = splitSigned(LIVE.heuristicWeights);
    expect(s).toMatchObject({ long: 5, short: 5, total: 10 });
  });

  it("treats a zero weight as no position, not as a long", () => {
    // The optimizer writes exact 0.0 for a name it declined. Counting that as a
    // long would report a book one position larger than the one that exists.
    const s = splitSigned({ A: 0.1, B: 0, C: -0.1 });
    expect(s).toMatchObject({ long: 1, short: 1, total: 2 });
    expect(s.assets).toEqual(["A", "C"]);
  });

  it("survives a null column", () => {
    expect(splitSigned(null)).toMatchObject({ long: 0, short: 0, total: 0 });
  });
});

describe("funnelBounds", () => {
  it("reads first and last remaining positionally, not by stage name", () => {
    // Stage NAMES change (the lens stage arrived with migration 062). Matching
    // on a label would make this return null the next time one is renamed.
    expect(funnelBounds(LIVE.screeningFunnel)).toEqual({ first: 42, last: 30 });
  });

  it("returns nulls rather than zeros when the column is absent", () => {
    expect(funnelBounds(null)).toEqual({ first: null, last: null });
    expect(funnelBounds([])).toEqual({ first: null, last: null });
  });
});

describe("buildBookFunnel — the live 2026-07-30 run", () => {
  const f = buildBookFunnel(LIVE);

  it("draws five nodes, ending at the published book", () => {
    expect(f.available).toBe(true);
    expect(f.nodes.map((n) => n.id)).toEqual([
      "screen", "context", "ideas", "chosen", "published",
    ]);
  });

  it("carries the counts the run actually published", () => {
    const by = Object.fromEntries(f.nodes.map((n) => [n.id, n]));
    expect(by.screen.total).toBe(42);
    expect(by.context).toMatchObject({ total: 30, long: 19, short: 11 });
    expect(by.ideas).toMatchObject({ total: 17, long: 10, short: 7 });
    expect(by.chosen).toMatchObject({ total: 10, long: 5, short: 5 });
    expect(by.published).toMatchObject({ total: 9, long: 4, short: 5 });
  });

  it("records that the agent MET five and five", () => {
    // The whole point. If this ever reads false on this fixture, the panel is
    // telling readers the screen came up short when it did not.
    expect(f.agentHitTarget).toBe(true);
  });

  it("names EMB on the sizer edge, and marks that edge notable", () => {
    const sizer = f.edges.find((e) => e.to === "published");
    expect(sizer?.names).toEqual(["EMB"]);
    expect(sizer?.removed).toBe(1);
    expect(sizer?.notable).toBe(true);
    expect(sizer?.detail).toContain("turnover at cap");
    expect(sizer?.detail).toContain("60.0%");
  });

  it("reports the correlation step as reclassification, not removal", () => {
    // 30 names -> 17 ideas. A reader who reads this as a filter concludes the
    // pool was smaller than it was, which is the misreading PoolDepth existed
    // to prevent and this panel inherits.
    const corr = f.edges.find((e) => e.to === "ideas");
    expect(corr?.removed).toBe(13);
    expect(corr?.detail).toContain("ONE idea");
    expect(corr?.names).toEqual(
      expect.arrayContaining([
        "{ANGL, EMB, HYG, IEF, JNK, LQD, SHY, TLT} -> EMB",
        "{SMH, TSM, VRT} -> SMH",
      ]),
    );
  });

  it("every node names the column its figure came from (goal 1)", () => {
    for (const n of f.nodes) {
      expect(n.source, `${n.id} has no source`).toMatch(/^research_recommendations\./);
    }
  });
});

describe("buildBookFunnel — absence is stated, never filled (goal 2)", () => {
  it("returns unavailable, not an empty chain, when there is no book", () => {
    const f = buildBookFunnel({ ...LIVE, picks: [] });
    expect(f.available).toBe(false);
    expect(f.cause).toContain("picks");
    expect(f.nodes).toEqual([]);
  });

  it("renders a null total with a cause when screening_funnel predates the column", () => {
    const f = buildBookFunnel({ ...LIVE, screeningFunnel: null });
    const screen = f.nodes.find((n) => n.id === "screen");
    expect(screen?.total).toBeNull();
    expect(screen?.cause).toContain("migration 022");
  });

  it("never reports 0 for a stage whose input is missing", () => {
    // A 0 here would claim the screen found nothing — a different and much
    // worse assertion than "this column is not on this row".
    const f = buildBookFunnel({
      ...LIVE, screeningFunnel: null, independentIdeas: null, heuristicWeights: null,
    });
    for (const n of f.nodes) {
      if (n.id === "published") continue;
      expect(n.total, `${n.id} fabricated a zero`).not.toBe(0);
      if (n.total === null) expect(n.cause).toBeTruthy();
    }
  });
});

describe("funnelHeadline", () => {
  it("speaks only when the agent hit the target and the sizer then cut it", () => {
    expect(funnelHeadline(buildBookFunnel(LIVE))).toContain(
      "The agent selected five long and five short",
    );
    expect(funnelHeadline(buildBookFunnel(LIVE))).toContain("EMB");
  });

  it("stays silent when the pool was genuinely thin", () => {
    // A run that came back with four longs because only four ideas existed must
    // NOT get a sentence blaming the sizer. Same shape, opposite cause.
    const thin = buildBookFunnel({
      ...LIVE,
      heuristicWeights: { UNH: 0.07, SMH: 0.07, GEV: 0.06, F: 0.05, BABA: -0.09 },
      picks: LIVE.picks!.filter((p) =>
        ["UNH", "SMH", "GEV", "F", "BABA"].includes(String(p.asset)),
      ),
      optimizerResult: { ...LIVE.optimizerResult, zeroed: [] },
    });
    expect(thin.agentHitTarget).toBe(false);
    expect(funnelHeadline(thin)).toBeNull();
  });

  it("stays silent when the sizer funded everything the agent chose", () => {
    const clean = buildBookFunnel({
      ...LIVE,
      heuristicWeights: Object.fromEntries(
        LIVE.picks!.map((p) => [String(p.asset), p.direction === "long" ? 0.05 : -0.05]),
      ),
      optimizerResult: { ...LIVE.optimizerResult, zeroed: [] },
    });
    expect(funnelHeadline(clean)).toBeNull();
  });
});

// The credit lens is not a smaller version of the multi-asset run -- it is
// narrowed by a DIFFERENT stage, and the first version of this panel said
// otherwise. On 2026-07-30 the credit screen removed 31 names at `lens = credit`
// and 0 at the context cap; the panel labelled the whole drop "context cap" and
// told a reader the model's context window discarded 31 credit candidates.
const CREDIT: FunnelInputs = {
  screeningFunnel: [
    { stage: "L1 ranked candidates", removed: 0, remaining: 42 },
    { stage: "conviction override (ADR-0046)", removed: 0, remaining: 42 },
    {
      stage: "lens = credit",
      removed: 31,
      remaining: 11,
      reason: "Asset outside the selected asset-class lens.",
    },
    { stage: "factor R^2 >= 0.10", removed: 0, remaining: 11 },
    { stage: "dedupe (asset, direction)", removed: 0, remaining: 11 },
    { stage: "editorial veto (ADR-0171)", removed: 0, remaining: 11 },
    { stage: "candidate pool (cap 30)", removed: 0, remaining: 11 },
  ],
  independentIdeas: {
    long: { count: 3, names: 11 },
    short: { count: 0, names: 0 },
  },
  heuristicWeights: { BIL: 0.2, EMB: 0.15, BKLN: 0.15 },
  picks: [
    { asset: "EMB", direction: "long" },
    { asset: "BIL", direction: "long" },
    { asset: "BKLN", direction: "long" },
  ],
  optimizerResult: {
    zeroed: [],
    binding_constraints: [
      "EMB at single-name cap",
      "BIL at single-name cap",
      "Credit at sector cap",
    ],
    realised_turnover: null,
    turnover_cap: null,
    forced_exit_turnover: null,
    feasible: true,
  },
};

describe("removingStages", () => {
  it("returns only the stages that removed something", () => {
    expect(removingStages(CREDIT.screeningFunnel)).toEqual([
      {
        stage: "lens = credit",
        removed: 31,
        reason: "Asset outside the selected asset-class lens.",
      },
    ]);
    expect(removingStages(LIVE.screeningFunnel).map((s) => s.stage)).toEqual([
      "candidate pool (cap 30)",
    ]);
  });
});

describe("buildBookFunnel — the credit lens narrows at a different step", () => {
  const f = buildBookFunnel(CREDIT);
  const firstEdge = f.edges.find((e) => e.to === "context");

  it("names the LENS as the remover, not the context cap", () => {
    // The regression. `context cap` here would be a false attribution of the
    // one filter that defines this book.
    expect(firstEdge?.label).toBe("lens = credit");
    expect(firstEdge?.removed).toBe(31);
    expect(firstEdge?.detail).toContain("outside the selected asset-class lens");
    expect(firstEdge?.detail).not.toContain("context window");
  });

  it("still names the context cap on the multi-asset run", () => {
    const m = buildBookFunnel(LIVE).edges.find((e) => e.to === "context");
    expect(m?.label).toBe("context cap");
    expect(m?.removed).toBe(12);
  });

  it("reports a genuinely empty short side as zero, not as absent", () => {
    // Zero shorts is a MEASUREMENT on this lens -- no short credit candidates
    // exist in the pool -- and is the single most important fact about the
    // credit book. It must not render as an em-dash "not carried".
    const by = Object.fromEntries(f.nodes.map((n) => [n.id, n]));
    expect(by.context).toMatchObject({ total: 11, long: 11, short: 0 });
    expect(by.ideas).toMatchObject({ total: 3, long: 3, short: 0 });
    expect(by.published).toMatchObject({ total: 3, long: 3, short: 0 });
  });

  it("says the sizer funded everything, and claims no turnover it does not have", () => {
    const sizer = f.edges.find((e) => e.to === "published");
    expect(sizer?.removed).toBeNull();
    expect(sizer?.notable).toBeFalsy();
    expect(sizer?.detail).toContain("funded every position");
    // No previous credit book exists, so realised_turnover is null. The edge
    // must not print "against a null cap" or invent a percentage.
    expect(sizer?.detail).not.toMatch(/null|NaN|undefined/);
  });

  it("does not claim the agent hit five-and-five on a three-name book", () => {
    expect(f.agentHitTarget).toBe(false);
    expect(funnelHeadline(f)).toBeNull();
  });
});

// The raw L1 pool is SHARED: `trade_candidates` has no lens column, so L1 ranks
// names before a lens is chosen and both books screen the same 42 rows. On
// 2026-07-30 that pool was 29 long / 13 short.
const RAW42 = [
  ...Array.from({ length: 29 }, (_, i) => ({ asset: `L${i}`, direction: "long" })),
  ...Array.from({ length: 13 }, (_, i) => ({ asset: `S${i}`, direction: "short" })),
];

describe("the first node's split, and what the lens does to it", () => {
  it("carries 29L/13S when the candidate rows match the funnel's own count", () => {
    const f = buildBookFunnel({ ...LIVE, candidates: RAW42 });
    const screen = f.nodes.find((n) => n.id === "screen");
    expect(screen).toMatchObject({ total: 42, long: 29, short: 13 });
    expect(screen?.source).toContain("trade_candidates.direction");
  });

  it("REFUSES the split when the candidate rows describe a different pool", () => {
    // trade_candidates is read on its own latest run_date and the book on its
    // own. A split from one vintage under a total from another is two books on
    // one line -- the failure this panel exists to stop, reproduced inside it.
    const f = buildBookFunnel({ ...LIVE, candidates: RAW42.slice(0, 20) });
    const screen = f.nodes.find((n) => n.id === "screen");
    expect(screen?.long).toBeNull();
    expect(screen?.short).toBeNull();
    expect(screen?.source).not.toContain("trade_candidates");
  });

  it("says a long/short book is not constructible when the lens empties a side", () => {
    // The credit argument, measured: 13 shorts in the shared pool, 0 survive.
    const f = buildBookFunnel({ ...CREDIT, candidates: RAW42 });
    const lensEdge = f.edges.find((e) => e.to === "context");
    expect(lensEdge?.detail).toContain("29 long and 13 short candidates");
    expect(lensEdge?.detail).toContain("11 long and 0 short survive");
    expect(lensEdge?.detail).toContain("not constructible");
  });

  it("does NOT say it when both sides survive", () => {
    // The multi-asset lens removes nothing, so the sentence would be noise --
    // and a line that appears every day cannot mean anything on the day it does.
    const f = buildBookFunnel({ ...LIVE, candidates: RAW42 });
    const edge = f.edges.find((e) => e.to === "context");
    expect(edge?.detail).not.toContain("not constructible");
    expect(edge?.detail).toContain("19 long and 11 short survive");
  });

  it("omits the split entirely when no candidate rows are supplied", () => {
    const screen = buildBookFunnel(LIVE).nodes.find((n) => n.id === "screen");
    expect(screen?.long).toBeNull();
    expect(screen?.total).toBe(42);
  });

  it("qualifies the first node as the SHARED pool, on every lens", () => {
    // /book?lens=credit opens on 42 candidates split 29L/13S, and neither
    // number describes the credit universe. Without this the reader has to
    // infer "shared" from the edge that follows -- ADR-0200's failure (another
    // book's pool shown unmarked) one panel over from where it was just fixed.
    for (const inputs of [LIVE, CREDIT]) {
      const screen = buildBookFunnel({ ...inputs, candidates: RAW42 }).nodes.find(
        (n) => n.id === "screen",
      );
      expect(screen?.note, "the shared pool is unqualified").toBeTruthy();
      expect(screen?.note).toContain("before any lens");
    }
  });

  it("qualifies no OTHER node - every one of those is this book's own", () => {
    const f = buildBookFunnel({ ...CREDIT, candidates: RAW42 });
    for (const n of f.nodes.filter((x) => x.id !== "screen")) {
      expect(n.note, `${n.id} should not need a qualifier`).toBeUndefined();
    }
  });
});

describe("splitPicks", () => {
  it("ignores rows with no asset rather than counting them", () => {
    const s = splitPicks([
      { asset: "A", direction: "long" },
      { asset: null, direction: "long" },
      { asset: "B", direction: "short" },
    ]);
    expect(s).toMatchObject({ long: 1, short: 1, total: 2 });
  });
});
