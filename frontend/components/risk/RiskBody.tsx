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

"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
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
import {
  PHASE_SECTION_NAV,
  phaseShows,
  type RiskPhase,
} from "@/lib/method/phaseSections";

// Six anchored groups, in the order the page already rendered them — no panel
// moved. Labels are nouns and carry no figure (SectionNav is tested for that:
// a count here would be an untraceable number that goes stale against the panel
// it labels).
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
      "What the book actually did — realised drawdown and the return path, " +
      "against the ex-ante figures the phases above produced. This is the only " +
      "surface here that is backward-looking.",
  },
};

const ANALYTICS_COLUMNS =
  // picks: the published book, so this page can check that the positions it computes
  // risk on are the names the book actually holds (ADR-0040).
  "run_date, lens, scenario_results, correlation_pairs, cap_utilisation, book_metrics, picks, sanctions_exposure, positioning_crowding, risk_decomposition, monte_carlo_var, var_forecast, weights_backtest";
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
  lens: string | null;
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
  risk: null,
  riskRows: [],
  riskFailure: null,
  riskOrderingNote: null,
  returns: [],
  returnsFailure: null,
  inception: null,
  holdings: [],
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

  useEffect(() => {
    let cancelled = false;

    (async () => {
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
      ] = await Promise.all([
        supabase
          .from("research_recommendations")
          .select(ANALYTICS_COLUMNS)
          .order("run_date", { ascending: false })
          .limit(1),
        // Minimal probe: succeeds even when the migration-022 columns are absent,
        // which is what lets the UI tell "no run yet" apart from "column missing".
        supabase
          .from("research_recommendations")
          .select(BASE_COLUMNS)
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
  }, []);

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
    };
    return buildLimitBoard(inputs);
  }, [cfgMap, data.risk, data.returns.length, bookMetrics, drawdown, capData]);

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

  // ADR-0040's invariant, checked rather than assumed: the names this page computes
  // risk on must be the names the book publishes.
  const reconciliation = useMemo(() => {
    const raw = data.analyticsRow?.picks;
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
  }, [data.analyticsRow, data.positions]);

  const failures = [
    data.analyticsFailure,
    data.baseFailure,
    data.riskFailure,
    data.returnsFailure,
  ].filter((f): f is QueryFailure => f !== null);

  return (
    <main className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 wide:px-5 pt-7 pb-20">
      <div className="flex justify-between items-end mb-7 gap-6 flex-wrap">
        <div>
          {/* Title and lede come from the PHASE, not from the page. This body is
              three destinations now, and a shared "Book Risk" heading on all of
              them would make the tab a reader clicked indistinguishable from the
              two they did not. */}
          <h1 className="text-[22px] font-semibold tracking-[-0.01em] m-0 mb-1">
            {PHASE_COPY[phase].title}
          </h1>
          <p className="m-0 text-text-secondary text-[13px] max-w-[80ch]">
            {PHASE_COPY[phase].lede}
          </p>
        </div>
        <div className="text-right text-text-secondary text-[12px]">
          <div>
            <span className="text-text-tertiary mr-1.5">RUN DATE</span>
            <span className="num text-text-primary">
              {data.loading ? "…" : (data.runDate ?? "—")}
            </span>
          </div>
          <div className="mt-1">
            <span className="text-text-tertiary mr-1.5">LENS</span>
            <span className="num">
              {data.loading ? "…" : (data.lens ?? "not recorded")}
            </span>
          </div>
        </div>
      </div>

      {/* Every number below is computed on portfolio_positions. When that table has
          not been reconciled to the published book, they describe a portfolio nobody
          selected — say so before the reader reads them, not after. */}
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
      <SectionNav items={PHASE_SECTION_NAV[phase]} />

      {/* The mandate comes FIRST, because the board below measures against it.
          Until this panel the caps existed only as per-name utilisation bars: a
          reader saw "US 35% — at limit" with no way to learn who chose 35%.

          Its own <section>, not a preamble inside `limits`: MandatePanel already
          carried id="mandate" and the section nav tabs by section id, so being
          nested left the tab strip unable to name the one thing on this page a
          reader most often arrives asking for. */}
      {shows("mandate") && (
      <section aria-label="The mandate">
        <MandatePanel config={data.config} lens={data.lens} />
      </section>
      )}

      {shows("limits") && (
      <section id="limits" aria-label="Limits and headline risk">
      <RiskLimitBoard
        loading={data.loading}
        rows={limitBoard}
        coverageNote={limitCoverageNote}
      />

      {/* 2 — Risk metrics (always rendered) + prior-run deltas. */}
      <RiskMetricsGrid
        loading={data.loading}
        risk={data.risk}
        failure={data.riskFailure}
        orderingNote={data.riskOrderingNote}
        deltas={riskDeltas}
        prevRunDate={prevRunDate}
        sessions={data.returns.length}
      />

      {/* 2b — The four VaRs, together, each with its horizon and basis.
              The tile above publishes ONE of them. Three more sit in the database:
              `risk_decomposition` since migration 038 with its render recorded as
              pending in ADR-0082, and the Monte Carlo and fan since 047. Surfacing
              one without the others is how a page ends up with two numbers called
              VaR that differ by an order of magnitude. */}
      <div className="mt-6">
        <VarMethods
          risk={data.risk}
          decomposition={data.analyticsRow?.risk_decomposition ?? null}
          monteCarlo={data.analyticsRow?.monte_carlo_var ?? null}
          forecast={data.analyticsRow?.var_forecast ?? null}
          sessions={data.returns.length}
        />
      </div>

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

      {/* 3 — Per-position risk attribution: "which trade to cut". */}
      </section>
      )}

      {shows("attribution") && (
      <section id="attribution" aria-label="Per-position and per-theme attribution">
      <div className="grid xl:grid-cols-2 gap-6 items-start [&>*]:min-w-0">
        <PositionRiskScatter
          positions={data.positions}
          decomposition={data.analyticsRow?.risk_decomposition ?? null}
        />
        <RiskContributionWaterfall
          decomposition={data.analyticsRow?.risk_decomposition ?? null}
        />
      </div>
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

      {shows("stress") && (
      <section id="stress" aria-label="Stress scenarios">
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

      {/* 6 — Stress scenarios (persisted). */}
      <StressScenarios state={scenarioState} />

      {/* 6b — Sanctions exposure, beside the stress table because it is the same kind of
          claim: what the book does under a shock it did not choose. ADR-0096. */}
      <SanctionsExposure state={sanctionsState} />
      <PositioningCrowding state={positioningState} />
      </section>
      )}

      {shows("concentration") && (
      <section id="concentration" aria-label="Concentration">

      {/* 7 + 8 — The two concentration views, paired: which names move together,
          and how much room each cap has left. Both are collapsed <details>, so
          stacking them full-width spent two full rows of the page on two summary
          bars. `items-start` keeps an expanded panel from stretching its
          neighbour into a tall empty box, and `[&>*]:mb-0` neutralises the
          mb-6 each card carries for the stacked case so the grid gap is the only
          spacing. Gated at xl, not lg: CorrelationMatrix's heatmap has a
          min-w-[560px] table, which needs a ~600px column to avoid landing in
          its own horizontal scroller on arrival. */}
      <div className="grid xl:grid-cols-2 gap-6 mb-6 items-start [&>*]:mb-0">
        <CorrelationMatrix
          state={correlationState}
          summary={bookMetrics?.correlation_summary ?? null}
          matrix={bookMetrics?.correlation_matrix ?? null}
        />
        <CapUtilisation state={capState} />
      </div>

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
