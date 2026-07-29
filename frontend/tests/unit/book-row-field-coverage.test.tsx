// No field lost.
//
// `/book`'s position row is the densest thing in the product: twelve values in a
// collapsed 7-column grid, and roughly a dozen more in the expanded panel. Every
// one of them is a number some backend layer computed — an L2 beta, an L5 sizing
// step, an L4 scenario contribution — and the whole point of the page is that
// those reach the reader rather than dying in the UI.
//
// That makes any layout refactor of the row dangerous in a way tests usually
// don't catch: the page still renders, still looks right, and silently stops
// surfacing a column. So this renders the REAL component (not a copy of its
// markup, which would drift and pass while the page regressed) with a fixture
// where every field holds a distinctive value, and asserts each one reaches the
// output.
//
// Two deliberate choices:
//
//  1. Expected strings are hand-computed, NOT produced by the component's own
//     formatters. Asserting `fmtPct(pick.weight)` would pass even if fmtPct broke,
//     because both sides move together. "8.8%" is written out.
//  2. The fixture populates EVERYTHING. A guard whose fixture leaves a field null
//     cannot notice that field disappearing, so anything optional is filled and
//     the null-path copy is asserted separately.
//
// If you are here because this test failed after a layout change: the field is
// gone from the output. That is the bug, not the test.

import type { ComponentProps } from "react";
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { PositionRow } from "@/components/book/PositionRow";
import type { AdvisoryDerivation } from "@/lib/derivations/advisory";
import type { EdgeWeights } from "@/lib/themeSignals";
import type { ResolvedEdge } from "@/lib/book/positionEdge";
import type { ReplicationNames } from "@/lib/book/positionStability";
import { BOOK_ROW_GRID } from "@/lib/book/grid";

/** Derived from the component, so a prop rename breaks this test at compile time
 *  rather than silently rendering a row with a missing input. */
type RowProps = ComponentProps<typeof PositionRow>;

const RUN_DATE = "2026-07-25";

const EDGE_WEIGHTS: EdgeWeights = {
  trend: 0.35,
  regime: 0.25,
  carry: 0.2,
  value: 0.2,
  sentiment: 0,
  abstainThreshold: 0.15,
};

/** Verified + not-fallback, so the prose half of the panel is allowed to render.
 *  (canRenderAdvisoryBody gates thesis / counter-thesis / catalysts.) */
const ADVISORY: AdvisoryDerivation = {
  field_id: "book.position.XLE",
  generated_by: "l5_q1_agent",
  display_status: "verified",
  body: "Energy capex discipline persists.",
  method_id: "q1.reason_picks",
  evidence_ids: ["ev-1"],
  citation_status: "all_verified",
  fallback_used: false,
  computed_at: `${RUN_DATE}T21:30:00Z`,
  as_of: RUN_DATE,
};

/** Internally CONSISTENT on purpose, so this fixture exercises the happy path
 *  rather than an error path:
 *    edge_score = 0.61(0.35) + 0.22(0.25) + 0.13(0.20) - 0.08(0.20) + 0.04(0) = 0.2785
 *    conviction = |0.2785| / 0.0145                                          = 19.21
 *    normalised = 19.21 / CONVICTION_SUM(218.3)                              = 8.8% = weight
 *  An inconsistent fixture makes EdgeBars print "persisted EdgeScore differs…"
 *  and SizingChainView raise its reconciliation alert, and then the test is
 *  asserting field coverage across a book the product is busy disowning. */
const EDGE: ResolvedEdge = {
  edge_score: 0.2785,
  trend_signal: 0.61,
  regime_bias: 0.22,
  carry_signal: 0.13,
  value_signal: -0.08,
  sentiment_signal: 0.04,
  conviction: 19.21,
  vol: 0.0145,
  direction: "long",
  run_date: RUN_DATE,
  source: "position_row",
};

const CONVICTION_SUM = 218.3;

/** endDate must equal bookRunDate and samples >= 2, or stability reads
 *  "unmeasured" and the note is silent. */
const REPL: ReplicationNames = {
  stable: ["L:XLE"],
  unstable: [],
  endDate: RUN_DATE,
  samples: 3,
};

const PICK = {
  direction: "long" as const,
  asset: "XLE",
  theme_id: "th-energy",
  theme_name: "Energy Prices",
  thesis: "Energy capex discipline persists into a late-cycle regime.",
  counter_thesis: "Wrong if XLE breaks its 200-day moving average.",
  catalysts: ["OPEC quota decision", "Gulf refinery restart"],
  time_horizon: "3-6 months",
  factor_tilts: { beta_mkt: 0.71, beta_hml: -0.22 },
  factor_r_squared: 0.42,
  notional: 8_800_000,
  weight: 0.088,
  signed_weight: 0.088,
  hype_score: 60.1,
  ma_context: {
    last: 91.23,
    window: 200,
    ma: 88.11,
    pct_from_ma: 0.0354,
    observations: 252,
  },
};

const CAP = {
  key: "XLE",
  weight: 0.088,
  cap: 0.2,
  utilisation: 0.4412,
  breached: false,
};

const SCENARIOS = [
  {
    scenario_name: "S1_credit_widening",
    label: "Credit Widening (+200bps OAS)",
    estimated_book_return: -0.0157,
    estimated_dollar_pnl: -1.6,
    severity: "severe",
    contribution_breakdown: ["  XLE (long): +8.8% × +4% = +0.32%"],
  },
];

function render(overrides: Partial<RowProps> = {}) {
  const props: RowProps = {
    pick: PICK,
    rank: 7,
    open: true,
    onToggle: () => {},
    citations: [],
    advisory: ADVISORY,
    cap: CAP,
    bindingGroupCaps: [],
    edge: EDGE,
    edgeWeights: EDGE_WEIGHTS,
    convictionSum: CONVICTION_SUM,
    allPicks: [
      { asset: "XLE", direction: "long" as const, notional: 8_800_000 },
      { asset: "BABA", direction: "short" as const, notional: -9_000_000 },
    ],
    correlationPairs: null,
    ideas: null,
    scenarios: SCENARIOS,
    repl: REPL,
    bookRunDate: RUN_DATE,
    ...overrides,
  };
  const html = renderToString(<PositionRow {...props} />);
  // React SSR emits `<!-- -->` between adjacent text nodes, so `{"#"}{rank}`
  // arrives as `#<!-- -->7` and a naive `toContain("#7")` fails on markup that is
  // perfectly correct. Strip the markers so assertions read as what a user sees.
  // Without this the guard cries wolf on JSX that interpolates mid-sentence —
  // which is most of this row.
  return html.replace(/<!-- -->/g, "");
}

/** Each entry: what a reader is owed, and the exact text that proves it arrived. */
const COLLAPSED_FIELDS: Array<[string, string]> = [
  ["rank", "#7"],
  ["asset ticker", "XLE"],
  ["theme name", "Energy Prices"],
  ["theme link target", "/?theme=th-energy"],
  ["weight", "8.8%"],
  ["notional", "$8.8M"],
  ["EdgeScore", "+0.28"],
  ["conviction multiple", "19.2"],
  ["cap utilisation", "44% cap"],
  ["replication stability", "in all 3 reruns"],
];

const EXPANDED_FIELDS: Array<[string, string]> = [
  ["thesis prose", "Energy capex discipline persists into a late-cycle regime."],
  ["counter-thesis", "Wrong if XLE breaks its 200-day moving average."],
  ["ma_context last price", "91.23"],
  ["ma_context window", "200"],
  ["ma_context moving average", "88.11"],
  ["ma_context distance from MA", "+3.5%"],
  ["catalyst 1", "OPEC quota decision"],
  ["catalyst 2", "Gulf refinery restart"],
  ["time horizon", "3-6 months"],
  ["factor label + beta (mkt)", "+0.71"],
  ["factor label + beta (hml)", "-0.22"],
  ["factor r-squared", "0.42"],
  ["scenario label", "Credit Widening (+200bps OAS)"],
  ["scenario contribution", "+0.32%"],
];

describe("/book position row — no field lost", () => {
  it("renders", () => {
    expect(render().length).toBeGreaterThan(500);
  });

  it.each(COLLAPSED_FIELDS)("collapsed row surfaces %s", (_label, expected) => {
    // Collapsed is the state a reader sees first and the state Phase 3's grid
    // refactor touches, so these must survive with open={false}.
    expect(render({ open: false })).toContain(expected);
  });

  it.each(COLLAPSED_FIELDS)("expanded row still surfaces %s", (_label, expected) => {
    expect(render({ open: true })).toContain(expected);
  });

  it.each(EXPANDED_FIELDS)("expanded panel surfaces %s", (_label, expected) => {
    expect(render({ open: true })).toContain(expected);
  });

  it("hides the expanded panel when collapsed", () => {
    // The converse of the above: if the panel rendered while collapsed, the
    // expanded assertions would be trivially satisfied and prove nothing.
    const html = render({ open: false });
    expect(html).not.toContain("Energy capex discipline persists into a late-cycle regime.");
    expect(html).not.toContain("OPEC quota decision");
  });

  it("lays the row out on the shared column template", () => {
    // Pairs with tests/unit/book-row-grid.test.ts: that one proves the template is
    // defined once, this one proves the row actually uses it rather than carrying
    // its own inline copy again.
    expect(render({ open: false })).toContain(BOOK_ROW_GRID);
  });

  it("marks the disclosure state so it is operable and announced", () => {
    expect(render({ open: false })).toContain('aria-expanded="false"');
    expect(render({ open: true })).toContain('aria-expanded="true"');
  });

  it("raises no reconciliation alarm on a self-consistent position", () => {
    // The converse guard. SizingChainView alerts when the steps do not compose
    // into the held weight (ADR-0053) and EdgeBars notes when the persisted
    // EdgeScore disagrees with its own components. Both are correct to fire on
    // real broken books — but if they fire on a clean one, the page cries wolf on
    // every row and readers learn to ignore the one that matters.
    const html = render({ open: true });
    expect(html).not.toContain('data-testid="sizing-reconciliation"');
    expect(html).not.toContain("differs from this derivation");
  });

  it("factor betas keep their human labels, not raw column names", () => {
    const html = render({ open: true });
    expect(html).toContain("Mkt");
    expect(html).toContain("HML");
    expect(html).not.toContain("beta_mkt");
  });
});

describe("/book position row — absence is stated, not filled", () => {
  // docs/design-goals.md §2: a null renders as an em-dash plus a cause, never as
  // zero and never as a silently dropped row. These paths are as much a part of
  // the contract as the populated ones.

  it("says the EdgeScore is not persisted rather than printing 0", () => {
    const html = render({ edge: undefined, open: false });
    expect(html).toContain("EdgeScore not persisted for this position");
    expect(html).not.toContain("+0.00");
  });

  it("labels a hype-sized position instead of inventing a conviction", () => {
    const html = render({
      edge: { ...EDGE, conviction: null, edge_score: null },
      open: false,
    });
    expect(html).toContain("hype");
  });

  it("renders an em-dash for a missing cap rather than 0% cap", () => {
    const html = render({ cap: undefined, open: false });
    expect(html).not.toContain("0% cap");
  });

  it("stays silent on stability when the replication is from another run", () => {
    const html = render({
      repl: { ...REPL, endDate: "2026-07-01" },
      open: false,
    });
    expect(html).not.toContain("reruns");
  });

  it("withholds an unverified thesis and says so", () => {
    const html = render({
      advisory: { ...ADVISORY, fallback_used: true },
      open: true,
    });
    expect(html).toContain("did not pass citation verification");
  });

  it("names the missing table when no factor fit was recorded", () => {
    const html = render({
      pick: { ...PICK, factor_r_squared: null },
      open: true,
    });
    expect(html).toContain("Fit quality not recorded.");
  });
});

// ── /book2 comparison layout ────────────────────────────────────────────────────
//
// TEMPORARY, alongside the `/book2` route. Delete this block when the variant goes.
//
// The point of the comparison is that only PLACEMENT differs. If `next` ever renders
// different CONTENT, the comparison stops being about layout and starts being about
// which branch someone remembered to update — so the first test here is that the two
// variants render the same fields, and the rest pin where they sit.
describe("the next layout moves cards without changing what they say", () => {
  const cellOf = (html: string, title: string): string | null => {
    // The SubCard's grid classes and its title live in the same element subtree;
    // find the title, then walk back to the nearest className that placed it.
    const at = html.indexOf(title);
    if (at === -1) return null;
    const before = html.slice(0, at);
    // A while-loop rather than [...matchAll]: the tsconfig target predates
    // downlevelIteration, so spreading a RegExpStringIterator does not compile.
    const re = /lg:row-start-(\d) lg:col-start-(\d)/g;
    let last: RegExpExecArray | null = null;
    let m: RegExpExecArray | null;
    while ((m = re.exec(before)) !== null) last = m;
    return last ? `r${last[1]}c${last[2]}` : null;
  };

  it("renders every field in both variants", () => {
    const current = render({ open: true, variant: "current" });
    const next = render({ open: true, variant: "next" });
    // Only cards this fixture actually produces. `Risk` and `Also cleared, not taken`
    // are conditional on data it does not carry, and asserting them here would pass
    // for the wrong reason — absent from both variants is not "the same".
    for (const field of [
      "Thesis",
      "Counter-thesis",
      "Catalysts",
      "Contribution to book",
      "Under stress",
      "Sizing — conviction",
      "Factor exposure",
      "8.8%",
    ]) {
      expect(current, `current is missing ${field}`).toContain(field);
      expect(next, `next is missing ${field}`).toContain(field);
    }
  });

  it("currently separates the argument from its rebuttal", () => {
    // The shipped layout. Counter-thesis is directly BELOW the thesis, and the card
    // beside it is `Sizing` (auto-placed). Not a hole -- the grid is full -- but the
    // claim and its rebuttal are never on the same line.
    const html = render({ open: true, variant: "current" });
    expect(cellOf(html, "Thesis")).toBe("r1c1");
    expect(cellOf(html, "Counter-thesis")).toBe("r2c1");
    expect(cellOf(html, "Why long")).toBe("r1c2");
  });

  it("puts the counter-thesis beside the thesis in the next layout", () => {
    const html = render({ open: true, variant: "next" });
    expect(cellOf(html, "Thesis")).toBe("r1c1");
    expect(cellOf(html, "Counter-thesis")).toBe("r1c2");
    expect(cellOf(html, "Why long")).toBe("r2c1");
  });

  it("swaps exactly two cards and leaves the rest where they were", () => {
    // A wider reshuffle would fight the two AUTO-PLACED cards (`Sizing`, `Factor
    // exposure`), which carry no row/col and fill whatever is free. Pinning the
    // untouched placements is what stops a future edit from quietly reflowing them.
    const cur = render({ open: true, variant: "current" });
    const next = render({ open: true, variant: "next" });
    for (const [title, at] of [
      ["Catalysts", "r3c1"],
      ["Contribution to book", "r4c1"],
      ["Under stress", "r4c2"],
    ] as const) {
      expect(cellOf(cur, title), `current ${title}`).toBe(at);
      expect(cellOf(next, title), `next ${title}`).toBe(at);
    }
  });

  it("defaults to the current layout when no variant is passed", () => {
    // /book must be bit-identical while the comparison is open.
    expect(render({ open: true })).toBe(render({ open: true, variant: "current" }));
  });
});
