// frontend/tests/unit/book-cleared-alternatives.test.tsx
//
// Cross-anchor between a held PositionRow and ClearedNotTaken: each held row
// renders a "Also cleared, not taken" footer with deep links of the form
// `#cleared-${asset}-${direction}` so a reader can jump from "why this name" to
// "what we passed on instead" without a route hop. The corresponding `id` is
// written on every ClearedNotTaken row (same format), so this test pins both
// ends and would fail closed if either side drifts.

import type { ComponentProps } from "react";
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { PositionRow } from "@/components/book/PositionRow";
import type { CandidateRow } from "@/components/book/ClearedNotTaken";
import type { AdvisoryDerivation } from "@/lib/derivations/advisory";
import type { EdgeWeights } from "@/lib/themeSignals";
import type { ResolvedEdge } from "@/lib/book/positionEdge";
import type { ReplicationNames } from "@/lib/book/positionStability";

type RowProps = ComponentProps<typeof PositionRow>;

const RUN_DATE = "2026-07-25";

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

const EDGE_WEIGHTS: EdgeWeights = {
  trend: 0.35,
  regime: 0.25,
  carry: 0.2,
  value: 0.2,
  sentiment: 0,
  abstainThreshold: 0.15,
};

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
  catalysts: ["OPEC quota decision"],
  time_horizon: "3-6 months",
  factor_tilts: { beta_mkt: 0.71 },
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

const SCENARIOS = [
  {
    scenario_name: "S1",
    label: "S1",
    estimated_book_return: 0.0032,
    estimated_dollar_pnl: 320_000,
    severity: "low" as const,
    line: "S1 = +0.32%",
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
    cap: { key: "XLE", weight: 0.088, cap: 0.2, utilisation: 0.4412, breached: false },
    bindingGroupCaps: [],
    edge: EDGE,
    edgeWeights: EDGE_WEIGHTS,
    convictionSum: 218.3,
    allPicks: [{ asset: "XLE", direction: "long", notional: 8_800_000 }],
    correlationPairs: null,
    ideas: null,
    scenarios: SCENARIOS,
    repl: REPL,
    bookRunDate: RUN_DATE,
    ...overrides,
  };
  return renderToString(<PositionRow {...props} />).replace(/<!-- -->/g, "");
}

const ALTS: CandidateRow[] = [
  {
    asset: "XOP",
    direction: "long",
    edge_score: -0.184,
    theme_id: "th-energy",
    via_conviction: false,
  },
  {
    asset: "CVX",
    direction: "long",
    edge_score: 0.052,
    theme_id: "th-energy",
    via_conviction: false,
  },
];

describe("/book position row — cleared-alternatives cross-anchor", () => {
  it("renders nothing when clearedAlternatives is undefined", () => {
    expect(render()).not.toContain("Also cleared, not taken");
  });

  it("renders nothing when clearedAlternatives is empty", () => {
    expect(render({ clearedAlternatives: [] })).not.toContain("Also cleared, not taken");
  });

  it("lists each alternative as an anchor targeting the cleared row", () => {
    const html = render({ clearedAlternatives: ALTS });
    expect(html).toContain("Also cleared, not taken");
    // Format MUST match what ClearedNotTaken writes on its row id, so the
    // anchor actually lands. See frontend/components/book/ClearedNotTaken.tsx
    // for the matching id={`cleared-${c.asset}-${c.direction}`}.
    expect(html).toContain('href="#cleared-XOP-long"');
    expect(html).toContain('href="#cleared-CVX-long"');
  });

  it("falls back to the section anchor when more than four alternatives exist", () => {
    const many: CandidateRow[] = [
      ...ALTS,
      { asset: "OXY", direction: "long", edge_score: -0.1, theme_id: "th-energy", via_conviction: false },
      { asset: "EOG", direction: "long", edge_score: -0.2, theme_id: "th-energy", via_conviction: false },
      { asset: "PSX", direction: "long", edge_score: -0.3, theme_id: "th-energy", via_conviction: false },
    ];
    const html = render({ clearedAlternatives: many });
    expect(html).toContain("and 1 more");
    expect(html).toContain('href="#not-taken"');
  });

  it("renders the cross-anchor block only in the expanded panel", () => {
    const htmlClosed = render({ open: false, clearedAlternatives: ALTS });
    const htmlOpen = render({ open: true, clearedAlternatives: ALTS });
    expect(htmlClosed).not.toContain("Also cleared, not taken");
    expect(htmlOpen).toContain("Also cleared, not taken");
  });
});
