// The /ask tool layer against fixed rows.
//
// Two properties are being pinned, and the second matters more than the first:
//
//  1. Every figure a tool emits carries the table.column it came from. A fact
//     with an empty or invented source would render on the page as provenance,
//     which is worse than no provenance at all.
//  2. A missing table produces a STATED ABSENCE, never an empty answer and never
//     a zero. Goal 2 exists because "no data" and "zero" are different claims,
//     and an agent is the easiest place in the product to conflate them — the
//     model will happily narrate a gap it was not told about.
//
// The DbReader seam is what makes this cheap: no Supabase, no network, no keys.

import { describe, expect, it } from "vitest";
import { runTool, TOOLS } from "@/lib/chat/tools";
import type { DbReader } from "@/lib/chat/types";

const BOOK_ROW = {
  run_date: "2026-07-25",
  lens: "credit",
  picks: [
    {
      asset: "UNH",
      direction: "long",
      theme_name: "Healthcare policy",
      thesis: "Legislative overhang has cleared.",
      counter_thesis: "A reversal would re-open the discount.",
      weight: 0.088,
      signed_weight: 0.088,
      notional: 8_800_000,
      hype_score: 62.4,
    },
    { asset: "TLT", direction: "short", weight: 0.06, signed_weight: -0.06, notional: -6_000_000 },
  ],
  book_metrics: { gross_exposure: 1.48, net_exposure: 0.028, long_weight: 0.754, short_weight: 0.726, factor_tilts: { MKT: -0.12 } },
  cap_utilisation: { single_name: [{ key: "UNH", weight: 0.088, cap: 0.2, utilisation: 0.44, breached: false }] },
  scenario_results: [
    { scenario_name: "vix_spike", label: "VIX spike", estimated_book_return: -0.032, estimated_dollar_pnl: -3_200_000, severity: "high", contribution_breakdown: [] },
  ],
  screening_funnel: [{ stage: "universe", label: "Universe", count: 120 }],
};

/** A DbReader over a fixed map of tables. Absent key = table unreadable. */
const db = (tables: Record<string, Record<string, unknown>[]>, error?: string): DbReader => ({
  async select(table) {
    if (error) return { rows: [], error };
    return { rows: tables[table] ?? [], error: null };
  },
});

const ctx = (tables: Record<string, Record<string, unknown>[]>, error?: string) => ({
  db: db(tables, error),
});

describe("every tool", () => {
  it("declares a description and a name the planner can use", () => {
    for (const t of TOOLS) {
      expect(t.name).toMatch(/^[a-z_]+$/);
      expect(t.description.length).toBeGreaterThan(40);
    }
  });

  it("sources every fact it emits", async () => {
    // Run them all against a full fixture and assert the invariant globally,
    // rather than trusting each tool's own test to remember.
    const tables = {
      research_recommendations: [BOOK_ROW],
      portfolio_positions: [{ asset: "UNH", edge_score: 0.41, conviction: 12.2, vol: 0.19, trend_signal: 0.3, regime_bias: 0.1, carry_signal: null, value_signal: null, sentiment_signal: 0.2 }],
      regime_classifications: [{ run_date: "2026-07-25", cycle: "late", sentiment: "risk-on", vix_level: 14.2, hy_oas: 3.11 }],
      portfolio_risk: [{ total_capital: 100_000_000, var_95: 2_400_000, sharpe: 1.9 }],
      themes: [{ id: "t1", name: "Healthcare policy", tier: "anchor", source: "practitioner", hype_score: 62.4, volume_score: 55 }],
      macro_indicators: [{ series_id: "DGS2", series_name: "2Y Treasury", value: 4.35, unit: "%", fetch_date: "2026-07-25" }],
      pipeline_runs: [{ run_date: "2026-07-25", stage: "L0", status: "success", finished_at: null, duration_s: 3 }],
      trade_candidates: [{ asset: "NVDA", direction: "long", edge_score: 0.22, run_date: "2026-07-25" }],
    };
    for (const t of TOOLS) {
      const out = await runTool(t.name, { asset: "UNH" }, ctx(tables));
      for (const fact of out.facts) {
        expect(fact.source, `${t.name}.${fact.key}`).toBeTruthy();
        expect(fact.label, `${t.name}.${fact.key}`).toBeTruthy();
      }
    }
  });
});

describe("book_summary", () => {
  it("emits weights as fractions with their column", async () => {
    const out = await runTool("book_summary", {}, ctx({ research_recommendations: [BOOK_ROW] }));
    const w = out.facts.find((f) => f.key === "position.UNH.weight");
    expect(w?.value).toBe(0.088);
    expect(w?.unit).toBe("pct");
    expect(w?.source).toBe("research_recommendations.picks[].weight");
  });

  it("states the absence when no book has been published", async () => {
    const out = await runTool("book_summary", {}, ctx({ research_recommendations: [] }));
    expect(out.facts).toHaveLength(0);
    expect(out.absence).toMatch(/has no rows/);
  });

  it("distinguishes an unreadable table from an empty one", async () => {
    const out = await runTool("book_summary", {}, ctx({}, "JWT expired"));
    expect(out.absence).toMatch(/could not be read/);
    expect(out.absence).toMatch(/JWT expired/);
  });
});

describe("position_detail", () => {
  it("returns the sizing derivation, not just the weight", async () => {
    const out = await runTool(
      "position_detail",
      { asset: "UNH" },
      ctx({
        research_recommendations: [BOOK_ROW],
        portfolio_positions: [{ asset: "UNH", edge_score: 0.41, conviction: 12.2, vol: 0.19, trend_signal: 0.3, regime_bias: 0.1, carry_signal: null, value_signal: null, sentiment_signal: 0.2 }],
      }),
    );
    expect(out.notes?.sizing_headline).toBeTruthy();
    expect(out.facts.find((f) => f.key === "position.UNH.conviction")?.value).toBe(12.2);
    expect(out.facts.find((f) => f.key === "position.UNH.cap")?.value).toBe(0.2);
    expect(out.notes?.counter_thesis).toBe("A reversal would re-open the discount.");
  });

  it("names what IS in the book when asked about a name that is not", async () => {
    const out = await runTool("position_detail", { asset: "NVDA" }, ctx({ research_recommendations: [BOOK_ROW], portfolio_positions: [] }));
    expect(out.absence).toMatch(/not in the/);
    // The list matters: a bare "not found" invites the model to speculate about
    // why, while the roster lets it answer the question that was really asked.
    expect(out.absence).toMatch(/UNH, TLT/);
  });

  it("resolves a selector, because a planner cannot know a ticker it has not fetched", async () => {
    // Found on the first live run: asked about "the largest position", the model
    // planned position_detail(asset: "<largest position ticker>") — the answer
    // to "which is largest" lived in a different tool's result it had not seen.
    const tables = { research_recommendations: [BOOK_ROW], portfolio_positions: [] };
    expect((await runTool("position_detail", { asset: "largest" }, ctx(tables))).args).toEqual({ asset: "UNH" });
    expect((await runTool("position_detail", { asset: "largest_short" }, ctx(tables))).args).toEqual({ asset: "TLT" });
    expect((await runTool("position_detail", { asset: "smallest" }, ctx(tables))).args).toEqual({ asset: "TLT" });
  });

  it("names a placeholder as a placeholder rather than as a missing ticker", async () => {
    const out = await runTool(
      "position_detail",
      { asset: "<largest position ticker>" },
      ctx({ research_recommendations: [BOOK_ROW], portfolio_positions: [] }),
    );
    expect(out.absence).toMatch(/is a placeholder/);
    expect(out.absence).toMatch(/largest_short/);
  });

  it("says so when the edge components were never persisted", async () => {
    const out = await runTool("position_detail", { asset: "UNH" }, ctx({ research_recommendations: [BOOK_ROW], portfolio_positions: [] }));
    expect(out.absence).toMatch(/EdgeScore components were not persisted/);
  });
});

describe("risk_metrics", () => {
  it("separates 'L4 did not run' from 'the book was not stressed'", async () => {
    const noRisk = await runTool("risk_metrics", {}, ctx({ research_recommendations: [BOOK_ROW], portfolio_risk: [] }));
    expect(noRisk.absence).toMatch(/portfolio_risk has no rows/);

    const noScenarios = await runTool(
      "risk_metrics",
      {},
      ctx({ research_recommendations: [{ ...BOOK_ROW, scenario_results: [] }], portfolio_risk: [{ var_95: 2_400_000 }] }),
    );
    expect(noScenarios.absence).toMatch(/scenario_results is empty/);
  });

  // The defect this guards (ADR-0100): /ask and the MCP server read portfolio_risk straight
  // through, so on the 2026-07-25 book — THREE return observations — they would quote a
  // Sharpe of 6.32 against a declared minimum of 60, while the /risk tile suppressed the
  // identical number. The guard lived in a React component, so every non-React consumer
  // ignored it.
  const RISK_ROW = {
    var_95: 1_485_840, cvar_95: 1_864_070, sharpe: 6.32251, beta: -1.29775,
    concentration_hhi: 1200, total_capital: 100_000_000,
  };
  const sessions = (n: number) => Array.from({ length: n }, (_, i) => ({ run_date: `d${i}` }));
  const keys = (out: { facts: { key: string }[] }) => out.facts.map((x) => x.key);

  it("withholds under-sampled statistics from the model", async () => {
    const out = await runTool("risk_metrics", {}, ctx({
      research_recommendations: [BOOK_ROW],
      portfolio_risk: [RISK_ROW],
      portfolio_returns: sessions(3),
    }));

    for (const k of ["risk.sharpe", "risk.beta", "risk.var_95", "risk.cvar_95"]) {
      expect(keys(out), `${k} must not be quotable from 3 sessions`).not.toContain(k);
    }
    // ...while the statistics that need no history are untouched.
    expect(keys(out)).toContain("risk.concentration_hhi");
    expect(keys(out)).toContain("risk.total_capital");
  });

  it("tells the model the figures exist rather than letting it report none", async () => {
    const out = await runTool("risk_metrics", {}, ctx({
      research_recommendations: [BOOK_ROW],
      portfolio_risk: [RISK_ROW],
      portfolio_returns: sessions(3),
    }));
    expect(out.absence).toMatch(/EXIST in portfolio_risk/);
    expect(out.absence).toMatch(/Sharpe \(3 sessions of return history, needs 60/);
    expect(out.absence).toMatch(/do NOT say they are unavailable/);
  });

  it("quotes them once the sample supports them", async () => {
    const out = await runTool("risk_metrics", {}, ctx({
      research_recommendations: [BOOK_ROW],
      portfolio_risk: [RISK_ROW],
      portfolio_returns: sessions(60),
    }));
    for (const k of ["risk.sharpe", "risk.beta", "risk.var_95", "risk.cvar_95"]) {
      expect(keys(out)).toContain(k);
    }
    expect(out.absence).toBeUndefined();
  });

  it("quotes VaR but not Sharpe at 30 sessions — the thresholds differ", async () => {
    const out = await runTool("risk_metrics", {}, ctx({
      research_recommendations: [BOOK_ROW],
      portfolio_risk: [RISK_ROW],
      portfolio_returns: sessions(30),
    }));
    expect(keys(out)).toContain("risk.var_95");
    expect(keys(out)).toContain("risk.cvar_95");
    expect(keys(out)).not.toContain("risk.sharpe");
    expect(keys(out)).not.toContain("risk.beta");
  });

  it("does not withhold when the sample cannot be read", async () => {
    // An unreadable count must degrade to prior behaviour, not black out every figure —
    // a read error is not evidence of a small sample.
    //
    // Needs a fake that fails ONE table: the shared `db` helper errors every select, which
    // would empty portfolio_risk too and short-circuit to "has no rows", passing this test
    // without ever reaching the branch it is about.
    const onlyReturnsFail: DbReader = {
      async select(table) {
        if (table === "portfolio_returns") return { rows: [], error: "connection reset" };
        const rows = { research_recommendations: [BOOK_ROW], portfolio_risk: [RISK_ROW] }[
          table as "research_recommendations" | "portfolio_risk"
        ];
        return { rows: rows ?? [], error: null };
      },
    };
    const out = await runTool("risk_metrics", {}, { db: onlyReturnsFail });

    // The branch is genuinely reached: risk was read, so this is not the "no rows" path.
    expect(out.absence ?? "").not.toMatch(/portfolio_risk has no rows/);
    expect(out.absence ?? "").not.toMatch(/EXIST in portfolio_risk/);
    expect(keys(out)).toContain("risk.sharpe");   // quoted, because the sample is unjudged
  });
});

describe("screening_funnel", () => {
  it("explains a candidate that cleared the screen but was not taken", async () => {
    const out = await runTool(
      "screening_funnel",
      { asset: "NVDA" },
      ctx({ research_recommendations: [BOOK_ROW], trade_candidates: [{ asset: "NVDA", direction: "long", edge_score: 0.22, run_date: "2026-07-25" }] }),
    );
    expect(String(out.notes?.NVDA)).toMatch(/NOT taken/);
    expect(out.facts.find((f) => f.key === "candidate.NVDA.edge_score")?.value).toBe(0.22);
  });

  it("distinguishes a name that never reached the ranking at all", async () => {
    const out = await runTool("screening_funnel", { asset: "GME" }, ctx({ research_recommendations: [BOOK_ROW], trade_candidates: [] }));
    expect(String(out.notes?.GME)).toMatch(/not in the candidate pool/);
  });
});

describe("book_turnover", () => {
  it("refuses to invent a comparison when only one run exists", async () => {
    const out = await runTool("book_turnover", {}, ctx({ research_recommendations: [BOOK_ROW] }));
    expect(out.absence).toMatch(/no previous book/);
    expect(out.facts.some((f) => f.key === "turnover.pct")).toBe(false);
  });

  it("measures turnover against the previous run", async () => {
    const previous = { ...BOOK_ROW, run_date: "2026-07-24", picks: [{ asset: "UNH", direction: "long" }, { asset: "GLD", direction: "short" }] };
    const out = await runTool("book_turnover", {}, ctx({ research_recommendations: [BOOK_ROW, previous] }));
    expect(out.notes?.kept).toEqual(["UNH"]);
    expect(out.notes?.opened).toEqual(["TLT"]);
    expect(out.notes?.closed).toEqual(["GLD"]);
  });
});

describe("runTool", () => {
  it("degrades a thrown tool into a stated absence rather than a crash", async () => {
    const exploding: DbReader = {
      async select() {
        throw new Error("socket hang up");
      },
    };
    const out = await runTool("book_summary", {}, { db: exploding });
    expect(out.absence).toMatch(/socket hang up/);
    expect(out.facts).toHaveLength(0);
  });

  it("reports an unknown tool without pretending it read anything", async () => {
    const out = await runTool("get_prices", {}, ctx({}));
    expect(out.absence).toMatch(/No tool named/);
  });
});
