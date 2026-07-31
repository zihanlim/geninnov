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
  /**
   * The LAST line of the sizing chain as rendered on /book, e.g. `"$8.8M"`.
   *
   * The chain ends on the NOTIONAL, not on the weight (`buildSizingChain` pushes
   * final weight \u2192 signed weight \u2192 notional, and the caller hands over
   * `steps[steps.length - 1]`). Step 3's `sourceColumn` names the notional for
   * that reason. If a caller ever passes the weight line instead, the citation
   * has to move with it \u2014 ADR-0198 is the whole point.
   */
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
      // ADR-0198 \u2014 this step used to cite `filings.xbrl_facts.concept_value` and
      // describe a parsed 10-Q. Neither exists: there is no filings table in any
      // migration, and this pipeline ingests news headlines plus price/macro
      // series. Both came from the stitch comp ADR-0081 was triaged from, which
      // is the same import ADR-0083 caught inventing a Kelly formula one field
      // over. What the step actually renders is the ma_context row.
      title: "Raw ingestion",
      prose:
        "The name's last close against its 200-day mean \u2014 the raw price series the disqualifier reads (ADR-0078). Ingestion here is news headlines and price/macro series, not filings, so there is no document-level trail behind this figure and none is promised.",
      formula: maContext
        ? `last = ${maContext.last.toFixed(2)}  // ${maContext.pct_from_ma.toFixed(1)}% from ${maContext.window}d MA`
        : "\u2014",
      formulaGap: maContext
        ? undefined
        : "This position carries no ma_context on its picks[] row; the 200-day-MA disqualifier was not computed for this name (ADR-0078).",
      sourceColumn: "research_recommendations.picks[].ma_context",
      sourcePersisted: !!maContext,
      sourceGap: maContext
        ? undefined
        : "`finalise_book_analytics` writes ma_context per pick when the price fetch returns; the fetch is wrapped, so a failure costs this panel rather than the run. Re-run the pipeline.",
    },
    {
      number: 2,
      // ADR-0198 \u2014 `research_recommendations.theme_edges` is in no migration and
      // no backend module; the number below is read by `fetchThemeEdge` from
      // `theme_signals_history`. The prose was wrong in three further ways: no
      // LLM produces it, it is not computed over filings, and it is signed on
      // [-1, +1] rather than normalised to [0, 1] \u2014 `edge_direction` reads its
      // sign to choose long / short / abstain.
      title: "Theme scoring",
      prose:
        "The theme's EdgeScore: a weighted mean of trend, regime, carry, value and sentiment, renormalised over the components that actually exist (ADR-0036). Deterministic and signed on [-1, +1] \u2014 its sign is the side.",
      formula:
        themeScore === null
          ? "\u2014"
          : `EdgeScore = ${themeScore.toFixed(2)}`,
      formulaGap:
        themeScore === null
          ? "theme_signals_history carries no row with an edge_score for this theme; theme scoring did not produce a value."
          : undefined,
      sourceColumn: "theme_signals_history.edge_score",
      sourcePersisted: themeScore !== null,
      sourceGap:
        themeScore === null
          ? "Run scripts/daily_refresh.py \u2014 the L1/L4 stage writes edge_score per theme per run_date."
          : undefined,
    },
    {
      number: 3,
      // ADR-0198 \u2014 `portfolio_positions.weight` is a real column, but it is not
      // this figure's. The caller hands over the sizing chain's LAST step, which
      // is the notional, and every input to that chain comes off the published
      // pick. A citation to the held book under a figure read from the published
      // one is the failure ADR-0040 already paid for once.
      title: "Position sizing",
      prose: sizing.convictionBased
        ? "Conviction \u00d7 inverse-vol, normalised across the book and clamped by the single-name / sector / geo caps, then struck against the book's capital as a dollar notional \u2014 the figure below is that last line."
        : "HypeScore rank fallback (ADR-0053) \u2014 conviction was not persisted, so the size cannot be traced to an EdgeScore.",
      formula: sizing.display,
      formulaGap: sizing.convictionBased
        ? undefined
        : "The size below is hype-sized, not conviction-sized. The dedicated SizingChainView above already shows this with a warning banner; this step repeats it so the lineage is honest end-to-end.",
      sourceColumn: "research_recommendations.picks[].notional",
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
