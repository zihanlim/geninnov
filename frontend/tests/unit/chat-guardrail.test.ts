// The /ask citation guardrail, pinned.
//
// This is the test that decides whether the chat is publishable. Everything else
// in the feature — tools, planner, UI — is machinery for producing an answer;
// this is the only thing standing between a fluent language model and a
// fabricated basis-point figure in a sentence a reader will believe.
//
// The cases that matter most are the ones where a NAIVE guardrail passes:
//
//  * unit confusion — a Sharpe of 1.9 must not ground "1.9%" of anything
//  * prose laundering — a number that appears in a thesis may be QUOTED but must
//    never be promoted to a cited figure
//  * arithmetic — a sum the model computed from two real facts is not itself a
//    fact, and is exactly what the model was told not to do

import { describe, expect, it } from "vitest";
import { verifyAnswer } from "@/lib/chat/guardrail";
import type { Fact, ToolResult } from "@/lib/chat/types";

const fact = (over: Partial<Fact>): Fact => ({
  key: "k",
  label: "Label",
  value: 0,
  source: "table.column",
  ...over,
});

const result = (over: Partial<ToolResult>): ToolResult => ({
  tool: "book_summary",
  args: {},
  facts: [],
  ...over,
});

describe("verifyAnswer — grounding a figure", () => {
  it("cites a percent written from a fraction", () => {
    const results = [
      result({ facts: [fact({ key: "position.UNH.weight", value: 0.08812, unit: "pct" })] }),
    ];
    const v = verifyAnswer("UNH is 8.8% of the book.", results);
    expect(v.verified).toBe(true);
    expect(v.citations).toHaveLength(1);
    expect(v.verdicts.find((x) => x.token === "8.8%")?.grounding).toBe("cited");
  });

  it("cites the same fraction at a different precision", () => {
    const results = [result({ facts: [fact({ value: 0.08812, unit: "pct" })] })];
    expect(verifyAnswer("8.81% of gross.", results).verified).toBe(true);
    expect(verifyAnswer("9% of gross.", results).verified).toBe(true);
  });

  it("rejects a percent that is merely close", () => {
    const results = [result({ facts: [fact({ value: 0.08812, unit: "pct" })] })];
    // 8.9% is not a rounding of 8.812% at any precision the answer stated.
    expect(verifyAnswer("UNH is 8.9% of the book.", results).unverified).toContain("8.9%");
  });

  it("cites a dollar notional written in millions", () => {
    const results = [result({ facts: [fact({ value: -6_000_000, unit: "usd" })] })];
    const v = verifyAnswer("A short of $6.0M.", results);
    expect(v.verified).toBe(true);
  });

  it("does not let a unitless fact ground a percent", () => {
    // The failure this prevents: Sharpe 1.9 blessing "1.9%" of book return.
    const results = [result({ facts: [fact({ key: "risk.sharpe", value: 1.9, unit: "x" })] })];
    const v = verifyAnswer("The book returns 1.9% in that scenario.", results);
    expect(v.unverified).toContain("1.9%");
    expect(verifyAnswer("Sharpe is 1.9.", results).verified).toBe(true);
  });

  it("ignores the sign, which words carry", () => {
    const results = [result({ facts: [fact({ value: -0.032, unit: "pct" })] })];
    expect(verifyAnswer("It loses 3.2% in that scenario.", results).verified).toBe(true);
  });
});

describe("verifyAnswer — what it refuses", () => {
  it("flags a figure that appears nowhere", () => {
    const results = [result({ facts: [fact({ value: 0.088, unit: "pct" })] })];
    const v = verifyAnswer("Gross exposure is 143.0%.", results);
    expect(v.verified).toBe(false);
    expect(v.unverified).toContain("143.0%");
  });

  it("flags arithmetic the model performed on two real facts", () => {
    // Both inputs are grounded; their sum is not, and summing is precisely what
    // the prompt forbids. A guardrail that accepted this would accept any
    // derived figure, which is most of the ways a book gets misdescribed.
    const results = [
      result({
        facts: [
          fact({ key: "a", value: 0.06, unit: "pct" }),
          fact({ key: "b", value: 0.04, unit: "pct" }),
        ],
      }),
    ];
    const v = verifyAnswer("Together they are 10.0% of the book.", results);
    expect(v.unverified).toContain("10.0%");
  });

  it("returns the offending tokens so the retry can name them", () => {
    const results = [result({ facts: [fact({ value: 0.088, unit: "pct" })] })];
    const v = verifyAnswer("It is 8.8% now, was 7.1% before, and 5.0% last month.", results);
    expect(v.unverified).toEqual(["7.1%", "5.0%"]);
  });
});

describe("verifyAnswer — the quoted tier", () => {
  it("accepts a number quoted from a thesis without calling it cited", () => {
    const results = [
      result({
        facts: [fact({ value: 0.088, unit: "pct" })],
        notes: { thesis: "Refinancing 4.5% of the index in Q1." },
      }),
    ];
    const v = verifyAnswer("The thesis notes 4.5% of the index refinances.", results);
    expect(v.verified).toBe(true);
    expect(v.verdicts.find((x) => x.token === "4.5%")?.grounding).toBe("quoted");
    // The crucial half: a quotation is NOT a citation, so it never appears in
    // the sourced-figure count.
    expect(v.citations.map((c) => c.value)).not.toContain(4.5);
  });

  it("does not let prose launder an unrelated figure", () => {
    // The thesis says 4.5%; the answer claims 4.6%. Prose grounding is exact.
    const results = [
      result({ facts: [], notes: { thesis: "Refinancing 4.5% of the index." } }),
    ];
    expect(verifyAnswer("About 4.6% refinances.", results).unverified).toContain("4.6%");
  });

  it("accepts a number the reader themselves supplied", () => {
    const v = verifyAnswer("You asked about the top 5 names.", [result({})], "what are the top 5 names?");
    expect(v.verified).toBe(true);
  });
});

describe("verifyAnswer — dates and years", () => {
  it("cites a run date and does not decompose it", () => {
    const results = [
      result({ facts: [fact({ key: "book.run_date", value: "2026-07-25", unit: "date" })] }),
    ];
    const v = verifyAnswer("The book was published 2026-07-25.", results);
    expect(v.verified).toBe(true);
    // 2026, 07 and 25 must not appear as three separate untraceable integers.
    expect(v.verdicts).toHaveLength(1);
  });

  it("flags a run date that was not the one fetched", () => {
    const results = [
      result({ facts: [fact({ key: "book.run_date", value: "2026-07-25", unit: "date" })] }),
    ];
    expect(verifyAnswer("Published 2026-07-24.", results).unverified).toContain("2026-07-24");
  });

  it("lets a bare calendar year through as a quotation", () => {
    const v = verifyAnswer("The 2027 maturity wall is the risk.", [result({})]);
    expect(v.verified).toBe(true);
    expect(v.verdicts[0].grounding).toBe("quoted");
  });

  it("still checks a year-shaped quantity that carries a unit", () => {
    expect(verifyAnswer("Gross is 2027%.", [result({})]).unverified).toContain("2027%");
  });
});

describe("verifyAnswer — month names", () => {
  // The regression this pins shipped to production and passed with
  // `verified: true`: the first live answer opened "The May 2026 run classified
  // the macro regime…" about a run dated 2026-07-25. The numeric scan was blind
  // to it because "May" is a word — and a fabricated vintage misdates every
  // number in the same answer.
  const withRunDate = [
    result({ facts: [fact({ key: "regime.run_date", value: "2026-07-25", unit: "date" })] }),
  ];

  it("flags a month that is not the run's month", () => {
    const v = verifyAnswer("The May 2026 run classified the regime as late.", withRunDate);
    expect(v.verified).toBe(false);
    expect(v.unverified).toContain("May");
    expect(v.verdicts.find((x) => x.token === "May")?.kind).toBe("month");
  });

  it("accepts the month the run actually falls in, long or short", () => {
    expect(verifyAnswer("The July run.", withRunDate).verified).toBe(true);
    expect(verifyAnswer("The Jul run.", withRunDate).verified).toBe(true);
  });

  it("accepts a month quoted from the run's own prose", () => {
    const results = [
      result({
        facts: [fact({ key: "book.run_date", value: "2026-07-25", unit: "date" })],
        notes: { catalysts: ["PDD earnings (Aug-Sep)"] },
      }),
    ];
    const v = verifyAnswer("The catalyst is PDD earnings in Aug.", results);
    expect(v.verified).toBe(true);
    expect(v.verdicts.find((x) => x.token === "Aug")?.grounding).toBe("quoted");
  });

  it("ignores the ordinary English words, which is why the match is case-sensitive", () => {
    // "the book may re-rate" and "margins march higher" are prose, not dates.
    const v = verifyAnswer("The book may re-rate as margins march higher.", withRunDate);
    expect(v.verified).toBe(true);
    expect(v.verdicts.filter((x) => x.kind === "month")).toHaveLength(0);
  });
});

describe("verifyAnswer — whole-percent facts", () => {
  // The same production answer rendered S&P breadth as "6500.00%" because the
  // tool tagged a column storing 65 (meaning 65%) as a fraction.
  const breadth = [
    result({
      facts: [fact({ key: "regime.spx_breadth", label: "S&P breadth (% of SPX above 200d MA)", value: 65, unit: "pct_whole" })],
    }),
  ];

  it("grounds the percent as written", () => {
    expect(verifyAnswer("Breadth was 65%.", breadth).verified).toBe(true);
  });

  it("still grounds the fraction form", () => {
    expect(verifyAnswer("0.65 of constituents cleared it.", breadth).verified).toBe(true);
  });

  it("does not flag a number the tool put in its own label", () => {
    // The label is "S&P breadth (% of SPX above 200d MA)". An answer repeating
    // "200d MA" is copying what it was shown, and marking that as unsourced
    // teaches a reader to ignore the marks that matter.
    const v = verifyAnswer("Breadth counts constituents above their 200d MA.", breadth);
    expect(v.verified).toBe(true);
    expect(v.verdicts.find((x) => x.token === "200")?.grounding).toBe("quoted");
  });

  it("does not ground the fraction-scaled figure the old tag produced", () => {
    expect(verifyAnswer("Breadth was 6500%.", breadth).unverified).toContain("6500%");
  });
});

describe("verifyAnswer — numerals that are names, not measurements", () => {
  // Found in production after the month fix: an answer reading "65.00% of the
  // S&P 500 above its 200-day moving average" came back unverified on "500".
  // Marking an index name as unsourced teaches a reader the marks are noise,
  // which costs more than the one bad figure it might someday catch.
  const breadth = [
    result({
      facts: [fact({ key: "regime.spx_breadth", label: "S&P breadth (% of SPX above 200d MA)", value: 65, unit: "pct_whole" })],
    }),
  ];

  it("does not flag the number in an index name", () => {
    const v = verifyAnswer("65% of the S&P 500 sits above its 200d MA.", breadth);
    expect(v.verified).toBe(true);
    expect(v.verdicts.find((x) => x.token === "500")?.grounding).toBe("quoted");
  });

  it("covers the other indices by name", () => {
    expect(verifyAnswer("The Russell 2000 lagged.", breadth).verified).toBe(true);
    expect(verifyAnswer("The Nasdaq 100 led.", breadth).verified).toBe(true);
  });

  it("still adjudicates a measurement that follows a capitalised name", () => {
    // The reason this is an explicit list and not "a capitalised word before a
    // number": VIX 18.58 is a measurement wearing a name.
    expect(verifyAnswer("VIX 18.58 is moderate.", breadth).unverified).toContain("18.58");
  });

  it("still adjudicates a quantity even inside an index name, when it carries a unit", () => {
    expect(verifyAnswer("The S&P 500% move.", breadth).unverified).toContain("500%");
  });
});

describe("verifyAnswer — an answer with no figures", () => {
  it("passes prose that states an absence", () => {
    const results = [
      result({ facts: [], absence: "portfolio_risk has no rows — L4 did not run." }),
    ];
    const v = verifyAnswer("Risk was not computed for this run, so VaR cannot be quoted.", results);
    expect(v.verified).toBe(true);
    expect(v.citations).toHaveLength(0);
  });
});
