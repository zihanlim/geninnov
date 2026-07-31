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
