// frontend/tests/unit/attribution-answer-cards.test.tsx
//
// The /attribution answer row (phase 6 — "what did the book actually do?").
//
// A card sits above the fold, so a wrong or misleading one does more damage than the
// same mistake in a panel three screens down. The failure modes pinned here, ordered
// by how badly each misleads:
//
//   1. a realised statistic reaches the row — Sharpe/Sortino/Calmar/drawdown/TE/IR
//      are computed on a costless series at n=6 where the sign flips net of costs,
//      and `sampleAdequacy` suppresses them on the panels below (see AnswerRow.tsx);
//   2. the row carries TWO cards saying the same thing — the cost card used to be a
//      restatement of "Gross against net" (one is the other in percentage form), so
//      "What running it costs" must not reappear;
//   3. an absence renders as a bare em-dash with no cause (design goal 2) — in
//      particular a missing HHI must read "unmeasured", never "0" or "low";
//   4. a figure duplicates one the grid below already publishes, or a card is not
//      sourced / drillable (AnswerRow's own rules).
//
// The four-card shape is load-bearing: four is one screen-width of cards, and a fifth
// pushes the evidence below it down (see AnswerRow.tsx). So the row must STAY four
// even as cards are swapped in and out.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { attributionAnswerCards } from "@/components/risk/AttributionAnswerCards";
import AnswerRow from "@/components/AnswerRow";
import type { TrackRecord } from "@/lib/method/trackRecord";
import type { HoldingsPerformanceRow } from "@/components/risk/CostDrag";
import { MONITORED } from "@/lib/mandate";

const HHI_LIMIT = MONITORED.hhi.value; // 2 000 — five equal-weight names (DOJ scale)

const track: TrackRecord = {
  horizonDays: 21,
  total: 3,
  resolved: 0,
  pending: 3,
  void: 0,
  hits: 0,
  misses: 0,
  flats: 0,
  hitRate: null,
  meanSignedReturn: null,
  voidRate: null,
  firstExpectedMaturity: "2026-08-20",
  byDirection: {},
  books: 1,
  superseded: 0,
};

const holding = (over: Partial<HoldingsPerformanceRow> = {}): HoldingsPerformanceRow => ({
  run_date: "2026-08-01",
  turnover: 0.79,
  cost_pct: -0.00119,
  cost_usd: 119_000,
  gross_return: -0.0202,
  net_return: -0.0293,
  nav: 97_100_000,
  tracking_error: null,
  ...over,
});

type Base = Parameters<typeof attributionAnswerCards>[0];

const base: Base = {
  track,
  hhi: 1164, // the live 2026-08-01 value — under the 2 000 monitored ceiling
  holdings: [holding()],
  sessions: 9,
};

const cards = (over: Partial<Base> = {}) =>
  attributionAnswerCards({ ...base, ...over });

describe("the row's shape", () => {
  it("names four cards and no more", () => {
    // A fifth pushes the evidence further down, which is the defect the row exists
    // to remove, reintroduced by its own growth.
    expect(cards()).toHaveLength(4);
    expect(cards().map((c) => c.label)).toEqual([
      "Published picks resolved",
      "Concentration",
      "Gross against net",
      "Can this be judged yet?",
    ]);
  });

  it("does not carry a standalone cost card", () => {
    // "What running it costs" and "Gross against net" were the same finding twice —
    // the cost percentage is one half of the gross/net pair, restated. One card.
    const out = renderToStaticMarkup(<AnswerRow cards={cards()} />).toLowerCase();
    expect(out).not.toContain("what running it costs");
    expect(out).toContain("gross against net");
  });

  it("puts no realised statistic on any card", () => {
    // The refusal list in components/AnswerRow.tsx. These are wrong here on BOTH
    // sample (9 sessions vs minimums of 30-252) and basis (costless series on a
    // ~79% turnover book, where CostDrag measured the sign flipping).
    //
    // Scoped to the FIGURE (the link text), not the whole card: the judgeable card
    // legitimately NAMES a withheld statistic in its consequence ("the persisted
    // Sharpe reads 5.14 and is not published") to explain the refusal — that is an
    // explanation, not a published figure, and must not fail the ban.
    for (const c of cards()) {
      const fig = c.figure === null ? "" : String(renderToStaticMarkup(<>{c.figure}</>)).toLowerCase();
      for (const banned of [
        "sharpe",
        "sortino",
        "calmar",
        "max drawdown",
        "tracking error",
        "information ratio",
      ]) {
        expect(fig, `"${banned}" must not be a figure on ${c.label}`).not.toContain(banned);
      }
    }
  });
});

describe("the concentration card", () => {
  it("publishes the live HHI against the monitored ceiling", () => {
    const c = cards().find((x) => x.label === "Concentration")!;
    expect(c.source).toBe("portfolio_risk.concentration_hhi");
    expect(c.href).toBe("#realised");
    const out = renderToStaticMarkup(
      <AnswerRow cards={[c]} />,
    );
    expect(out).toContain("1164");
    expect(out).toContain(`/ ${HHI_LIMIT.toLocaleString()}`);
  });

  it("reads a breach as a warning and a near-breach as fine", () => {
    // At/above 2 000 the book is more concentrated than the mandate watches for.
    expect(cards({ hhi: HHI_LIMIT - 1 }).find((x) => x.label === "Concentration")!.tone)
      .toBe("default");
    expect(cards({ hhi: HHI_LIMIT }).find((x) => x.label === "Concentration")!.tone)
      .toBe("warning");
    expect(cards({ hhi: 3600 }).find((x) => x.label === "Concentration")!.tone)
      .toBe("warning");
  });

  it("states that an absent HHI is unmeasured, never low (goal 2)", () => {
    const out = renderToStaticMarkup(
      <AnswerRow cards={cards({ hhi: null })} />,
    );
    expect(out).toContain("is not recorded for this run");
    expect(out).toContain("unmeasured rather than low");
    expect(out).not.toContain("0 /");
    expect(out).not.toContain(">0");
  });
});

describe("every card is sourced and drillable (goal 1)", () => {
  it("names a table.column and links into this page", () => {
    for (const c of cards()) {
      // The same loose pattern risk-answer-cards.test.tsx uses: a table.column
      // (e.g. portfolio_risk.concentration_hhi), a bare table (portfolio_returns),
      // or a derivation path (lib/risk/sampleAdequacy). Each names where the
      // figure is read from.
      expect(c.source, `${c.label} has no source`).toMatch(/[a-z_]+(\.[a-z_]+)?/);
      // Anchors, not routes: the evidence for an attribution card is on this page.
      expect(c.href, `${c.label} must link within the page`).toMatch(/^#/);
    }
  });

  it("links only to sections /attribution actually renders", () => {
    // The only section this phase renders is #realised (phaseSections.ts).
    for (const c of cards()) {
      expect(c.href, `${c.href} is not an /attribution section`).toBe("#realised");
    }
  });
});
