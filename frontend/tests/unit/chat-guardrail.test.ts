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
