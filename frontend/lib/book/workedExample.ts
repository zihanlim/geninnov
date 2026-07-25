// frontend/lib/book/workedExample.ts
//
// The data shape for the /book "Worked Example" lineage panel (ADR-0081).
// Pure functions only \u2014 no React, no DOM, no fetching. The component reads
// these and renders them; the test imports these and asserts the eight fields
// the row already surfaces are not silently dropped by the panel.
//
// Why a function and not a direct render: putting the shape in lib/ keeps the
// no-information-loss guarantee machine-checkable, and any future breakage
// localises to either the data (tested) or the markup.
//
// This header used to add "React-component tests are not available" — true when
// it was written, no longer. vitest.config.ts now sets `oxc: { jsx: ... }`, so a
// component can be rendered with react-dom/server and asserted directly; see
// tests/unit/book-row-field-coverage.test.tsx. Both approaches are available, and
// a pure data layer is still the better default for anything worth asserting
// field-by-field.

import type {
  ReconciliationFormat,
  ReconciliationLabels,
} from "@/components/Reconciliation";
import type { ReconciliationVerdict } from "@/lib/method/reconciliation";

/**
 * The subset of a `research_recommendations.picks[]` row the panel needs.
 * Kept narrow and inline (not imported from `app/book/page.tsx`) so the data
 * shape is visible at the call site and the lib does not pull in the page
 * module. The page constructs this from its own `Pick` interface.
 */
export interface WorkedExamplePick {
  asset: string;
  direction: "long" | "short";
  theme_id?: string | null;
  theme?: string;
  theme_name?: string;
  /** ADR-0078 \u2014 the 200-day-MA disqualifier row for this name. */
  ma_context?: {
    last: number;
    ma: number;
    pct_from_ma: number;
    window: number;
    observations: number;
  } | null;
}

/** One step in the lineage trail. */
export interface WorkedExampleStep {
  /** 1-indexed position in the chain. Rendered as a numeric span. */
  number: 1 | 2 | 3 | 4;
  /** Short title \u2014 "Raw ingestion", "Theme scoring", and so on. */
  title: string;
  /** Plain-English sentence rendered above the formula. */
  prose: string;
  /**
   * The rendered formula line \u2014 e.g. `Capex_Q3 = $3.2B`. When the underlying
   * column has no value for this position, this is the em-dash placeholder
   * (`"\u2014"`) and `formulaGap` carries the explainGap copy.
   */
  formula: string;
  /** Why the formula could not be rendered, when it could not. */
  formulaGap?: string;
  /**
   * Table.column the figure traces to. Stable across runs so a reader who
   * clicks through can find the value. Step 1's column is `illustrative` \u2014 the
   * lineage trail is not fully persisted yet; `sourcePersisted: false` and
   * `sourceGap` make that visible rather than fabricating a citation.
   */
  sourceColumn: string;
  /** Whether the column is populated for THIS position today. */
  sourcePersisted: boolean;
  /** Why the source is not persisted, when it is not. */
  sourceGap?: string;
  /**
   * Optional proof that this step's arithmetic reproduces the value the product
   * actually reads. A step that recomputes something persisted can show the gap;
   * a step that merely reports a stored figure has nothing to reconcile and
   * leaves this undefined.
   *
   * Present so a lineage step can carry the same Recomputed / Persisted / Δ claim
   * /method makes, rather than /method needing a shape this primitive cannot
   * express — which is what made an earlier attempt to share the primitive a
   * regression rather than a refactor.
   */
  reconciliation?: {
    verdict: ReconciliationVerdict;
    labels: ReconciliationLabels;
    format: ReconciliationFormat;
  };
}

/** The lineage panel as a whole, per position. */
export interface WorkedExample {
  position: { asset: string; direction: "long" | "short"; theme?: string };
  steps: WorkedExampleStep[];
}

/** Per-position scenario contribution \u2014 we want the *primary* one in the panel. */
export interface PrimaryScenarioInput {
  label: string;
  contribution: string | null;
}

/** Per-position sizing final \u2014 what the book actually holds. */
export interface SizingFinalInput {
  /** The final size as rendered on the page, e.g. `"0.066 (6.6%)"`. */
  display: string;
  /** `true` if the sizing was conviction-based; `false` if hype-sized fallback. */
  convictionBased: boolean;
}

/**
 * Picks the position the lineage panel renders for. ADR-0081 says:
 * "the position with the highest absolute EdgeScore, or the first-named long
 * if two tie." Picks with no EdgeScore at all drop to the bottom of the sort
 * so a run with no edge data still surfaces the first long rather than nothing.
 */
export function pickWorkedExamplePosition<
  T extends {
    asset: string;
    direction: "long" | "short";
    edge_score?: number | null;
  },
>(picks: T[]): T | null {
  if (picks.length === 0) return null;
  const scoreOf = (p: T): number =>
    typeof p.edge_score === "number" ? Math.abs(p.edge_score) : -Infinity;
  const sorted = [...picks].sort((a, b) => {
    const sb = scoreOf(b) - scoreOf(a);
    if (sb !== 0) return sb;
    // Tie-break: first long by source order, then anything else.
    if (a.direction !== b.direction) return a.direction === "long" ? -1 : 1;
    return 0;
  });
  return sorted[0];
}

/**
 * Builds the four-step lineage for the given position. The inputs are pre-computed
 * by the caller from data the page already loads \u2014 the function does not
 * reach into Supabase or into the themeEdge map. That keeps the data flow
 * obvious (every input is a column the page already reads) and keeps the test
 * surface small (a single object in, a structured object out).
 */
export function buildWorkedExample(input: {
  pick: WorkedExamplePick;
  /** The 200-day-MA context the disqualifier for this name came from. ADR-0078. */
  maContext: WorkedExamplePick["ma_context"];
  /** The persisted theme EdgeScore, or null when not computed for this theme. */
  themeScore: number | null;
  /** The final sizing line as rendered on /book today. */
  sizing: SizingFinalInput;
  /** The primary scenario contribution, parsed from contribution_breakdown. */
  primaryScenario: PrimaryScenarioInput | null;
}): WorkedExample {
  const { pick, maContext, themeScore, sizing, primaryScenario } = input;

  const steps: WorkedExampleStep[] = [
    {
      number: 1,
      title: "Raw ingestion",
      prose:
        "Filing parsed; a single key figure is extracted to anchor the theme scoring.",
      // Step 1 source column is not yet persisted. We render the ma_context
      // number in its place \u2014 a real persisted figure for this position \u2014 with
      // an honest explainGap that names the missing lineage column.
      formula: maContext
        ? `last = ${maContext.last.toFixed(2)}  // ${maContext.pct_from_ma.toFixed(1)}% from ${maContext.window}d MA`
        : "\u2014",
      formulaGap: maContext
        ? undefined
        : "Position has no ma_context row in portfolio_positions; the 200-day-MA disqualifier was not computed for this name (ADR-0078).",
      sourceColumn: "filings.xbrl_facts.concept_value",
      sourcePersisted: false,
      sourceGap:
        "Lineage trail is not yet persisted end-to-end. Step 1 currently borrows the ma_context row (portfolio_positions.ma_context) as the closest persisted figure for this position; the dedicated filings.xbrl_facts column lands in a follow-up ADR.",
    },
    {
      number: 2,
      title: "Theme scoring",
      prose:
        "LLM evaluation of the position filings against the theme vector, normalised to [0, 1].",
      formula:
        themeScore === null
          ? "\u2014"
          : `Theme_Score = ${themeScore.toFixed(2)}`,
      formulaGap:
        themeScore === null
          ? "research_recommendations.theme_edges has no row for this theme on the latest run_date; theme scoring did not produce a value."
          : undefined,
      sourceColumn: "research_recommendations.theme_edges.score",
      sourcePersisted: themeScore !== null,
      sourceGap:
        themeScore === null
          ? "Run the daily_refresh pipeline to populate theme_edges for this theme."
          : undefined,
    },
    {
      number: 3,
      title: "Position sizing",
      prose: sizing.convictionBased
        ? "Conviction \u00d7 inverse-vol, normalised across the book, clamped by single-name / sector / geo caps."
        : "HypeScore rank fallback (ADR-0053) \u2014 conviction was not persisted, so the size cannot be traced to an EdgeScore.",
      formula: sizing.display,
      formulaGap: sizing.convictionBased
        ? undefined
        : "The size below is hype-sized, not conviction-sized. The dedicated SizingChainView above already shows this with a warning banner; this step repeats it so the lineage is honest end-to-end.",
      sourceColumn: "portfolio_positions.weight",
      sourcePersisted: true,
    },
    {
      number: 4,
      title: "Risk attribution",
      prose: primaryScenario
        ? "Per-scenario contribution to book P&L for the position primary stress."
        : "No scenario_results row references this position in its contribution_breakdown.",
      formula: primaryScenario?.contribution ?? "\u2014",
      formulaGap: primaryScenario
        ? undefined
        : "scenario_results[].contribution_breakdown does not name this asset; the L1 pipeline produced no per-position line for this run.",
      sourceColumn:
        "research_recommendations.scenario_results[].contribution_breakdown",
      sourcePersisted: primaryScenario !== null,
      sourceGap: primaryScenario
        ? undefined
        : "Re-run the pipeline; the next run writes a per-position contribution line for every named asset in the book.",
    },
  ];

  return {
    position: {
      asset: pick.asset,
      direction: pick.direction,
      theme: pick.theme_name ?? pick.theme,
    },
    steps,
  };
}
