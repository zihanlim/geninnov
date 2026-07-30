// frontend/tests/unit/risk-answer-cards.test.tsx
//
// The /risk answer row (ADR-0172).
//
// A card sits above the fold, so a wrong or misleading one does more damage than the
// same mistake in a panel three screens down. The failure modes pinned here, ordered
// by how badly each misleads:
//
//   1. a realised statistic reaches the row — Sharpe/Sortino/Calmar/drawdown/TE/IR
//      are computed on a costless series at n=6 where the sign flips net of costs;
//   2. the melt-up card silently reports the most POSITIVE scenario, hiding the
//      ADR-0074 case where a net-short book loses on the rally too;
//   3. an absence renders as a bare em-dash with no cause (design goal 2);
//   4. a figure duplicates one /book already publishes (AnswerRow's own rule, and
//      ADR-0084's split-by-section-never-by-copy).

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { riskAnswerCards } from "@/components/risk/RiskAnswerCards";
import AnswerRow from "@/components/AnswerRow";
import type { AnalyticsState, CorrelationPair } from "@/lib/risk/analytics";

const ok = <T,>(value: T): AnalyticsState<T> => ({
  status: "ok",
  value,
  runDate: "2026-07-29",
});

const scen = (name: string, label: string, r: number) => ({
  scenario_name: name,
  label,
  estimated_book_return: r,
  estimated_dollar_pnl: r * 1e8,
  severity: "high",
  contribution_breakdown: [],
});

const SCENARIOS = [
  scen("vix_spike", "VIX spike", -0.021),
  scen("melt_up", "Melt-up / Squeeze (SPX +10%)", 0.002),
];

const attrib = (over: Record<string, unknown> = {}) =>
  ({
    id: "1",
    asset: "VRT",
    themeId: null,
    direction: "long",
    signedWeight: 0.049,
    betaMkt: 2.08,
    betaContribution: 0.102,
    betaContributionShare: 0.21,
    grossShare: null,
    netShare: null,
    ...over,
  }) as never;

const base = {
  scenarioState: ok(SCENARIOS),
  correlationState: ok([{ asset_a: "GDX", asset_b: "GLD", corr: 0.82 }]) as AnalyticsState<
    CorrelationPair[]
  >,
  attribution: [attrib()],
  positionCount: 9,
  factorCoverage: 9,
  // A run that HAS shrinkage, so the base fixture matches current behaviour;
  // individual tests override this to exercise the pre-ADR-0173 (null) branch.
  covShrinkageIntensity: 0.25 as number | null,
};

const render = (over: Partial<typeof base> = {}) =>
  renderToStaticMarkup(<AnswerRow cards={riskAnswerCards({ ...base, ...over } as never)} />);

describe("the row's refusals", () => {
  it("puts no realised statistic on any card", () => {
    // The refusal list in components/AnswerRow.tsx. These are wrong here on BOTH
    // sample (6 sessions vs minimums of 30-252) and basis (costless series on a
    // 92.7%-turnover book, where CostDrag measured the sign flipping).
    const out = render().toLowerCase();
    for (const banned of [
      "sharpe",
      "sortino",
      "calmar",
      "max drawdown",
      "tracking error",
      "information ratio",
    ]) {
      expect(out, `"${banned}" must not appear on the answer row`).not.toContain(banned);
    }
  });

  it("does not repeat the single worst-case figure /book already publishes alone", () => {
    // /book's card is "WHAT KILLS YOU / -2.1%". This row may show the worst number
    // only as one half of a two-tailed figure — the pair is the new information.
    const out = render();
    expect(out).toContain("Both tails");
    expect(out).not.toContain("What kills you");
    // Both tails present, so the worst figure never stands alone.
    expect(out).toMatch(/-2\.1%\s*\/\s*\+0\.2%/);
  });

  it("names four cards and no more", () => {
    // A fifth pushes the evidence further down, which is the defect the row exists
    // to remove, reintroduced by its own growth.
    expect(riskAnswerCards(base as never)).toHaveLength(4);
  });
});

describe("both tails", () => {
  it("matches the melt-up by NAME, not by taking the most positive scenario", () => {
    // ADR-0074's case: a risk-on scenario that PRICES NEGATIVE is the finding worth
    // surfacing. Selecting "most positive" would hide it by construction.
    const out = render({
      scenarioState: ok([
        scen("vix_spike", "VIX spike", -0.021),
        scen("melt_up", "Melt-up / Squeeze", -0.004),
        scen("rates_selloff", "Rates selloff", -0.001),
      ]),
    });
    expect(out).toMatch(/-2\.1%\s*\/\s*-0\.4%/);
    expect(out).toContain("stressed on <strong>both</strong> tails");
    expect(out).toContain("the rally is not the safe side");
  });

  it("says so when no risk-on scenario ran at all", () => {
    const out = render({
      scenarioState: ok([scen("vix_spike", "VIX spike", -0.021)]),
    });
    expect(out).toContain("none is a risk-on case");
    expect(out).toContain("nothing here would show it");
  });
});

describe("absence states its cause (goal 2)", () => {
  it("names the column when a null column is the reason", () => {
    const out = render({
      scenarioState: { status: "null_column", runDate: "2026-07-29" },
    });
    expect(out).toContain("scenario_results is null for this run");
    expect(out).toContain("not the same as no risk");
  });

  it("distinguishes a rejected read from an absent value", () => {
    const out = render({
      correlationState: {
        status: "query_error",
        failure: { table: "research_recommendations", columns: "x", message: "boom" },
      } as never,
    });
    expect(out).toContain("was rejected, so this is unknown rather than absent");
  });

  it("does not read an empty correlation set as independence", () => {
    const out = render({ correlationState: { status: "empty", runDate: "2026-07-29" } });
    expect(out).toContain("not a promise");
    expect(out).toContain("independence");
  });

  it("explains a missing beta attribution rather than showing zero", () => {
    const out = render({ attribution: [] });
    expect(out).toContain("Absent, not zero");
    expect(out).toContain("factor_exposures");
  });
});

describe("what this cannot see", () => {
  it("always discloses that the sizing covariance is the reporting covariance", () => {
    // The bias this card exists for: minimising w'Sigma w under a noisy sample
    // estimate selects the directions where Sigma understates covariance, so the
    // reported vol is a lower bound regardless of which branch below fires.
    const out = render();
    expect(out).toContain("The same estimate sized the book");
    expect(out).toContain("lower bound");
  });

  it("says a pre-ADR-0173 run was genuinely unshrunk, not merely unrecorded", () => {
    // covShrinkageIntensity undefined/null means the run predates the shrinkage,
    // and the card must not claim a mitigation that did not exist for it.
    const out = render({ covShrinkageIntensity: null });
    expect(out).toContain("predates the covariance shrinkage");
    expect(out).not.toContain("narrowed but not removed");
  });

  it("quotes the actual shrinkage intensity when the run applied one", () => {
    // ADR-0173: shrunk toward constant correlation, not to zero bias — the copy
    // must say "narrowed", never "removed" or "unbiased".
    const out = render({ covShrinkageIntensity: 0.25 });
    expect(out).toContain("Σ is shrunk 25%");
    expect(out).toContain("narrowed but not removed");
    expect(out).not.toContain("predates the covariance shrinkage");
  });

  it("counts the positions the factor model cannot reach", () => {
    const out = render({ positionCount: 9, factorCoverage: 7 });
    expect(out).toContain("7/9 modelled");
    expect(out).toContain("2 positions have no factor regression");
  });
});

describe("every card is sourced and drillable (goal 1)", () => {
  it("names a table.column and links into this page", () => {
    for (const c of riskAnswerCards(base as never)) {
      expect(c.source, `${c.label} has no source`).toMatch(/[a-z_]+\.[a-z_]+|×/);
      // Anchors, not routes: the evidence for a Risk card is on the Risk page.
      expect(c.href, `${c.label} must link within the page`).toMatch(/^#/);
    }
  });

  it("links only to sections /risk actually renders", () => {
    const owned = new Set(["stress", "attribution", "concentration", "exposure"]);
    for (const c of riskAnswerCards(base as never)) {
      expect(owned.has(c.href.slice(1)), `${c.href} is not a /risk section`).toBe(true);
    }
  });
});
