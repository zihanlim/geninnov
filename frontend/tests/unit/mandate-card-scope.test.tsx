// "Closest to binding" is a verdict, and it can be about another book's limit.
//
// ADR-0211 gave the risk-limit board a per-row mark because five of its eleven rows
// are the multi-asset book's under `?lens=credit`. The card ABOVE that board names
// whichever of those rows is tightest — so it inherits the same problem one altitude
// up, and with a heading that is a verdict rather than a measurement.
//
// It is also the only card here whose scope changes with the DATA. The other three
// are fixed by which column they read, so they are asserted to stay unmarked: an
// over-disclosing card is not harmless, it invites a reader to discount the credit
// book's own gross exposure and cap compliance as somebody else's figures.

import { describe, expect, it } from "vitest";
import { mandateAnswerCards } from "@/components/risk/MandateAnswerCards";
import type { LimitRow } from "@/lib/risk/riskBoard";
import type { AnalyticsState, BookMetrics, CapUtilisation } from "@/lib/risk/analytics";

const row = (over: Partial<LimitRow>): LimitRow => ({
  key: "x",
  label: "X",
  unit: "pct_of_capital",
  limitSource: "house_default",
  note: "",
  source: "cap_utilisation.single_name",
  value: 0.1,
  limit: 1,
  utilisation: 0.1,
  headroom: 0.9,
  status: "ok",
  ...over,
});

/** The credit book's own cap, tightest — the live 2026-07-30 shape. */
const BOOK_TIGHTEST = [
  row({ key: "single_name_cap", label: "Single-name cap", source: "cap_utilisation.single_name", utilisation: 1.0 }),
  row({ key: "max_drawdown", label: "Max drawdown", source: "portfolio_returns.cumulative_return", utilisation: 0.04 }),
];

/** The multi-asset book's drawdown, tightest — the case the mark exists for. */
const PUBLISHED_TIGHTEST = [
  row({ key: "single_name_cap", label: "Single-name cap", source: "cap_utilisation.single_name", utilisation: 0.2 }),
  row({ key: "max_drawdown", label: "Max drawdown", source: "portfolio_returns.cumulative_return", utilisation: 0.9 }),
];

const CAPS: AnalyticsState<CapUtilisation> = {
  status: "ok",
  value: { violations: [] } as unknown as CapUtilisation,
  runDate: "2026-07-30",
};
const BM = { gross_exposure: 0.5 } as BookMetrics;

const cards = (limitRows: LimitRow[], lens?: string) =>
  mandateAnswerCards({
    limitRows,
    capState: CAPS,
    bookMetrics: BM,
    totalCapital: 100_000_000,
    lens,
  });

const binding = (limitRows: LimitRow[], lens?: string) =>
  cards(limitRows, lens).find((c) => c.label === "Closest to binding")!;

describe("the default lens marks nothing", () => {
  it("is unmarked even when the tightest limit is lens-less", () => {
    // The contract every lens disclosure in this repo holds: /mandate with no
    // ?lens= renders exactly as it did before any of this existed.
    expect(binding(PUBLISHED_TIGHTEST, "multi_asset").scopeNote).toBeUndefined();
    expect(binding(PUBLISHED_TIGHTEST).scopeNote).toBeUndefined();  // lens omitted
  });

  it("marks no card at all under the default lens", () => {
    for (const c of cards(PUBLISHED_TIGHTEST, "multi_asset")) {
      expect(c.scopeNote, c.label).toBeUndefined();
    }
  });
});

describe("under a non-default lens", () => {
  it("marks the card when the tightest limit is the multi-asset book's", () => {
    const c = binding(PUBLISHED_TIGHTEST, "credit");
    expect(c.scopeNote).toBeDefined();
    expect(c.scopeNote).toContain("portfolio_returns");
    expect(c.scopeNote).toContain("ADR-0194");
  });

  it("says the tightest of THIS book's limits may be a different one", () => {
    // The actionable half. "This figure is another book's" leaves a reader thinking
    // the credit book has no binding constraint; what they need to know is that the
    // ranking itself was decided partly by a row that is not theirs.
    expect(binding(PUBLISHED_TIGHTEST, "credit").scopeNote).toContain(
      "may be a different one",
    );
  });

  it("does NOT mark the card when the tightest limit follows the lens", () => {
    // The live case. Over-disclosure here would tell a reader the credit book's own
    // 100%-utilised single-name cap is the multi-asset book's figure — which is the
    // exact misreading ADR-0211 refused to allow on the board below.
    expect(binding(BOOK_TIGHTEST, "credit").scopeNote).toBeUndefined();
  });

  it("leaves the other three cards unmarked, because their figures follow the lens", () => {
    // Card 1's source names `portfolio_risk.total_capital`, so a mechanical
    // `sourceProvenance` over the source string would mark it — its HEADLINE is
    // `book_metrics.gross_exposure` and does follow the lens. That is why the mark is
    // set by the builder, which knows which figure it put on the card, rather than
    // derived from the source string in the component.
    const marked = cards(PUBLISHED_TIGHTEST, "credit")
      .filter((c) => c.scopeNote !== undefined)
      .map((c) => c.label);
    expect(marked).toEqual(["Closest to binding"]);
  });

  it("marks nothing when no limit is measurable", () => {
    // No tightest row means no figure, and a mark on an em-dash claims a provenance
    // for a value that does not exist.
    const none = binding([row({ utilisation: null, status: "unknown" })], "credit");
    expect(none.figure).toBeNull();
    expect(none.scopeNote).toBeUndefined();
  });
});
