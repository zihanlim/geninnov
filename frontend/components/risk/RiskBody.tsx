// frontend/components/risk/RiskBody.tsx
//
// L6 risk surface, filtered by PHASE.
//
// ONE body, ONE fetch — /mandate, /risk and /attribution all render this
// component and pick their sections with `phaseShows`. That mirrors MethodBody
// (ADR-0084) deliberately: three routes with their own useEffects are three
// chances to describe different vintages of the same run, which is the
// contradiction ADR-0040 closed and ADR-0084 refused to reopen. The knowingly
// accepted cost is that each phase route fires every query, including those for
// sections it does not render.
//
// L6 risk surface. Everything on this page is read from what the pipeline
// actually persisted — the L5 book analytics on `research_recommendations`
// (migration 022), the L4 metrics on `portfolio_risk`, and the return series on
// `portfolio_returns`. No section synthesises a value it could not read.
//
// Two deliberate departures from /portfolio:
//   1. Every query's `error` is captured and rendered. Rendering `?? []` over a
//      rejected select is how three production defects stayed invisible.
//   2. The risk metric grid always renders. A grid that disappears when its row
//      is missing looks like an absence of risk rather than an absence of data.
//
// THE LENS (`?lens=credit`) — /mandate and /risk only
// ---------------------------------------------------
// Migration 062 re-keyed `research_recommendations` on (run_date, lens), so one
// run_date now carries both the multi-asset book and the credit-lens book. The
// two reads of that table below follow the lens the URL asks for, resolved by
// exactly the plumbing /book uses. The other ~10 reads CANNOT: migration 062
// deliberately gave no lens column to `portfolio_risk`, `portfolio_returns`,
// `portfolio_positions`, `portfolio_cumulative_return`,
// `book_holdings_performance`, `pick_outcomes` or `benchmark_returns` —
// ADR-0194, because a second book must not write into the first book's record.
//
// That split is the whole hazard, and it is why this is not a one-line change.
// Swap the lens with nothing said on screen and a reader gets the credit book's
// stress table beside the multi-asset book's VaR headline and drawdown curve:
// ADR-0084's failure — one page describing two books — and strictly worse than
// the honest hardcoded pin it replaces. So `lib/risk/lensScope.ts` owns the
// boundary, `components/risk/LensScope.tsx` states it, and every figure sourced
// from a lens-less table is marked whenever the active lens is not multi_asset.
//
// UNDER THE DEFAULT LENS NOTHING HERE RENDERS. `resolveLens(null, …)` is
// multi_asset, `showScopeNote` returns false for every panel at multi_asset,
// and both LensScope exports return null there as well — so a URL with no
// `?lens=` produces the same two queries and the same markup as the version
// before any of this existed. The one visible addition is the selector itself,
// and only on a day when a second lens actually published a book: a feature
// with no control is not reachable, and a control that can offer nothing is not
// rendered.

"use client";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import LensSelector, { type Lens } from "@/components/LensSelector";
import { resolveLens } from "@/lib/book/lensView";
// DEFAULT_LENS comes from lensProbe, which re-exports lensView's own binding.
// Same value, one import: the fallback a caller reaches for when discovery
// returns an empty lens list arrives beside the list it is a fallback for.
import { DEFAULT_LENS, fetchLensesForLatestRun } from "@/lib/book/lensProbe";
import { LensScopeBanner, LensScopeChip } from "@/components/risk/LensScope";
// `panelLabel` is deliberately NOT imported: this file passes panel KEYS to the
// banner, which needs each panel's scope as well as its name and resolves both
// from the one module that knows them.
import { lensLessPanels, showScopeNote } from "@/lib/risk/lensScope";
import { StressScenarios } from "@/components/risk/StressScenarios";
import { PositioningCrowding } from "@/components/risk/PositioningCrowding";
import { SanctionsExposure } from "@/components/risk/SanctionsExposure";
import { CorrelationMatrix } from "@/components/risk/CorrelationMatrix";
import { CapUtilisation } from "@/components/risk/CapUtilisation";
import { BookFactorTilt } from "@/components/risk/BookFactorTilt";
import { RiskMetricsGrid } from "@/components/risk/RiskMetricsGrid";
import VarMethods from "@/components/risk/VarMethods";
import BenchmarkComparison from "@/components/risk/BenchmarkComparison";
import WeightsBacktest from "@/components/risk/WeightsBacktest";
import {
  DrawdownChart,
  type BenchmarkRow,
  type InceptionRow,
} from "@/components/risk/DrawdownChart";
import { SourceCaveat } from "@/components/status/SourceCaveat";
import { DailyPLHistory } from "@/components/portfolio/DailyPLHistory";
import { RiskLimitBoard } from "@/components/risk/RiskLimitBoard";
import { MandatePanel } from "@/components/risk/MandatePanel";
import { CostDrag, type HoldingsPerformanceRow } from "@/components/risk/CostDrag";
import { ENFORCED } from "@/lib/mandate";
import { PositionRiskAttribution } from "@/components/risk/PositionRiskAttribution";
import { AttentionCrowding } from "@/components/risk/AttentionCrowding";
import {
  PositionRiskScatter,
  RiskContributionWaterfall,
  SCATTER_MIN_POINTS,
  positionRiskScatterPoints,
} from "@/components/risk/RiskCharts";
import { reconcileToBook } from "@/lib/risk/bookOfRecord";
import { WhatIfScenario } from "@/components/risk/WhatIfScenario";
import { Ident } from "@/components/risk/SectionGap";
import {
  classify,
  isNum,
  buildDrawdownSeries,
  type AnalyticsSource,
  type BookMetrics,
  type CapUtilisation as CapUtilisationData,
  type CorrelationPair,
  type QueryFailure,
  type ResearchAnalyticsRow,
  type ReturnRow,
  type RiskRow,
  type ScenarioResult,
  type PositioningCrowdingRow,
  type SanctionsExposureRow,
} from "@/lib/risk/analytics";
import {
  buildLimitBoard,
  buildPositionAttribution,
  buildCrowding,
  computeRiskDeltas,
  configMap,
  factorsByAsset,
  type ConfigRow,
  type CrowdingHistoryLite,
  type FactorExposureRow,
  type LimitBoardInputs,
  type PositionRow,
} from "@/lib/risk/riskBoard";
import { fetchThemeHistories } from "@/lib/themeSignals";
import SectionNav from "@/components/SectionNav";
import AnswerRow from "@/components/AnswerRow";
import PageHeader from "@/components/PageHeader";
import { riskAnswerCards } from "@/components/risk/RiskAnswerCards";
import { mandateAnswerCards } from "@/components/risk/MandateAnswerCards";
import { attributionAnswerCards } from "@/components/risk/AttributionAnswerCards";
import TrackRecord from "@/components/method/TrackRecord";
import { buildTrackRecord, type PickOutcomeRow } from "@/lib/method/trackRecord";
import {
  PHASE_SECTION_NAV,
  phaseShows,
  type RiskPhase,
} from "@/lib/method/phaseSections";

/** Title and lede per phase route. The section nav below them comes from
 *  PHASE_SECTION_NAV, so the tabs and the sections rendered cannot disagree. */
const PHASE_COPY: Record<RiskPhase, { title: string; lede: string }> = {
  mandate: {
    title: "Mandate & Limits",
    lede:
      "What this book is allowed to be, where each constraint came from, and " +
      "whether the published book sits inside it. The limits below are read from " +
      "scoring_config where one exists and named as a code default where it does " +
      "not — a cap with no traceable source says so rather than looking chosen.",
  },
  risk: {
    title: "Risk & Scenario",
    lede:
      "What could go wrong, how much it would cost, and where the damage is " +
      "concentrated. Six calibrated shocks worst-first, per-position risk " +
      "attribution, correlation and attention crowding, and factor tilt. Every " +
      "figure here is EX-ANTE: it is a pure function of the recommended weights " +
      "and a 252-day covariance estimate, so it answers what this book would risk " +
      "if held, not what running the strategy has cost. Cap headroom moved to " +
      "Mandate, which is where the limits it measures against live. Persisted " +
      "figures are read from pipeline artefacts; the what-if is a browser-side " +
      "estimate, labelled as one.",
  },
  attribution: {
    title: "Attribution & Feedback",
    lede:
      "What the book actually did — the five headline risk statistics, the " +
      "forward record of published picks, realised drawdown and the return path, " +
      "against the ex-ante figures the phases above produced. This is the only " +
      "surface here that is backward-looking.",
  },
};

/**
 * Which gate puts each `PANEL_SCOPE` panel on screen.
 *
 * `lensLessPanels()` names every panel in this tree that cannot follow the
 * lens; the page banner must name only the ones the reader is actually looking
 * at. Naming the drawdown chart on /mandate — which does not render it — would
 * teach the boundary in the wrong shape, and a disclosure a reader can falsify
 * by scrolling is worse than no disclosure.
 *
 * This map lives HERE and not in `lib/risk/lensScope.ts` on purpose. It states
 * a fact about THIS FILE's markup (which section a panel sits in); lensScope
 * states a fact about the database (which tables a panel reads). They rot at
 * different rates and for different reasons, so they do not share a home.
 *
 * Values are either a section id for `phaseShows`, `PANEL_EVERY_PHASE` for page
 * chrome, or `phase:<name>` for the three answer rows, which are gated on the
 * phase directly rather than on a section id.
 */
const PANEL_EVERY_PHASE = "*";
const PANEL_SECTION: Record<string, string> = {
  // Page chrome — every phase renders these.
  PageHeader: PANEL_EVERY_PHASE,
  ReconciliationBanner: PANEL_EVERY_PHASE,
  ReadErrorsBanner: PANEL_EVERY_PHASE,
  SectionNav: PANEL_EVERY_PHASE,
  // Answer rows — one per phase route.
  MandateAnswerRow: "phase:mandate",
  RiskAnswerRow: "phase:risk",
  AttributionAnswerRow: "phase:attribution",
  // Phase 1 — mandate & limits.
  MandatePanel: "mandate",
  RiskLimitBoard: "limits",
  CapUtilisation: "limits",
  // Phase 2 — risk & scenario.
  StressScenarios: "stress",
  WhatIfScenario: "stress",
  SanctionsExposure: "stress",
  PositioningCrowding: "stress",
  VarMethods: "var-methods",
  PositionRiskScatter: "attribution",
  RiskContributionWaterfall: "attribution",
  PositionRiskAttribution: "attribution",
  AttentionCrowding: "attribution",
  CorrelationMatrix: "concentration",
  BookFactorTilt: "exposure",
  // Phase 3 — attribution & feedback. Pinned to multi_asset (see `lensEnabled`),
  // so in practice nothing below is ever named or chipped; classified anyway so
  // the map does not have a hole where a phase used to be.
  RiskMetricsGrid: "realised",
  TrackRecord: "realised",
  BenchmarkComparison: "realised",
  WeightsBacktest: "realised",
  InceptionCaveat: "realised",
  CostDrag: "realised",
  DrawdownChart: "realised",
  DailyPLHistory: "realised",
};

const ANALYTICS_COLUMNS =
  // picks: the published book, so this page can check that the positions it computes
  // risk on are the names the book actually holds (ADR-0040).
  // optimizer_result: ADR-0173's realised_turnover / turnover_cap for the mandate
  // limit board, and cov_shrinkage_intensity for the Risk answer row's disclosure.
  "run_date, lens, scenario_results, correlation_pairs, cap_utilisation, book_metrics, picks, sanctions_exposure, positioning_crowding, risk_decomposition, monte_carlo_var, var_forecast, weights_backtest, optimizer_result";
const BASE_COLUMNS = "run_date, lens";
const RISK_COLUMNS =
  "run_date, updated_at, total_capital, var_95, cvar_95, sharpe, beta, concentration_hhi, numeric_derivations, var_95_historical, es_95_historical, sortino, max_drawdown, calmar, tracking_error, information_ratio, benchmark_comparison, conditional_vol";
const RETURN_COLUMNS = "run_date, daily_return, cumulative_return, portfolio_value";
const POSITION_COLUMNS =
  "id, theme_id, asset, direction, notional, weight, hype_score, trade_score, edge_score, trend_signal, regime_bias, carry_signal, value_signal, sentiment_signal, conviction, vol";
const FACTOR_COLUMNS =
  "asset, run_date, beta_mkt, beta_smb, beta_hml, beta_rmw, beta_cma, beta_umd, r_squared";

interface PostgrestLikeError {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
}

function toFailure(
  table: string,
  columns: string,
  error: PostgrestLikeError | null,
): QueryFailure | null {
  if (!error) return null;
  return {
    table,
    columns,
    message: error.message ?? "unknown error",
    code: error.code,
    details: error.details,
    hint: error.hint,
  };
}

interface PageData {
  loading: boolean;
  /** Failure of the migration-022 analytics select. */
  analyticsFailure: QueryFailure | null;
  /** Failure of the minimal `research_recommendations` probe. */
  baseFailure: QueryFailure | null;
  analyticsRow: ResearchAnalyticsRow | null;
  rowExists: boolean;
  runDate: string | null;
  /** The lens the returned row CLAIMS, read back from `research_recommendations`. */
  lens: string | null;
  /**
   * The lens the page QUERIED. Kept apart from `lens` above deliberately: one is
   * the request, the other is the row's own answer, and if they ever disagree
   * that is a real defect rather than a display quirk. `lens` is what the header
   * reports (it is what the data says it is); `resolvedLens` is what every scope
   * disclosure below is derived from, because a banner has to describe the query
   * that produced the page even on the run where the row came back mislabelled.
   *
   * Set with the rest of the payload rather than early, so the disclosures move
   * in lockstep with the figures they describe — a banner that flips a beat
   * before the panels beneath it is a banner describing the previous book.
   */
  resolvedLens: Lens;
  risk: RiskRow | null;
  /** The two most recent risk rows (newest-first) for prior-run deltas. */
  riskRows: RiskRow[];
  riskFailure: QueryFailure | null;
  riskOrderingNote: string | null;
  returns: ReturnRow[];
  returnsFailure: QueryFailure | null;
  /** Latest persisted since-inception row (portfolio_cumulative_return). */
  inception: InceptionRow | null;
  /** The held book's cost-netted series (m056 / ADR-0150), for the comparison. */
  holdings: HoldingsPerformanceRow[];
  /**
   * The MULTI-ASSET book's pick list, whatever lens the page is on.
   *
   * Only ADR-0040's reconciliation check reads this, and it needs the
   * multi-asset one specifically: the other side of that comparison is
   * `portfolio_positions`, which has no lens column (ADR-0194). Kept apart from
   * `analyticsRow.picks` — the ACTIVE lens's picks — because collapsing the two
   * is precisely what made the check cross-book under a lens.
   */
  defaultLensPicks: ResearchAnalyticsRow["picks"];
  /** pick_outcomes at the 21-day horizon; null when the read failed. */
  outcomeRows: PickOutcomeRow[] | null;
  /** Reference series for the realised curve (ADR-0094). */
  benchmark: BenchmarkRow[];
  // ── Actionable-risk inputs ──────────────────────────────────────────────
  positions: PositionRow[];
  positionsFailure: string | null;
  factors: FactorExposureRow[];
  factorsFailure: string | null;
  config: ConfigRow[];
  themeNames: Record<string, string>;
  crowding: Record<string, CrowdingHistoryLite>;
  crowdingFailure: string | null;
}

const INITIAL: PageData = {
  loading: true,
  analyticsFailure: null,
  baseFailure: null,
  analyticsRow: null,
  rowExists: false,
  runDate: null,
  lens: null,
  // DEFAULT_LENS, not the URL's value: the first paint of a `?lens=credit` page
  // has read nothing yet, so it must not yet claim to be showing the credit
  // book. The banner appears with the credit figures, not ahead of them.
  resolvedLens: DEFAULT_LENS,
  risk: null,
  riskRows: [],
  riskFailure: null,
  riskOrderingNote: null,
  returns: [],
  returnsFailure: null,
  inception: null,
  holdings: [],
  defaultLensPicks: null,
  outcomeRows: null,
  benchmark: [],
  positions: [],
  positionsFailure: null,
  factors: [],
  factorsFailure: null,
  config: [],
  themeNames: {},
  crowding: {},
  crowdingFailure: null,
};

/**
 * A panel's "still the multi-asset book" marker, or nothing at all.
 *
 * One line at a call site, and the gate cannot be forgotten: `showScopeNote`
 * returns false for EVERY panel at multi_asset, so under the default lens this
 * renders null and the extra DOM node never reaches the eight cards that would
 * otherwise carry one. (`LensScopeChip` re-checks the lens itself; that is its
 * own invariant, not a reason to skip this one.)
 *
 * Left-aligned rather than right. `PositionRiskScatter`'s marker sits above a
 * two-column grid whose FIRST cell is the panel being marked, so a left edge
 * puts the chip over the card it describes at every breakpoint; right-aligned
 * it would float above the waterfall beside it, which has a different scope and
 * needs no marker at all.
 */
function ScopeNote({ lens, panel }: { lens: string; panel: string }) {
  if (!showScopeNote(lens, panel)) return null;
  return (
    <div className="mb-1.5">
      <LensScopeChip lens={lens} panel={panel} />
    </div>
  );
}

export default function RiskBody({ phase }: { phase: RiskPhase }) {
  return (
    <Suspense
      fallback={
        <main className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 wide:px-5 pt-7 pb-20">
          <div className="skeleton h-[180px]" />
        </main>
      }
    >
      <RiskPageInner phase={phase} />
    </Suspense>
  );
}

function RiskPageInner({ phase }: { phase: RiskPhase }) {
  const shows = (id: string) => phaseShows(phase, id);
  const [data, setData] = useState<PageData>(INITIAL);

  // ── Lens (?lens=credit) ──────────────────────────────────────────────────
  // /mandate and /risk get the same lens control /book has. /attribution does
  // NOT, and that is a decision rather than an omission.
  //
  // Phase 6's question is "was the thesis right?", and it is answered from
  // `pick_outcomes` (the forward record of published picks) and
  // `book_holdings_performance` (the held book's cost-netted series). Migration
  // 062 gave neither table a lens column, per ADR-0194: a second book must not
  // write into the first book's record. There is one realised return series and
  // one forward track record, and both belong to the multi-asset book that has
  // published every day since inception.
  //
  // So a lens control on /attribution could not change a single figure on the
  // page. It could only put the word "credit" above the multi-asset book's
  // record — a relabelling, which is worse than not offering the control at
  // all: it would manufacture a track record for a book that has none. The
  // phase is pinned, the selector is not rendered, and both reads below use
  // multi_asset. The header says so on screen (see `fine` in PageHeader) on any
  // day a second lens exists to be confused with.
  const lensEnabled = phase !== "attribution";

  // Selection lives in the URL, exactly as on /book: a reviewer must be able to
  // send someone /risk?lens=credit and have them land on the same page.
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestedLens = searchParams.get("lens");

  // What the toggle may offer. Starts as just the default so the control does
  // not flash a six-lens picker before discovery answers; narrowed to whatever
  // `research_recommendations` actually holds for today's run_date.
  const [lensOffered, setLensOffered] = useState<Lens[]>([DEFAULT_LENS]);

  // The control's own value, computed from the URL rather than held in state so
  // a click is reflected the instant `router.push` lands, without waiting for
  // the refetch it triggers. `data.resolvedLens` — set only when the new rows
  // arrive — is what the DISCLOSURES read, so during that window the control
  // shows where the reader is going and the banner still describes what is on
  // screen. Both are right; they are answering different questions.
  const controlLens = lensEnabled
    ? resolveLens(requestedLens, lensOffered)
    : DEFAULT_LENS;

  const setLens = useCallback(
    (next: Lens) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === DEFAULT_LENS) params.delete("lens");
      else params.set("lens", next);
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  useEffect(() => {
    let cancelled = false;

    // Back into the loading state BEFORE anything is fetched — the same
    // `setLoading(true); load();` BookBody does, for the same reason.
    //
    // Without it a lens change is silent for the whole round trip.
    // `controlLens` is computed from the URL, so the segmented control reads
    // "Credit Lens" the instant `router.push` lands, while `data` still holds
    // the multi-asset payload: `loading` false and `resolvedLens` multi_asset,
    // which is exactly the pair that makes `LensScopeBanner` and every
    // `ScopeNote` return null. For the probe + the twelve-query Promise.all +
    // fetchThemeHistories the reader would get the PREVIOUS book's stress
    // matrix, correlation matrix and four-way VaR under a control naming the
    // new one, with no skeleton, no dimming and the disclosure machinery
    // switched off precisely because it is derived from the stale payload.
    // That is ADR-0084's "one page, two books" with the disclosures disabled —
    // worse than the failure on its own.
    //
    // The WHOLE payload, not just `loading`. Several panels read
    // `data.analyticsRow` directly rather than through `classify`: the VaR
    // comparison's three lens-following methods, the risk-contribution
    // waterfall, cap headroom's complex sizing, the weights backtest, the limit
    // board's realised turnover. A `loading` flag they never receive would
    // leave the old book's figures drawn between the skeletons of the ones that
    // do. INITIAL is the very object `useState` mounted with, so on the first
    // run React compares by identity and bails out — the default page still
    // renders exactly once.
    setData(INITIAL);

    (async () => {
      // Which lens to query, resolved BEFORE anything else is fetched. Migration
      // 062 keyed research_recommendations on (run_date, lens), so a run_date can
      // carry more than one book and an unfiltered read returns whichever of them
      // Postgres orders first. `fetchLensesForLatestRun` is the one deliberately
      // lens-unqualified read in the tree — it asks which books exist rather than
      // fetching one — and `resolveLens` then honours `?lens=` only when that lens
      // published a book today, so a stale link lands on the default book instead
      // of an empty page.
      //
      // AWAITED ON /mandate AND /risk, NOT ON /attribution, and the asymmetry is
      // the point. This probe sits in front of the twelve-query Promise.all
      // below, so every page that awaits it pays a full extra round trip before
      // its first byte of data is even requested. Two of the three pages have to:
      // `resolved` is what their two `research_recommendations` reads are keyed
      // by, and reading the wrong book is worse than reading it late.
      //
      // /attribution does not. It is pinned to multi_asset (`lensEnabled` is
      // false), so `resolved` is a constant there and the probe's ONLY consumer
      // is the one tertiary sentence in the header telling a reader who arrived
      // from /risk?lens=credit that this record is the multi-asset book's. That
      // sentence is worth saying; it is not worth delaying every figure on the
      // page to say it. So the probe is started and left to land on its own, and
      // the sentence appears when it does.
      const probe = fetchLensesForLatestRun();
      let resolved: Lens = DEFAULT_LENS;
      let offered: Lens[] = [DEFAULT_LENS];
      if (lensEnabled) {
        const { lenses } = await probe;
        offered = lenses.length ? lenses : [DEFAULT_LENS];
        resolved = resolveLens(requestedLens, offered);
        if (cancelled) return;
        // NOT `setLensOffered` here, one round trip ahead of the payload: that
        // is what made the selector pop in against a page of skeletons and push
        // the whole body down ~54px on its own. It is set with `setData` below
        // instead, so the control and the figures it labels arrive in the same
        // commit and the reader sees ONE settle rather than two.
      } else {
        probe
          .then(({ lenses }) => {
            if (!cancelled && lenses.length) setLensOffered(lenses);
          })
          // A failed probe on /attribution costs the disambiguating sentence and
          // nothing else. The page is pinned either way, so there is no wrong
          // book to land on and nothing to report to the reader.
          .catch(() => {});
      }

      const [
        analyticsRes,
        baseRes,
        riskRes,
        returnsRes,
        positionsRes,
        factorsRes,
        configRes,
        themesRes,
        inceptionRes,
        benchmarkRes,
        holdingsRes,
        outcomesRes,
        defaultPicksRes,
      ] = await Promise.all([
        // Migration 062 keyed this table on (run_date, lens): a run_date can now
        // carry both the multi-asset and the credit-lens book. These two reads
        // FOLLOW THE LENS the reader asked for — `resolved` above — while the ~10
        // reads below them cannot, because migration 062 deliberately gave those
        // tables no lens column (ADR-0194: a second book must not write into the
        // first book's record). That asymmetry is disclosed on screen rather than
        // hidden; see the LensScopeBanner and the per-panel chips.
        //
        // /attribution is the exception and stays pinned: `resolved` is forced to
        // multi_asset there, because its question is answered entirely from the
        // lens-less tables and a credit label over them would be a fabricated
        // record rather than a filtered one.
        //
        // Either way the filter stays EXPLICIT. An unfiltered read here looks
        // exactly like the single-book code that was correct for years and
        // silently returns whichever of today's two books Postgres orders first.
        supabase
          .from("research_recommendations")
          .select(ANALYTICS_COLUMNS)
          .eq("lens", resolved)
          .order("run_date", { ascending: false })
          .limit(1),
        // Minimal probe: succeeds even when the migration-022 columns are absent,
        // which is what lets the UI tell "no run yet" apart from "column missing".
        // Same lens as the analytics read above, so the two cannot disagree about
        // which book the page is describing.
        supabase
          .from("research_recommendations")
          .select(BASE_COLUMNS)
          .eq("lens", resolved)
          .order("run_date", { ascending: false })
          .limit(1),
        // Two rows: the latest metrics and the prior run for signed deltas.
        supabase
          .from("portfolio_risk")
          .select(RISK_COLUMNS)
          .order("run_date", { ascending: false })
          .limit(2),
        supabase
          .from("portfolio_returns")
          .select(RETURN_COLUMNS)
          .order("run_date", { ascending: true }),
        supabase
          .from("portfolio_positions")
          .select(POSITION_COLUMNS)
          .order("notional", { ascending: false }),
        // Newest factor rows across assets; factorsByAsset keeps the first per asset.
        supabase
          .from("factor_exposures")
          .select(FACTOR_COLUMNS)
          .order("run_date", { ascending: false })
          .limit(2000),
        supabase.from("scoring_config").select("param_name, value"),
        supabase.from("themes").select("id, name"),
        // L4's authoritative since-inception return, read rather than re-derived
        // from the daily series (DrawdownChart reconciles the two).
        supabase
          .from("portfolio_cumulative_return")
          .select("as_of, inception_date, cumulative_value, daily_returns_count, compounded")
          .order("as_of", { ascending: false })
          .limit(1),
        // The reference series (ADR-0094, migration 045). Read alongside the
        // book's own returns so the chart can decide whether a comparison is
        // meaningful yet; at fewer than BENCHMARK_MIN_OBS usable points it
        // states the count instead of drawing two noise curves on one axis.
        supabase
          .from("benchmark_returns")
          .select("run_date, ticker, daily_return, cumulative_return, inception_date")
          .order("run_date")
          .limit(2000),
        // The held book's cost-netted series (m056 / ADR-0150). Read beside the
        // published one rather than instead of it: the two are compared and the
        // difference is the finding, so replacing one with the other would be the
        // quiet correction ADR-0093 exists to prevent.
        supabase
          .from("book_holdings_performance")
          .select("run_date, turnover, cost_pct, cost_usd, gross_return, net_return, nav, tracking_error")
          .order("run_date")
          .limit(2000),
        // The forward record (ADR-0090), read HERE rather than by `TrackRecord`
        // itself. ADR-0172 moved that panel to /attribution, where the answer row
        // needs the same counts — two reads of pick_outcomes on one page is the
        // "two vintages of one run" failure, and the card and the panel could
        // disagree about the hit count 400px apart. One string literal, not a
        // concatenation: supabase-js infers the row type from the select text.
        supabase
          .from("pick_outcomes")
          .select("run_date, asset, direction, horizon_days, verdict, void_reason, signed_return, entry_date, exit_date, expected_exit_date, spec_version")
          .eq("horizon_days", 21)
          .order("run_date", { ascending: false })
          .limit(1000),
        // The MULTI-ASSET book's pick list, pinned — the one read on this page
        // that deliberately ignores `resolved`.
        //
        // ADR-0040's provisional-positions check compares `portfolio_positions`
        // against a pick list, and `portfolio_positions` has no lens column
        // (ADR-0194): it is always the multi-asset book. Comparing it to the
        // ACTIVE lens's picks is therefore cross-book, reads "unreconciled" on
        // every credit run, and the first answer to that was to suppress the
        // alert under a non-default lens — which threw away the real mid-run
        // warning along with the false one. The pipeline writes L1's full
        // candidate set here at 21:30 and reconciles it to the picked book only
        // when L5 returns, so in that window /risk?lens=credit showed ~60
        // candidate names under chips positively asserting they ARE the
        // multi-asset published book. Pinning the pick side makes the
        // comparison same-book, so the alert renders under every lens and says
        // something true.
        //
        // Skipped entirely under the default lens: `analyticsRes` above already
        // IS this read there, so the default page fires the same twelve queries
        // it fired before, in the same order.
        resolved === DEFAULT_LENS
          ? Promise.resolve(null)
          : supabase
              .from("research_recommendations")
              .select("run_date, picks")
              .eq("lens", DEFAULT_LENS)
              .order("run_date", { ascending: false })
              .limit(1),
      ]);

      // portfolio_risk.run_date only exists from migration 016. If ordering by it
      // is rejected, fall back to updated_at and say so rather than showing nothing.
      let riskRows: RiskRow[] = (riskRes.data as RiskRow[] | null) ?? [];
      let riskFailure = toFailure(
        "portfolio_risk",
        RISK_COLUMNS,
        riskRes.error as PostgrestLikeError | null,
      );
      let riskOrderingNote: string | null = null;

      if (riskRes.error) {
        const fallback = await supabase
          .from("portfolio_risk")
          .select("*")
          .order("updated_at", { ascending: false })
          .limit(2);
        if (!fallback.error) {
          riskRows = (fallback.data as RiskRow[] | null) ?? [];
          riskFailure = null;
          riskOrderingNote =
            `portfolio_risk could not be read as requested (${riskRes.error.code ?? "error"}: ` +
            `${riskRes.error.message}). Showing the most recent row ordered by updated_at instead — ` +
            `apply supabase/migrations/016_portfolio_risk_run_date.sql to restore run_date ordering.`;
        }
      }
      const risk: RiskRow | null = riskRows[0] ?? null;

      const baseRow = baseRes.data?.[0] as
        | { run_date: string | null; lens: string | null }
        | undefined;
      const analyticsRow =
        (analyticsRes.data?.[0] as ResearchAnalyticsRow | undefined) ?? null;

      // Under the default lens the pinned read was skipped, because the
      // analytics row above already is it. One expression, so "which picks does
      // the reconciliation check use" has a single answer on every path.
      const defaultLensPicks: ResearchAnalyticsRow["picks"] =
        resolved === DEFAULT_LENS
          ? (analyticsRow?.picks ?? null)
          : ((defaultPicksRes?.data?.[0] as
              | { picks?: ResearchAnalyticsRow["picks"] }
              | undefined)?.picks ?? null);

      const positions = (positionsRes.data as PositionRow[] | null) ?? [];
      const themeNames: Record<string, string> = {};
      for (const t of (themesRes.data as { id: string; name: string }[] | null) ?? []) {
        if (t.id) themeNames[t.id] = t.name;
      }

      // Attention-crowding histories, keyed by the theme_ids the book holds. Only
      // themes present in the sized book matter for the positioning join.
      const bookThemeIds = Array.from(
        new Set(positions.map((p) => p.theme_id).filter((id): id is string => Boolean(id))),
      );
      let crowding: Record<string, CrowdingHistoryLite> = {};
      let crowdingFailure: string | null = null;
      if (bookThemeIds.length > 0) {
        const hist = await fetchThemeHistories(bookThemeIds);
        crowdingFailure = hist.error;
        crowding = Object.fromEntries(
          Object.entries(hist.byTheme).map(([id, h]) => [
            id,
            { percentile: h.percentile, delta1d: h.delta1d, nObs: h.hypeSeries.length },
          ]),
        );
      }

      if (cancelled) return;
      // The selector's options land HERE, in the same commit as the payload they
      // label — not back at the probe, one round trip earlier. React batches the
      // two setStates, so on /mandate and /risk the control appears at the same
      // instant the skeletons become figures: one layout settle instead of a
      // selector row shoving a page of skeletons down and the figures arriving
      // after. On /attribution this is a no-op (the probe sets it on its own,
      // late and unblocking, because nothing on that page waits for it).
      if (lensEnabled) setLensOffered(offered);
      setData({
        loading: false,
        analyticsFailure: toFailure(
          "research_recommendations",
          ANALYTICS_COLUMNS,
          analyticsRes.error as PostgrestLikeError | null,
        ),
        baseFailure: toFailure(
          "research_recommendations",
          BASE_COLUMNS,
          baseRes.error as PostgrestLikeError | null,
        ),
        analyticsRow,
        rowExists: Boolean(analyticsRow) || Boolean(baseRow),
        runDate: analyticsRow?.run_date ?? baseRow?.run_date ?? null,
        lens: analyticsRow?.lens ?? baseRow?.lens ?? null,
        resolvedLens: resolved,
        risk,
        riskRows,
        riskFailure,
        riskOrderingNote,
        returns: (returnsRes.data as ReturnRow[] | null) ?? [],
        inception:
          ((inceptionRes.data as InceptionRow[] | null) ?? [])[0] ?? null,
        // Missing table (pre-043) is not an error worth surfacing: the chart's
        // gate already explains an absent comparison, and an empty array walks
        // straight into it.
        benchmark: (benchmarkRes.data as BenchmarkRow[] | null) ?? [],
        // Absent until migration 056 is applied and the held book has run; the
        // panel renders nothing rather than an empty frame in that case.
        holdings: (holdingsRes.data as HoldingsPerformanceRow[] | null) ?? [],
        defaultLensPicks,
        outcomeRows: outcomesRes.error
          ? null
          : ((outcomesRes.data as PickOutcomeRow[] | null) ?? []),
        returnsFailure: toFailure(
          "portfolio_returns",
          RETURN_COLUMNS,
          returnsRes.error as PostgrestLikeError | null,
        ),
        positions,
        positionsFailure: positionsRes.error?.message ?? null,
        factors: (factorsRes.data as FactorExposureRow[] | null) ?? [],
        factorsFailure: factorsRes.error?.message ?? null,
        config: (configRes.data as ConfigRow[] | null) ?? [],
        themeNames,
        crowding,
        crowdingFailure,
      });
    })();

    return () => {
      cancelled = true;
    };
    // `requestedLens`, not the resolved lens: the resolved value is computed
    // INSIDE this effect, so depending on it would be depending on its own
    // output. requestedLens is the URL's raw ?lens= value — the actual external
    // input — and it is `null` on every page with no lens in the URL, so the
    // default path re-runs exactly as often as the old `[]` deps did: once.
    // `lensEnabled` is a function of the `phase` prop and never changes for a
    // mounted route; it is listed because it is read here, not because it moves.
  }, [requestedLens, lensEnabled]);

  const source: AnalyticsSource = useMemo(
    () => ({
      loading: data.loading,
      failure: data.analyticsFailure ?? data.baseFailure,
      rowExists: data.rowExists,
      runDate: data.runDate,
      row: data.analyticsRow,
    }),
    [data],
  );

  const scenarioState = useMemo(
    () =>
      classify<ScenarioResult[]>(
        source,
        (row) => row.scenario_results,
        (v) => !Array.isArray(v) || v.length === 0,
      ),
    [source],
  );

  // ADR-0096. An OBJECT, not an array, so "empty" means a missing or typeless value
  // rather than a zero-length list: a run predating migration 045 must read "not judged",
  // never "no exposure".
  const sanctionsState = useMemo(
    () =>
      classify<SanctionsExposureRow>(
        source,
        (row) => row.sanctions_exposure,
        (v) =>
          !v ||
          typeof v !== "object" ||
          typeof (v as { direction?: unknown }).direction !== "string",
      ),
    [source],
  );

  // Same rule for external positioning: a null column means the CFTC reading was NOT
  // RETRIEVED (run predates migration 046, or the portal did not answer), which is a
  // different claim from "the book is not crowded" (ADR-0097).
  const positioningState = useMemo(
    () =>
      classify<PositioningCrowdingRow>(
        source,
        (row) => row.positioning_crowding,
        (v) =>
          !v ||
          typeof v !== "object" ||
          !Array.isArray((v as { rows?: unknown }).rows) ||
          !Array.isArray((v as { unobservable?: unknown }).unobservable),
      ),
    [source],
  );

  const correlationState = useMemo(
    () =>
      classify<CorrelationPair[]>(
        source,
        (row) => row.correlation_pairs,
        (v) => !Array.isArray(v) || v.length === 0,
      ),
    [source],
  );

  const capState = useMemo(
    () =>
      classify<CapUtilisationData>(
        source,
        (row) => row.cap_utilisation,
        (v) =>
          (v.single_name?.length ?? 0) +
            (v.sector?.length ?? 0) +
            (v.geo?.length ?? 0) ===
          0,
      ),
    [source],
  );

  const bookState = useMemo(
    () =>
      classify<BookMetrics>(
        source,
        (row) => row.book_metrics,
        (v) => {
          if (v.computed === false) return true;
          const t = v.factor_tilts;
          if (!t) return true;
          return ![
            t.beta_mkt,
            t.beta_smb,
            t.beta_hml,
            t.beta_rmw,
            t.beta_cma,
            t.beta_umd,
          ].some((b) => isNum(b));
        },
      ),
    [source],
  );

  // ── Actionable-risk derivations ──────────────────────────────────────────
  // Book metrics (exposures) and cap peaks come from the analytics row when it
  // classified "ok"; otherwise they stay null and the board renders "unknown".
  const bookMetrics = bookState.status === "ok" ? bookState.value : null;
  const capData =
    capState.status === "ok" ? capState.value : null;
  const correlationPairs = useMemo(
    () => (correlationState.status === "ok" ? correlationState.value : []),
    [correlationState],
  );

  const cfgMap = useMemo(() => configMap(data.config), [data.config]);
  const factorMap = useMemo(() => factorsByAsset(data.factors), [data.factors]);

  const drawdown = useMemo(
    () => buildDrawdownSeries(data.returns),
    [data.returns],
  );

  const peakCap = (rows: { utilisation?: number | null; weight?: number | null }[] | null | undefined): number | null => {
    if (!rows || rows.length === 0) return null;
    let max: number | null = null;
    for (const r of rows) {
      const w = isNum(r.weight) ? r.weight : null;
      if (w !== null) max = max === null ? w : Math.max(max, w);
    }
    return max;
  };

  const limitBoard = useMemo(() => {
    const inputs: LimitBoardInputs = {
      config: cfgMap,
      totalCapital: data.risk?.total_capital ?? null,
      var95Usd: data.risk?.var_95 ?? null,
      cvar95Usd: data.risk?.cvar_95 ?? null,
      beta: data.risk?.beta ?? null,
      hhi: data.risk?.concentration_hhi ?? null,
      grossExposure: bookMetrics?.gross_exposure ?? null,
      netExposure: bookMetrics?.net_exposure ?? null,
      maxDrawdown: drawdown?.maxDrawdown ?? null,
      singleNameWeight: peakCap(capData?.single_name),
      sectorWeight: peakCap(capData?.sector),
      geoWeight: peakCap(capData?.geo),
      // So the board withholds VaR/CVaR/beta on a sample too small to support
      // them, instead of stamping OK on a number the metrics tile refuses to
      // publish.
      returnSessions: data.returns.length,
      // ADR-0173. null (not 0) when no prior book existed to measure against —
      // needs NO history, unlike VaR/CVaR/beta above: it is a function of today's
      // weights and yesterday's, not a statistical estimate.
      realisedTurnover: data.analyticsRow?.optimizer_result?.realised_turnover ?? null,
    };
    return buildLimitBoard(inputs);
  }, [cfgMap, data.risk, data.returns.length, bookMetrics, drawdown, capData, data.analyticsRow]);

  const limitCoverageNote = useMemo(() => {
    const missing: string[] = [];
    if (!data.risk) missing.push("portfolio_risk (VaR/CVaR/beta/HHI)");
    if (!bookMetrics) missing.push("book_metrics (net/gross exposure)");
    if (!capData) missing.push("cap_utilisation (single-name/sector/geo)");
    if (!drawdown) missing.push("portfolio_returns (max drawdown)");
    if (missing.length === 0) return null;
    return `Some limits show "no data" because their input is unavailable: ${missing.join(", ")}.`;
  }, [data.risk, bookMetrics, capData, drawdown]);

  const attribution = useMemo(
    () => buildPositionAttribution(data.positions, factorMap, correlationPairs),
    [data.positions, factorMap, correlationPairs],
  );

  const crowdingRows = useMemo(
    () => buildCrowding(data.crowding, data.themeNames, data.positions),
    [data.crowding, data.themeNames, data.positions],
  );

  // Best-covered book theme's scored-observation count, for the crowding empty
  // state: a within-history percentile needs five, so this is the countdown that
  // turns "not yet" into "how close" — the risk-monitoring half of the engine
  // awaiting history, not a dead panel.
  const crowdingMaxObs = useMemo(
    () => Object.values(data.crowding).reduce((m, c) => Math.max(m, c.nObs), 0),
    [data.crowding],
  );

  const riskDeltas = useMemo(
    () => computeRiskDeltas(data.riskRows),
    [data.riskRows],
  );
  const prevRunDate = data.riskRows[1]?.run_date ?? null;

  // Will the scatter draw anything? Asked HERE because two things above it
  // depend on the answer — the "still the multi-asset book" marker that sits
  // over the grid's first cell, and the page banner's list of panels the reader
  // will find below. Both are wrong when the chart self-suppresses: the marker
  // lands on the risk-contribution waterfall beside it, which is the panel that
  // DOES follow the lens, and the banner names a panel that is not on the page.
  //
  // Under a lens that is the normal case rather than an edge one. The scatter
  // plots held positions (lens-less) against the risk decomposition (lens
  // following), so it needs names in BOTH; on 2026-07-30 the held book was
  // {BABA, F, GEV, GLD, NOC, PDD, SMH, UNG, UNH} and the credit decomposition
  // {BIL, BKLN, EMB}, an empty intersection. The predicate is imported, not
  // rewritten: one implementation, so the chart and the disclosures cannot
  // disagree about whether the chart exists.
  const scatterVisible = useMemo(
    () =>
      positionRiskScatterPoints(
        data.positions,
        data.analyticsRow?.risk_decomposition ?? null,
      ).length >= SCATTER_MIN_POINTS,
    [data.positions, data.analyticsRow],
  );

  // ADR-0040's invariant, checked rather than assumed: the names this page computes
  // risk on must be the names the book publishes.
  //
  // BOTH SIDES ARE THE MULTI-ASSET BOOK, under every lens. `portfolio_positions`
  // has no lens column, so the pick side is read pinned to multi_asset (see the
  // last entry in the Promise.all above) rather than at the active lens. A
  // cross-book comparison here would report "provisional" on every credit run,
  // and an alert that fires every run is one a reader learns to scroll past.
  const reconciliation = useMemo(() => {
    const raw = data.defaultLensPicks;
    const parsed = Array.isArray(raw)
      ? raw
      : typeof raw === "string"
        ? (() => {
            try {
              return JSON.parse(raw) as Array<{ asset?: string | null }>;
            } catch {
              return null;
            }
          })()
        : null;
    return reconcileToBook(
      data.positions.map((p) => p.asset).filter((a): a is string => Boolean(a)),
      parsed ? parsed.map((p) => p.asset ?? "").filter(Boolean) : null,
    );
  }, [data.defaultLensPicks, data.positions]);

  const failures = [
    data.analyticsFailure,
    data.baseFailure,
    data.riskFailure,
    data.returnsFailure,
  ].filter((f): f is QueryFailure => f !== null);

  // The lens-less panel KEYS this phase actually puts on screen. Keys, not
  // labels: `LensScopeBanner` groups them by `scopeOf` before naming them, and
  // it can only do that from the key. Not memoised — it is a filter over ~25
  // static keys, and a dependency array here would have to track `phase`,
  // `failures.length`, `scatterVisible`, the reconciliation and the resolved
  // lens to save nothing measurable.
  //
  // PHASE ALONE IS NOT ENOUGH. The banner promises "these are on the page
  // below", and the file's own rule is that a disclosure a reader can falsify
  // by scrolling is worse than no disclosure — so a panel that self-suppresses
  // on its data must be excluded by the same predicate the panel uses, not
  // assumed present because its section renders. Three do:
  //   ReconciliationBanner — renders only on a real disagreement between
  //     `portfolio_positions` and the pinned multi-asset pick list.
  //   ReadErrorsBanner     — renders only when a read actually failed.
  //   PositionRiskScatter  — returns null below SCATTER_MIN_POINTS, which under
  //     a non-default lens is the common case rather than the edge one (see
  //     `scatterVisible`). It was the reason this rule got written: the banner
  //     read "6 panels still multi-asset" and named a chart that was not there.
  const lensLessOnThisPhase = lensLessPanels().filter((panel) => {
    if (panel === "ReconciliationBanner") {
      return !data.loading && !reconciliation.reconciled;
    }
    if (panel === "ReadErrorsBanner") return failures.length > 0;
    if (panel === "PositionRiskScatter") return shows("attribution") && scatterVisible;
    const gate = PANEL_SECTION[panel];
    // Unclassified panels are assumed to render, matching `scopeOf`'s
    // over-disclose default: naming a panel the reader cannot find is a
    // smaller error than leaving a multi-asset figure unmarked.
    if (gate === undefined || gate === PANEL_EVERY_PHASE) return true;
    if (gate.startsWith("phase:")) return gate.slice("phase:".length) === phase;
    return shows(gate);
  });

  return (
    <main className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 wide:px-5 pt-7 pb-20">
      {/* Title and lede come from the PHASE, not from the page. This body is
          three destinations now, and a shared "Book Risk" heading on all of
          them would make the tab a reader clicked indistinguishable from the
          two they did not. */}
      <PageHeader
        title={PHASE_COPY[phase].title}
        lede={PHASE_COPY[phase].lede}
        // /attribution is pinned to multi_asset, and on a day when a second lens
        // has published a book that pin needs saying. A reader who arrived from
        // /risk?lens=credit — the only route by which they could hold the credit
        // book in mind — must not read this page's forward record as the credit
        // book's. One tertiary line, not an alert: nothing is wrong here.
        //
        // Gated on a second lens EXISTING, which is precisely the condition under
        // which the confusion is reachable: /risk only offers ?lens=credit when
        // the credit book published. With one book there is nothing to
        // disambiguate, and the sentence would be noise on the default page.
        fine={
          !lensEnabled && lensOffered.length > 1 ? (
            <>
              This page reports the multi-asset book only: the forward record and
              the realised return series have no lens column (ADR-0194), so there
              is no per-lens version of them to show.
            </>
          ) : undefined
        }
        meta={[
          { label: "Run date", value: data.loading ? "…" : (data.runDate ?? "—") },
          {
            // The lens the ROW claims, not the lens the page queried. They should
            // always agree; if a run ever writes a row whose `lens` differs from
            // the key it was fetched by, this is where it shows, and the scope
            // disclosures below still describe the query that produced the page.
            label: "Lens",
            value: data.loading ? "…" : (data.lens ?? "not recorded"),
            capitalize: true,
          },
        ]}
      />

      {/* The lens toggle. Rendered only when more than one lens actually has a
          published book for today's run_date — a control offering a book that does
          not exist is worse than no control — and never on /attribution, which is
          pinned (see `lensEnabled`). Selection lives in the URL via setLens, so
          /risk?lens=credit is linkable on its own.

          This is the ONE thing on this page that a default-lens reader can see
          which they could not before, and only on a day a second book published.
          A feature reachable by hand-typed query string is not a feature. */}
      {lensEnabled && lensOffered.length > 1 && (
        <div className="mb-6 flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-[0.08em] text-text-tertiary">
            Book
          </span>
          <LensSelector value={controlLens} onChange={setLens} lenses={lensOffered} />
        </div>
      )}

      {/* The boundary, stated once at the top rather than inferred from scattered
          chips: which panels below are the lens the reader chose, and which are
          still the multi-asset published book. Returns null at multi_asset, so it
          is absent from the default page entirely — its own guard, not this call
          site's. */}
      <LensScopeBanner lens={data.resolvedLens} panels={lensLessOnThisPhase} />

      {/* Every number below is computed on portfolio_positions. When that table has
          not been reconciled to the published book, they describe a portfolio nobody
          selected — say so before the reader reads them, not after. */}
      {/* RENDERS UNDER EVERY LENS, because the comparison behind it is
          same-book under every lens. `portfolio_positions` is lens-less
          (ADR-0194), so the pick side is read pinned to multi_asset — see the
          last entry in the Promise.all above — rather than at the page's lens.

          It was briefly gated on `resolvedLens === DEFAULT_LENS` instead, and
          that was the wrong repair. The problem it addressed was real: compared
          against the ACTIVE lens's picks the check is cross-book and reads
          "provisional" on every credit run, and an alert that fires every run
          is one a reader learns to scroll past. But suppressing it threw away
          the true signal with the false one. The pipeline writes L1's full
          candidate set here at 21:30 and reconciles it to the picked book only
          when L5 returns, so at 21:35 /risk?lens=credit showed ~60 candidate
          names across the what-if builder, the attribution table and the answer
          row — each under a chip whose title asserted they ARE the multi-asset
          published book, which in that window they are not. Fixing the
          comparison keeps the alert AND makes it true. */}
      {!data.loading && !reconciliation.reconciled && (
        <div
          className="card mb-6"
          style={{ borderColor: "var(--warning)" }}
          role="alert"
          aria-labelledby="risk-provisional"
        >
          <div className="card-header">
            <h2 id="risk-provisional" className="card-title m-0" style={{ color: "var(--warning)" }}>
              These are provisional positions, not the published book
            </h2>
            <span className="num text-[11px] text-text-tertiary">
              {reconciliation.positionCount} held · {reconciliation.bookCount} published
            </span>
          </div>
          <p className="m-0 p-[18px] pt-3 text-[12.5px] text-text-secondary leading-[1.65] max-w-[92ch]">
            <Ident>portfolio_positions</Ident> holds{" "}
            <span className="num">{reconciliation.positionCount}</span> names while the
            published book holds{" "}
            <span className="num">{reconciliation.bookCount}</span>, so every figure on
            this page — VaR, CVaR, Sharpe, beta, HHI, attribution — is computed on names
            the book does not hold. The daily pipeline writes L1&apos;s full candidate
            set here first, hands it to L5 as a reasoning input, and reconciles the
            table to the picked book only after the agent returns. This is what the
            page looks like in the middle of that window; it clears when the run
            finishes.
            {reconciliation.extra.length > 0 && (
              <>
                {" "}
                Not in the book:{" "}
                <span className="num">
                  {reconciliation.extra.slice(0, 12).join(", ")}
                  {reconciliation.extra.length > 12
                    ? ` +${reconciliation.extra.length - 12} more`
                    : ""}
                </span>
                .
              </>
            )}
            {/* Appended, never substituted: the default-lens paragraph above is
                byte-identical to what it has always been, and this sentence
                exists only on a page where "the published book" would otherwise
                be ambiguous between two of them. */}
            {data.resolvedLens !== DEFAULT_LENS && (
              <>
                {" "}
                Both sides of that count are the <strong>multi-asset</strong>{" "}
                book — the held positions have no lens column (ADR-0194) and the
                pick list is read pinned to match them — so this is the
                multi-asset book mid-run, not a disagreement between it and the{" "}
                {data.resolvedLens} book.
              </>
            )}
          </p>
        </div>
      )}

      {failures.length > 0 && (
        <div
          className="card mb-6 border-short/40"
          role="alert"
          aria-labelledby="risk-read-errors"
        >
          <div className="card-header">
            <h2 id="risk-read-errors" className="card-title m-0 text-short">
              {failures.length} read error{failures.length === 1 ? "" : "s"}
            </h2>
            <span className="text-[11px] text-text-tertiary">
              Sections below are blank because of these, not because the book is clean
            </span>
          </div>
          <ul className="m-0 list-none p-[18px] pt-3 text-[12px] space-y-2">
            {failures.map((f, i) => (
              <li key={`${f.table}-${i}`} className="leading-[1.6]">
                <Ident>{f.table}</Ident>{" "}
                <span className="text-short num">{f.code ?? "error"}</span>{" "}
                <span className="text-text-secondary">{f.message}</span>
                {f.hint && (
                  <span className="text-text-tertiary"> — hint: {f.hint}</span>
                )}
                <div className="text-text-tertiary mt-0.5">
                  requested columns: <span className="num">{f.columns}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 1 — Risk-limit board: the scan-first "what is near/over" view. */}
      {/* The nav sits BELOW the alert banners above. An alert is the one thing a
          reader has to see before deciding where to jump; putting the nav above
          it would let a reader navigate away from a breach they never saw. */}
      {/* The answer row sits ABOVE the section nav, because it is the answer and the
          nav is a way of getting to the evidence for it. Measured before this
          existed: /risk's own headline — the six-scenario matrix — was at 2622px,
          nearly three screens down (ADR-0172). Only the risk phase has one so far; the
          other rows land in the same place as they are written. */}
      {phase === "mandate" && (
        <>
          {/* Mixed: four of its figures are portfolio_risk's, which is lens-less.
              `AnswerRow` takes no slot, so the marker sits above the grid — a
              fragment, which adds no DOM of its own, rather than a wrapper. */}
          <ScopeNote lens={data.resolvedLens} panel="MandateAnswerRow" />
          <AnswerRow
            cards={mandateAnswerCards({
              limitRows: limitBoard,
              capState,
              bookMetrics,
              totalCapital: data.risk?.total_capital ?? null,
            })}
          />
        </>
      )}

      {/* No ScopeNote on this row or anywhere in the `realised` section below:
          /attribution is pinned to multi_asset, so `showScopeNote` is false for
          every panel on it by construction and a chip here could never render.
          Dead JSX that looks conditional is worse than an absence with a note. */}
      {phase === "attribution" && (
        <AnswerRow
          cards={attributionAnswerCards({
            track:
              data.outcomeRows === null
                ? null
                : buildTrackRecord(data.outcomeRows, 21),
            holdings: data.holdings,
            sessions: data.returns.length,
          })}
        />
      )}

      {phase === "risk" && (
        <>
          {/* Mixed: the scenario and correlation cards follow the lens, the
              position-count and factor-coverage cards are portfolio_positions'. */}
          <ScopeNote lens={data.resolvedLens} panel="RiskAnswerRow" />
          <AnswerRow
            cards={riskAnswerCards({
              scenarioState,
              correlationState,
              attribution,
              positionCount: data.positions.length,
              factorCoverage: data.positions.filter(
                (p) => p.asset && factorMap[p.asset],
              ).length,
              covShrinkageIntensity:
                data.analyticsRow?.optimizer_result?.cov_shrinkage_intensity ?? null,
            })}
          />
        </>
      )}

      <SectionNav items={PHASE_SECTION_NAV[phase]} />

      {/* The mandate comes FIRST, because the board below measures against it.
          Until this panel the caps existed only as per-name utilisation bars: a
          reader saw "US 35% — at limit" with no way to learn who chose 35%.

          Its own <section>, not a preamble inside `limits`: MandatePanel already
          carried id="mandate" and the section nav tabs by section id, so being
          nested left the tab strip unable to name the one thing on this page a
          reader most often arrives asking for. */}
      {/* Phase 1 as ONE row (owner's direction, 2026-07-30): the mandate across
          half the canvas, and the two READINGS of that mandate at a quarter each.
          The limit board and the cap bars both answer "is the published book
          inside it?", so at `xl` they sit beside the constraint they measure
          rather than ~1100px below it — which is the same argument that put the
          mandate panel above them in the first place, applied one axis further.

          Both cells are gated on `shows()` and both ids belong to the `mandate`
          phase, so this row is whole or absent; it is not a place a section can
          leak into another phase. The trade the owner accepted with it: the two
          section-nav tabs (#mandate, #limits) now start at the same y, so
          "Limits" will rarely win SectionNav's active state — the anchors still
          resolve, the highlight is what degrades.

          Column arithmetic, so the two narrow cards were shaped against a real
          width rather than a hope: max-w-[1400px] − 64 lg gutter = 1336 content,
          less 3×24 gap, /4 = 316px per column (~280 inside a card). That is why
          RiskLimitBoard is no longer an 820px table and why CapUtilisation's bar
          row drops back to its two-column form at `xl`. Below `xl` nothing
          changes: one column, full width, as before.

          No `items-start` on the grid, unlike every other paired grid on this
          page: the three cards align top AND bottom, so the cells stretch to the
          tallest. Each card carries its own `h-full` to fill the cell it was
          given — a stretched WRAPPER with a content-height card inside it aligns
          nothing. CapUtilisation's is `open:h-full`, because stretching a
          COLLAPSED disclosure would draw a 1600px empty box (ADR-0181).
          (This note sits ABOVE the guard, not between `&& (` and the element:
          that position expects an expression and a JSX comment there is a syntax
          error — the same trap the var-methods block below records.) */}
      {(shows("mandate") || shows("limits")) && (
      <div className="grid xl:grid-cols-4 gap-6 mb-6 [&>*]:min-w-0 [&_.card]:mb-0">
        {shows("mandate") && (
        <section aria-label="The mandate" className="xl:col-span-2">
          <MandatePanel config={data.config} lens={data.lens} />
        </section>
        )}

        {shows("limits") && (
        <>
        <section id="limits" aria-label="Limits">
          {/* The single worst panel to swap silently: five of its eleven rows are
              valued from lens-less tables and six from the lens-following
              analytics row, in one table, under one heading, with one OK/BREACH
              column. Inside the section wrapper, so the grid cell is untouched. */}
          <ScopeNote lens={data.resolvedLens} panel="RiskLimitBoard" />
          <RiskLimitBoard
            loading={data.loading}
            rows={limitBoard}
            coverageNote={limitCoverageNote}
          />
        </section>

        {/* Cap headroom, moved from the risk page (ADR-0172). "Am I inside my limits"
            is the MANDATE's question, and the board beside it states the limits this
            measures against — separating a constraint from the reading of that
            constraint is what made the caps unreadable before MandatePanel existed.

            It briefly shared this column with the five risk-metric tiles, which
            have since moved to /attribution — four of the five were the same
            portfolio_risk figures the board already reports AGAINST THEIR LIMIT,
            two cards apart, and three of those were stating the same ABSENCE
            twice in two wordings (ADR-0182). Alone in the column again, the card
            takes `open:h-full` back so the row keeps one bottom edge. */}
        <div>
          <CapUtilisation
            state={capState}
            // The two cap facts the card could not previously state: whether any
            // held names were sized as ONE idea (an enforced mandate cap that
            // nothing on the site measured), and what each grouping's rows add up
            // to against gross — a cap only binds on weight it can see.
            complexSizing={data.analyticsRow?.optimizer_result?.complex_sizing ?? null}
            grossExposure={bookMetrics?.gross_exposure ?? null}
            correlationSummary={bookMetrics?.correlation_summary ?? null}
          />
        </div>
        </>
        )}
      </div>
      )}


      {shows("stress") && (
      <section id="stress" aria-label="Stress scenarios">
      {/* Stress scenarios lead the page (ADR-0172). They ARE this phase's answer,
          and they were at 2622px below a what-if builder that explores them — a
          tool placed ahead of the finding it is for. The what-if follows, which
          also reads better: a reader now varies a shock they have already seen. */}
      <StressScenarios state={scenarioState} />


      {/* Browser-side estimate, labelled as one — after the persisted matrix. */}
      {/* Both figures it puts on screen — the shocked positions and the dollar
          P&L against total_capital — come from lens-less tables, so the shock is
          applied to the multi-asset book whatever lens is active. */}
      <ScopeNote lens={data.resolvedLens} panel="WhatIfScenario" />
      <WhatIfScenario
        loading={data.loading}
        positions={data.positions}
        factors={factorMap}
        totalCapital={data.risk?.total_capital ?? null}
        dataFailure={
          data.positionsFailure
            ? `portfolio_positions read failed: ${data.positionsFailure}`
            : data.factorsFailure
              ? `factor_exposures read failed: ${data.factorsFailure}`
              : null
        }
      />

      {/* 6b — Sanctions exposure, beside the stress table because it is the same kind of
          claim: what the book does under a shock it did not choose. ADR-0096. */}
      <SanctionsExposure state={sanctionsState} />
      <PositioningCrowding state={positioningState} />
      </section>
      )}

      {/* VaR by method — moved off /mandate (ADR-0172). The mandate LISTS a VaR
          limit and its board reports the one published figure against it; the
          four-way comparison is a risk analysis, not a limits check, and belongs on
          the page whose question is what could go wrong. (The metric grid that used
          to report that figure beside the board is on /attribution now — ADR-0182.) Its own section, because
          five instruments in `stress` would bury the scenario matrix again — which
          is the defect this whole reorganisation exists to fix. */}
      {/* No `id` on the wrapper below: `VarMethods` already renders
          `id="var-methods"` itself, and two elements sharing an id makes the anchor
          ambiguous — the nav entry targets the component's own heading. (This note
          sits ABOVE the guard, not between `&& (` and the element: that position
          expects an expression and a JSX comment there is a syntax error.) */}
      {shows("var-methods") && (
      <section aria-label="Value at risk by method">
      {/* 2b — The four VaRs, together, each with its horizon and basis.
              The tile above publishes ONE of them. Three more sit in the database:
              `risk_decomposition` since migration 038 with its render recorded as
              pending in ADR-0082, and the Monte Carlo and fan since 047. Surfacing
              one without the others is how a page ends up with two numbers called
              VaR that differ by an order of magnitude. */}
      <div className="mt-6">
        {/* Three of the four VaRs follow the lens; the published one on the risk
            row does not. A multi-asset VaR sitting inside a four-way comparison
            of credit VaRs is precisely the "two numbers called VaR" defect
            ADR-0082 named, one lens toggle later. */}
        <ScopeNote lens={data.resolvedLens} panel="VarMethods" />
        <VarMethods
          risk={data.risk}
          decomposition={data.analyticsRow?.risk_decomposition ?? null}
          monteCarlo={data.analyticsRow?.monte_carlo_var ?? null}
          forecast={data.analyticsRow?.var_forecast ?? null}
          sessions={data.returns.length}
        />
      </div>
      </section>
      )}

      {/* Per-position attribution renders AFTER stress and VaR (ADR-0172), because
          DOM order is what a reader experiences and PHASE_SECTION_NAV already listed
          Stress first. This block was above them in the markup, which put ~2000px of
          charts between the page and its own answer — #stress measured 2281px on
          /risk even after the answer row landed. The nav saying one order while the
          markup does another is the defect, not the nav. */}
      {shows("attribution") && (
      <section id="attribution" aria-label="Per-position and per-theme attribution">
      {/* Marks the SCATTER, not the waterfall beside it: the scatter plots
          portfolio_positions (lens-less) against the lens-following risk
          decomposition, while the waterfall is the decomposition alone and needs
          no marker. Above the grid rather than inside a cell — a wrapper div
          around one grid child would alter the default page's DOM, which this
          may not do, and `ScopeNote` is left-aligned so at `xl` it sits over the
          first cell and at narrower widths over the card directly below it.

          GATED ON THE SCATTER ACTUALLY DRAWING, because sitting outside the grid
          is what makes that necessary. `PositionRiskScatter` returns null below
          SCATTER_MIN_POINTS, and under a lens that is the ordinary case: it
          needs names present in BOTH the lens-less held book and the
          lens-following decomposition, which on 2026-07-30 intersected in
          nothing. Ungated, the words "multi-asset book" then sat directly above
          the risk-contribution waterfall — the one panel in this section that
          genuinely IS the credit book — labelling it as the other one. */}
      {scatterVisible && (
        <ScopeNote lens={data.resolvedLens} panel="PositionRiskScatter" />
      )}
      <div className="grid xl:grid-cols-2 gap-6 items-start [&>*]:min-w-0">
        <PositionRiskScatter
          positions={data.positions}
          decomposition={data.analyticsRow?.risk_decomposition ?? null}
        />
        <RiskContributionWaterfall
          decomposition={data.analyticsRow?.risk_decomposition ?? null}
        />
      </div>
      {/* Every row is a held name from portfolio_positions, and the book beta it
          compares against is portfolio_risk's — so the table names multi-asset
          positions whatever lens is active. */}
      <ScopeNote lens={data.resolvedLens} panel="PositionRiskAttribution" />
      <PositionRiskAttribution
        loading={data.loading}
        rows={attribution}
        bookBeta={data.risk?.beta ?? null}
        // The same sample size the Beta tile and the limit board use, so all three
        // agree about whether a regression beta is publishable (ADR-0063).
        returnSessions={data.returns.length}
        positionsFailure={data.positionsFailure}
        factorsFailure={data.factorsFailure}
        hasPositions={data.positions.length > 0}
      />

      {/* 4 — Theme attention crowding: the risk-monitoring half of the engine. */}
      {/* The two theme tables are lens-neutral, so the only book-shaped input is
          the held-position list — which means every row here scores a theme the
          MULTI-ASSET book holds, whichever lens the reader picked. */}
      <ScopeNote lens={data.resolvedLens} panel="AttentionCrowding" />
      <AttentionCrowding
        loading={data.loading}
        rows={crowdingRows}
        historyFailure={data.crowdingFailure}
        observationNote={
          data.positions.length === 0
            ? "No sized positions, so there are no book themes to score for crowding."
            : `The book's themes have up to ${crowdingMaxObs} of the five scored observations a within-history percentile needs; below five it reads — rather than a guess, and fills in as the daily history grows.`
        }
      />

      {/* 5 — What-if scenario builder: live browser-side estimate. */}
      </section>
      )}

      {shows("concentration") && (
      <section id="concentration" aria-label="Concentration">

      {/* Which names move together. Full-width since ADR-0172 moved cap headroom to
          /mandate: this was a measured PAIR, and the measurement that justified it
          ("both are collapsed <details>, so stacking them full-width spent two rows
          on two summary bars") stops applying when there is one card. A 2-col grid
          with one cell does not fill the width, it halves what survived — the
          orphaned-cell failure the pairing existed to avoid.

          Full width also buys the heatmap its min-w-[560px] table without an inner
          horizontal scroller, which is why the pair was gated at xl rather than lg. */}
      <CorrelationMatrix
        state={correlationState}
        summary={bookMetrics?.correlation_summary ?? null}
        matrix={bookMetrics?.correlation_matrix ?? null}
      />

      {/* 9 — Book factor tilt (persisted). Stays full-width: the tilt bars are a
          diverging scale with a labelled −2.00 … +2.00 axis, and halving the
          column halves the resolution of the only chart on the page whose whole
          content is bar length. */}
      </section>
      )}

      {shows("exposure") && (
      <section id="exposure" aria-label="Factor exposure">
      <BookFactorTilt state={bookState} />
      </section>
      )}

      {/* 10 + 11 — Shape and figures for the same series, side by side rather
          than 600px apart: the chart answers "what did the drawdown look like",
          the table answers "what exactly did we make on the 23rd". Reading one
          against the other was previously a scroll. */}
      {shows("realised") && (
      <section id="realised" aria-label="Realised performance">
      {/* The five headline risk statistics, moved off /mandate (ADR-0182). Four of
          them — VaR, CVaR, beta, HHI — are the same portfolio_risk figures the
          limit board reports there AGAINST THEIR LIMIT, which on a page asking
          "is the book inside its mandate" is the strictly better form; three were
          stating the same ABSENCE twice, two cards apart, in two wordings. The
          fifth, Sharpe, has no mandate limit at all.

          They land HERE and not on /risk because every one of them is computed
          from the realised return series, and /risk's own lede promises that
          every figure on it is ex-ante — a pure function of the recommended
          weights and a covariance estimate. Putting these there would have made
          that sentence false. The Δ-vs-yesterday chips are the same claim this
          phase is for.

          First in the section, because they are the headline: a compact
          five-across strip above the record and the curves that explain it. */}
      <RiskMetricsGrid
        loading={data.loading}
        risk={data.risk}
        failure={data.riskFailure}
        orderingNote={data.riskOrderingNote}
        deltas={riskDeltas}
        prevRunDate={prevRunDate}
        sessions={data.returns.length}
      />

      {/* The forward record, moved here from /method/evidence (ADR-0172). Phase 6
          IS "was the thesis right", and this is the only instrument that answers it
          about books we actually published. Fed the rows this page already read, so
          it makes no second query of its own. */}
      <TrackRecord rows={data.outcomeRows} />

      {/* Moved off /mandate (ADR-0172). Both are BACKWARD-LOOKING, which is phase
          6's question and not phase 1's — a mandate says what the book is allowed to
          be, not what it did. They were at 4093px on a page whose own answer is at
          284px, while /attribution was the thinnest page in the app.

          The pairing comment below is kept because its measurement still holds: these
          two need 676px each and fit a two-column row, where the limit board (820),
          per-position attribution (860) and stress scenarios (720) do not. Pairing is
          gated on the measurement name by name, not applied to whatever is adjacent. */}
      {/* 2c ‖ 2d — the two backward-looking readings, side by side.
              2c is "versus what?" answered with numbers rather than a second chart
              line (ADR-0094 built the benchmark series; down-capture is the field
              that actually tests this book's claim to be short the market). 2d is
              the path statistics ex-ante cannot produce and a three-session book
              cannot either — explicitly NOT a track record (ADR-0112), with its
              caveats above the numbers rather than below them.

              THESE TWO PAIR AND THE FOUR INSTRUMENTS ABOVE CANNOT, and the reason
              is measured rather than aesthetic. `main` is `max-w-[1400px]`, so at a
              1440 viewport a two-column row gives each side (1344-24)/2 = 660px.
              The limit board needs 820px before its table opens a horizontal
              scroller, per-position attribution 860, stress scenarios and external
              positioning 720 each — so halving any of them trades vertical space
              for an inner scrollbar, which is goal 7's failure, not a fix for it.
              These two need 676 and fit. Pairing is gated on the measurement, name
              by name; it is not a rule the page applies to whatever is adjacent. */}
      <div className="mt-6 grid lg:grid-cols-2 gap-6 items-start [&>*]:min-w-0">
        <BenchmarkComparison
          comparison={data.risk?.benchmark_comparison ?? null}
          conditionalVol={data.risk?.conditional_vol ?? null}
          sessions={data.returns.length}
        />
        <WeightsBacktest data={data.analyticsRow?.weights_backtest ?? null} />
      </div>

      {/* Stated before the curve, not after it. Both panels below draw a shape a
          reader recognises as a track record, and at the current observation
          count that shape is asserting far more than the data supports. The n is
          read from the persisted row rather than from rows.length so the caveat
          cannot disagree with the figure L4 published. */}
      {!data.loading && (
        <SourceCaveat source="portfolio_cumulative_return.daily_returns_count">
          {data.inception ? (
            <>
              Priced from actual closes, but{" "}
              <strong>gross of transaction costs</strong>:{" "}
              <span className="num">compute_daily_return</span> sums
              weight × price return and subtracts nothing. The published book
              reconstitutes itself every run and has turned over 50–77% of its
              names between consecutive runs, so this curve is what a book would
              have earned if each day&rsquo;s rebalance were instant and free. It
              was neither, and the gap is not small at that turnover.
              {" "}Only {data.inception.daily_returns_count} daily observation
              {data.inception.daily_returns_count === 1 ? "" : "s"} since{" "}
              {data.inception.inception_date}, weekdays only —{" "}
              <strong>not yet a track record</strong> on sample size either. The
              forward record that does account for this is{" "}
              <a href="/method/evidence#track-record" className="text-accent hover:underline">
                pick outcomes
              </a>
              , which scores each published call at a fixed horizon.
            </>
          ) : (
            <>
              No since-inception row was returned, so the length of this series is
              unstated — read the shape below as the observations that exist, not
              as a track record. It is also gross of transaction costs on a book
              that reconstitutes itself every run.
            </>
          )}
        </SourceCaveat>
      )}
      {/* Above the curve it corrects, not below it. A reader who scrolls past the
          chart has already formed a view of the performance, and the correction
          arriving afterwards is a footnote to a conclusion they have made. */}
      {!data.loading && data.holdings.length > 0 && (
        <CostDrag
          rows={data.holdings}
          publishedCumulative={
            data.inception?.cumulative_value != null
              ? data.inception.cumulative_value - 1
              : null
          }
          capital={data.risk?.total_capital ?? ENFORCED.total_capital.value}
        />
      )}

      <div className="grid xl:grid-cols-2 gap-6 mb-6 items-start [&>*]:mb-0">
        <DrawdownChart
          loading={data.loading}
          rows={data.returns}
          failure={data.returnsFailure}
          inception={data.inception}
          benchmark={data.benchmark}
        />
        <DailyPLHistory limit={30} />
      </div>
      </section>
      )}
    </main>
  );
}
