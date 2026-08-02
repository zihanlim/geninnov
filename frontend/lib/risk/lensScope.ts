// frontend/lib/risk/lensScope.ts
//
// Which panels on /mandate, /risk and /attribution can follow the lens, and
// which cannot.
//
// Migration 062 re-keyed `research_recommendations` and `book_holdings` on
// (run_date, lens), so one run_date now carries both the multi-asset book and
// the credit-lens book. Migration 068 (ADR-0222) gave `portfolio_positions`
// the same key, so the held book follows the lens too. What the migrations
// deliberately left lens-less — `portfolio_risk`, `portfolio_returns`,
// `portfolio_cumulative_return`, `book_holdings_performance`, `pick_outcomes`,
// `benchmark_returns` — was ADR-0194's decision, not an oversight: a second
// book must not write into the first book's record. There is exactly one
// realised return series, one forward track record, and they belong to the
// multi-asset book that has been published every day since inception. The
// per-lens held book (m068) is a forward-looking lens decomposition, not a
// second realised record.
//
// RiskBody makes ~12 reads and they split along that line. The hazard is not
// that the lens-less half is wrong; it is that it renders IDENTICALLY under
// any lens. Swap the page to the credit lens and a reader gets credit stress
// scenarios sitting beside a multi-asset VaR headline and a multi-asset
// drawdown curve, with nothing on screen saying they are two different books.
// That is ADR-0084's failure — one page describing two vintages of one run —
// and it would be strictly worse than today's honest hardcoded pin.
//
// So this module is the single source of truth for "can this panel follow the
// lens?", and every disclosure on the three pages is derived from it. Pure: no
// React, no Supabase, no rendering. The components that consume it are in
// components/risk/LensScope.tsx.
//
// THE INVARIANT THAT OUTRANKS EVERYTHING ELSE HERE: under the default lens the
// pages must look exactly as they do today. `showScopeNote` returns false for
// every panel when the lens is multi_asset — not "usually false", false — so
// no banner, chip or spacing change can reach the default page.

import { DEFAULT_LENS } from "@/lib/book/lensView";

/**
 * What a panel's figures are keyed on.
 *
 *   book      — every source follows the lens (`research_recommendations`, a
 *               lens-keyed table like `portfolio_positions` since migration
 *               068, or a lens-neutral per-asset/config table). Under the
 *               credit lens these figures ARE the credit book's. Nothing to
 *               disclose.
 *   published — every source is a lens-less table: the multi-asset published
 *               record, unchanged by the lens toggle.
 *   mixed     — both, in one panel. The worst case to read and the one most
 *               needing a marker, because the two halves sit inside a single
 *               card with one heading over them.
 */
export type LensScope = "book" | "published" | "mixed";

/**
 * The tables the migrations deliberately left without a lens column (ADR-0194).
 * A figure sourced from one of these is the MULTI-ASSET book's figure whatever
 * `?lens=` says. Migration 068 (ADR-0222) gave `portfolio_positions` a lens
 * column — it belongs in `LENS_KEYED_TABLES`, not here.
 */
export const LENS_LESS_TABLES: readonly string[] = [
  "portfolio_risk",
  "portfolio_returns",
  "portfolio_cumulative_return",
  "book_holdings_performance",
  "pick_outcomes",
  "benchmark_returns",
];

/**
 * Tables keyed on (run_date, lens) that are NOT `research_recommendations` —
 * the payload columns of which are listed in `LENS_FOLLOWING_FIELDS`. A source
 * naming one of these is the ACTIVE lens's own figure.
 *
 * `book_holdings` has been lens-keyed since migration 062; `portfolio_positions`
 * joined it in migration 068 / ADR-0222. Before 068, `portfolio_positions` was
 * lens-less and a figure sourced from it was the multi-asset book's whatever
 * `?lens=` said — that is the state several comments around the codebase still
 * describe.
 */
export const LENS_KEYED_TABLES: readonly string[] = [
  "book_holdings",
  "portfolio_positions",
];

/**
 * Tables with no lens column that need none: per-asset or per-config facts
 * that are equally true under every lens. `factor_exposures` holds one FF5+UMD
 * beta per asset per run — the credit book's HYG has the same betas as the
 * multi-asset book's HYG. `scoring_config` is one config row set. `themes` and
 * `theme_signals_history` are the theme universe and its attention history.
 *
 * These are NOT a third scope. They sit with "book", because reading them
 * under the credit lens yields the credit book's answer — there is nothing to
 * disclose. They are named here only so the tests can tell a neutral table
 * apart from an unclassified one.
 */
export const LENS_NEUTRAL_TABLES: readonly string[] = [
  "factor_exposures",
  "scoring_config",
  "themes",
  "theme_signals_history",
];

/**
 * The JSONB payload columns of `research_recommendations`, which IS keyed on
 * (run_date, lens) since migration 062.
 *
 * A row citing one of these is the ACTIVE lens's own figure. They are named
 * without their parent table throughout the codebase — `LimitDef.source` reads
 * `book_metrics.net_exposure`, not
 * `research_recommendations.book_metrics.net_exposure` — because the pages
 * destructure the payload before handing it to a builder, and the short form is
 * what the reader sees under the row. That is exactly why this list has to
 * exist: `book_metrics` looks like a table name and is not one, so a reader
 * cannot tell it from `portfolio_risk` by shape.
 */
export const LENS_FOLLOWING_FIELDS: readonly string[] = [
  "research_recommendations",
  "book_metrics",
  "cap_utilisation",
  "optimizer_result",
  "scenario_results",
  "correlation_pairs",
  "risk_decomposition",
  "monte_carlo_var",
  "var_forecast",
  "weights_backtest",
  "sanctions_exposure",
  "positioning_crowding",
  "independent_ideas",
];

/**
 * Which book ONE ROW's value belongs to, decided from the `table.column` string
 * the row already prints under itself.
 *
 *   published    — names a lens-less table. The multi-asset book's figure,
 *                  whatever `?lens=` says.
 *   book         — names a lens-following payload field or a lens-neutral
 *                  table. The active lens's own figure; nothing to disclose.
 *   unclassified — names neither. See `sourceProvenance` for why this is a
 *                  state and not an error.
 */
export type SourceProvenance = "published" | "book" | "unclassified";

/**
 * Classify a `LimitDef.source`-style provenance string.
 *
 * Tokenised rather than prefix-matched, because these strings are not always a
 * bare `table.column`: the VaR row reads `portfolio_risk.var_95 /
 * total_capital`, a ratio over two columns of one table, and matching on the
 * text before the first `.` would work by accident today and break the first
 * time a row cites a denominator from somewhere else.
 *
 * PUBLISHED WINS A TIE, deliberately. A source naming both a lens-less table
 * and a lens-following field is a row that is itself part multi-asset, and the
 * whole point of marking a row is that a reader should not have to hold "some
 * of this one is the other book" in their head unmarked.
 *
 * `unclassified` is fail-loud, the same choice `scopeOf` makes: a source
 * nobody has classified gets MARKED rather than silently passed as the active
 * lens's own. The two possible defaults are not symmetric — default to "book"
 * and a new lens-less row ships unmarked under a credit heading, which is the
 * defect this module exists to prevent, reintroduced by an omission.
 * `tests/unit/lens-scope.test.ts` asserts no row the live board builds is
 * unclassified today, so this is a backstop and not a live state.
 */
export function sourceProvenance(source: string): SourceProvenance {
  const tokens = source.split(/[^A-Za-z0-9_]+/).filter(Boolean);
  if (tokens.some((t) => LENS_LESS_TABLES.includes(t))) return "published";
  if (
    tokens.some(
      (t) =>
        LENS_FOLLOWING_FIELDS.includes(t) ||
        LENS_KEYED_TABLES.includes(t) ||
        LENS_NEUTRAL_TABLES.includes(t),
    )
  ) {
    return "book";
  }
  return "unclassified";
}

/**
 * Should THIS ROW carry a "still the multi-asset book" tag right now?
 *
 * The row-level twin of `showScopeNote`, and it holds the same contract: false
 * for every source under the default lens, so a page with no `?lens=` in the
 * URL renders byte-for-byte as it did before row tagging existed.
 */
export function showSourceScopeNote(lens: string, source: string): boolean {
  if (lens === DEFAULT_LENS) return false;
  return sourceProvenance(source) !== "book";
}

export interface PanelSources {
  scope: LensScope;
  /**
   * The actual tables the panel's figures come from, as `table` or
   * `table.column`.
   *
   * One source form is written with a leading parenthesised qualifier, which
   * takes it out of the table checks in tests/unit/lens-scope.test.ts because
   * the checks would ask the wrong question of it:
   *
   *   `(static) path`  — not a table at all, a constant module. Lets the tests
   *                      tell "no table" from "table I forgot to classify".
   */
  sources: string[];
  /** How the panel is named to a reader. Falls back to the key; see `panelLabel`. */
  label?: string;
}

/**
 * Every panel RiskBody renders, keyed by the component that renders it.
 *
 * Keys are component names because that is the one identifier that is stable
 * across the three phase routes and cannot be confused with a section id — two
 * panels share `#limits`, and three share `(page chrome)`.
 */
export const PANEL_SCOPE: Record<string, PanelSources> = {
  // ── Page chrome — rendered on all three phases ─────────────────────────────
  PageHeader: {
    scope: "book",
    label: "Page header",
    sources: ["research_recommendations.run_date", "research_recommendations.lens"],
  },
  ReconciliationBanner: {
    // "book": both sides of the comparison follow the lens. `portfolio_positions`
    // is per-lens since migration 068 (ADR-0222) and RiskBody reads it at
    // `resolved`, and the pick list is read at `resolved` too — so the banner
    // compares the ACTIVE book's held names against its own published picks,
    // which is the only comparison that can truthfully say "provisional". (It
    // was briefly cross-book, twice: before 068 only the pick side followed the
    // lens, and after the pin outlived the migration it read "3 held · 9
    // published" on every credit run. Reading both sides at `resolved` made it
    // same-book again. See the read in RiskBody's Promise.all.)
    scope: "book",
    label: "Provisional-positions banner",
    sources: ["portfolio_positions.asset", "research_recommendations.picks"],
  },
  ReadErrorsBanner: {
    scope: "mixed",
    label: "Read-error banner",
    sources: ["research_recommendations", "portfolio_risk", "portfolio_returns"],
  },

  // ── Answer rows — one per phase ────────────────────────────────────────────
  MandateAnswerRow: {
    scope: "mixed",
    label: "Mandate answer row",
    sources: [
      "scoring_config",
      "portfolio_risk.total_capital",
      "portfolio_risk.var_95",
      "portfolio_risk.cvar_95",
      "portfolio_risk.beta",
      // Either table, depending on the run. ADR-0208 made this figure lens-following
      // (`book_metrics.concentration_hhi`); the lens-less column is the fallback for a
      // row written before that field existed, so a reader on an older run is still
      // seeing the multi-asset book's number here and the chip must keep saying so.
      // The row itself cites whichever it actually read.
      "research_recommendations.book_metrics.concentration_hhi",
      "portfolio_risk.concentration_hhi",
      "portfolio_returns.cumulative_return",
      "research_recommendations.book_metrics",
      "research_recommendations.cap_utilisation",
      "research_recommendations.optimizer_result",
    ],
  },
  AttributionAnswerRow: {
    scope: "published",
    label: "Attribution answer row",
    sources: ["pick_outcomes", "book_holdings_performance", "portfolio_returns"],
  },
  RiskAnswerRow: {
    // Everything follows the lens: the analytics payload fields and the held
    // positions (per-lens since migration 068). factor_exposures is
    // lens-neutral. Nothing here is the multi-asset published record, so no
    // disclosure is owed. (Before migration 068 the held positions were
    // lens-less, which is what made this "mixed".)
    scope: "book",
    label: "Risk answer row",
    sources: [
      "research_recommendations.scenario_results",
      "research_recommendations.correlation_pairs",
      "research_recommendations.optimizer_result",
      "portfolio_positions",
      "factor_exposures",
    ],
  },
  SectionNav: {
    scope: "book",
    label: "Section nav",
    sources: ["(static) lib/method/phaseSections.ts"],
  },

  // ── Phase 1: mandate & limits ──────────────────────────────────────────────
  MandatePanel: {
    // Every LIMIT VALUE here is a static constant, not a table: the mandate is
    // what the book is allowed to be, which does not change with the lens.
    scope: "book",
    label: "The mandate",
    sources: [
      "scoring_config.param_name",
      "research_recommendations.lens",
      "(static) lib/mandate.ts",
    ],
  },
  RiskLimitBoard: {
    // The single worst panel to swap silently: five of its eleven rows are
    // valued from lens-less tables and six from the lens-following analytics
    // row, in one table, under one heading, with one OK/BREACH column.
    scope: "mixed",
    label: "Risk-limit board",
    sources: [
      "scoring_config",
      "portfolio_risk.var_95",
      "portfolio_risk.cvar_95",
      "portfolio_risk.beta",
      // Either table, depending on the run. ADR-0208 made this figure lens-following
      // (`book_metrics.concentration_hhi`); the lens-less column is the fallback for a
      // row written before that field existed, so a reader on an older run is still
      // seeing the multi-asset book's number here and the chip must keep saying so.
      // The row itself cites whichever it actually read.
      "research_recommendations.book_metrics.concentration_hhi",
      "portfolio_risk.concentration_hhi",
      // Either table, depending on the run — the beta row's twin of the HHI pair
      // above (ADR-0212). The lens-following factor beta is preferred; the lens-less
      // regression is the fallback for a row written before `factor_covered_gross`
      // existed, so the chip must keep saying "part multi-asset" while historical
      // rows still fall through. The row itself cites whichever it actually read.
      "research_recommendations.book_metrics.factor_tilts",
      "portfolio_risk.beta",
      "portfolio_returns.cumulative_return",
      "research_recommendations.book_metrics",
      "research_recommendations.cap_utilisation",
      "research_recommendations.optimizer_result",
    ],
  },
  CapUtilisation: {
    scope: "book",
    label: "Cap headroom",
    sources: [
      "research_recommendations.cap_utilisation",
      "research_recommendations.optimizer_result",
      "research_recommendations.book_metrics",
    ],
  },

  // ── Phase 2: risk & scenario ───────────────────────────────────────────────
  StressScenarios: {
    scope: "book",
    label: "Stress scenarios",
    sources: ["research_recommendations.scenario_results"],
  },
  WhatIfScenario: {
    // The shocked positions follow the lens (portfolio_positions is per-lens
    // since migration 068), but the dollar P&L is sized against
    // total_capital, which is the multi-asset book's — so under the credit
    // lens the panel is genuinely mixed: credit positions, multi-asset
    // capital. factor_exposures is lens-neutral (one FF5+UMD beta per asset
    // per run is the same fact under every lens).
    scope: "mixed",
    label: "What-if shock builder",
    sources: ["portfolio_positions", "portfolio_risk.total_capital", "factor_exposures"],
  },
  SanctionsExposure: {
    scope: "book",
    label: "Sanctions exposure",
    sources: ["research_recommendations.sanctions_exposure"],
  },
  PositioningCrowding: {
    scope: "book",
    label: "External positioning",
    sources: ["research_recommendations.positioning_crowding"],
  },
  VarMethods: {
    // Three of the four VaRs follow the lens; the published one on the risk row
    // does not. Putting a multi-asset VaR in a four-way comparison of credit
    // VaRs is precisely the "two numbers called VaR" defect ADR-0082 named.
    scope: "mixed",
    label: "VaR by method",
    sources: [
      "portfolio_risk.var_95",
      "portfolio_risk.var_95_historical",
      "research_recommendations.risk_decomposition",
      "research_recommendations.monte_carlo_var",
      "research_recommendations.var_forecast",
      "portfolio_returns",
    ],
  },
  PositionRiskScatter: {
    // Both inputs follow the lens: the held positions (per-lens since
    // migration 068) and the lens-keyed risk decomposition. Under the credit
    // lens every point is a credit position.
    scope: "book",
    label: "Position risk scatter",
    sources: ["portfolio_positions", "research_recommendations.risk_decomposition"],
  },
  RiskContributionWaterfall: {
    scope: "book",
    label: "Risk contribution waterfall",
    sources: ["research_recommendations.risk_decomposition"],
  },
  PositionRiskAttribution: {
    // Still mixed after migration 068: the held positions now follow the lens,
    // but the beta and the returns series are the multi-asset published record
    // (ADR-0194), and this panel puts them side by side under one heading.
    scope: "mixed",
    label: "Per-position attribution",
    sources: [
      "portfolio_positions",
      "factor_exposures",
      "research_recommendations.correlation_pairs",
      "portfolio_risk.beta",
      "portfolio_returns",
    ],
  },
  AttentionCrowding: {
    // Everything follows the lens: the two theme tables are lens-neutral, and
    // the held-position list is per-lens since migration 068 — so under the
    // credit lens every row scores a theme the CREDIT book holds.
    scope: "book",
    label: "Theme attention crowding",
    sources: ["theme_signals_history", "themes", "portfolio_positions"],
  },
  CorrelationMatrix: {
    scope: "book",
    label: "Correlation matrix",
    sources: [
      "research_recommendations.correlation_pairs",
      "research_recommendations.book_metrics",
    ],
  },
  BookFactorTilt: {
    scope: "book",
    label: "Book factor tilt",
    sources: ["research_recommendations.book_metrics"],
  },

  // ── Phase 3: attribution & feedback ────────────────────────────────────────
  // /attribution stays pinned to multi_asset (ADR-0194), so in practice none of
  // these should ever be shown under another lens. They are classified anyway:
  // an entry that exists is an entry that cannot be got wrong later by someone
  // who decides to give this phase a lens control after all.
  RiskMetricsGrid: {
    scope: "published",
    label: "Headline risk metrics",
    sources: ["portfolio_risk", "portfolio_returns"],
  },
  TrackRecord: {
    scope: "published",
    label: "Forward track record",
    sources: ["pick_outcomes"],
  },
  BenchmarkComparison: {
    scope: "published",
    label: "Benchmark comparison",
    sources: [
      "portfolio_risk.benchmark_comparison",
      "portfolio_risk.conditional_vol",
      "portfolio_returns",
    ],
  },
  WeightsBacktest: {
    scope: "book",
    label: "Weights backtest",
    sources: ["research_recommendations.weights_backtest"],
  },
  InceptionCaveat: {
    scope: "published",
    label: "Since-inception caveat",
    sources: ["portfolio_cumulative_return"],
  },
  CostDrag: {
    scope: "published",
    label: "Cost drag",
    sources: [
      "book_holdings_performance",
      "portfolio_cumulative_return",
      "portfolio_risk.total_capital",
    ],
  },
  DrawdownChart: {
    scope: "published",
    label: "Drawdown & return path",
    sources: ["portfolio_returns", "portfolio_cumulative_return", "benchmark_returns"],
  },
  DailyPLHistory: {
    scope: "published",
    label: "Daily P&L history",
    sources: ["portfolio_returns"],
  },
};

/**
 * The scope of a panel, or "mixed" for one this module has never heard of.
 *
 * FAIL LOUD, NOT SILENT. An unknown panel id is a panel somebody added and
 * forgot to classify, and the two possible defaults are not symmetric: default
 * to "book" and that panel presents multi-asset figures under a credit heading
 * with nothing on screen to say so — the exact defect this module exists to
 * prevent, reintroduced by an omission. Default to "mixed" and the worst case
 * is a note on a panel that did not need one. Over-disclose.
 */
export function scopeOf(panel: string): LensScope {
  return PANEL_SCOPE[panel]?.scope ?? "mixed";
}

/**
 * Should this panel carry a "still the multi-asset book" marker right now?
 *
 * False for EVERY panel under the default lens. That is not an optimisation,
 * it is the contract: /mandate, /risk and /attribution with no `?lens=` in the
 * URL must render byte-for-byte as they did before the lens control existed.
 */
export function showScopeNote(lens: string, panel: string): boolean {
  if (lens === DEFAULT_LENS) return false;
  return scopeOf(panel) !== "book";
}

/**
 * Every panel that cannot follow the lens, in declaration order — the list the
 * page-level banner names so a reader learns the boundary once, at the top,
 * instead of inferring it from scattered chips.
 */
export function lensLessPanels(): string[] {
  return Object.keys(PANEL_SCOPE).filter((p) => PANEL_SCOPE[p].scope !== "book");
}

/** How a panel is named to a reader; the key itself if it has no label. */
export function panelLabel(panel: string): string {
  return PANEL_SCOPE[panel]?.label ?? panel;
}
