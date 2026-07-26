// frontend/app/risk/page.tsx
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
import { CorrelationMatrix } from "@/components/risk/CorrelationMatrix";
import { CapUtilisation } from "@/components/risk/CapUtilisation";
import { BookFactorTilt } from "@/components/risk/BookFactorTilt";
import { RiskMetricsGrid } from "@/components/risk/RiskMetricsGrid";
import { DrawdownChart, type InceptionRow } from "@/components/risk/DrawdownChart";
import { DailyPLHistory } from "@/components/portfolio/DailyPLHistory";
import { RiskLimitBoard } from "@/components/risk/RiskLimitBoard";
import { PositionRiskAttribution } from "@/components/risk/PositionRiskAttribution";
import { AttentionCrowding } from "@/components/risk/AttentionCrowding";
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

// Six anchored groups, in the order the page already rendered them — no panel
// moved. Labels are nouns and carry no figure (SectionNav is tested for that:
// a count here would be an untraceable number that goes stale against the panel
// it labels).
const RISK_SECTIONS = [
  { id: "limits", label: "Limits" },
  { id: "attribution", label: "Attribution" },
  { id: "stress", label: "Stress" },
  { id: "concentration", label: "Concentration" },
  { id: "exposure", label: "Exposure" },
  { id: "realised", label: "Realised" },
];

const ANALYTICS_COLUMNS =
  // picks: the published book, so this page can check that the positions it computes
  // risk on are the names the book actually holds (ADR-0040).
  "run_date, lens, scenario_results, correlation_pairs, cap_utilisation, book_metrics, picks";
const BASE_COLUMNS = "run_date, lens";
const RISK_COLUMNS =
  "run_date, updated_at, total_capital, var_95, cvar_95, sharpe, beta, concentration_hhi, numeric_derivations";
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
  positions: [],
  positionsFailure: null,
  factors: [],
  factorsFailure: null,
  config: [],
  themeNames: {},
  crowding: {},
  crowdingFailure: null,
};

export default function RiskPage() {
  return (
    <Suspense
      fallback={
        <main className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 wide:px-5 pt-7 pb-20">
          <div className="skeleton h-[180px]" />
        </main>
      }
    >
      <RiskPageInner />
    </Suspense>
  );
}

function RiskPageInner() {
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
          <h1 className="text-[22px] font-semibold tracking-[-0.01em] m-0 mb-1">
            Book Risk
          </h1>
          <p className="m-0 text-text-secondary text-[13px] max-w-[80ch]">
            Limits, per-position attribution, attention crowding, a live what-if,
            stress scenarios, correlation crowding, cap headroom, factor tilt and
            realised drawdown for the sized long-short book. Persisted figures are read
            from pipeline artefacts; the what-if is a browser-side estimate, labelled as
            one.
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
      <SectionNav items={RISK_SECTIONS} />

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

      {/* 3 — Per-position risk attribution: "which trade to cut". */}
      </section>

      <section id="attribution" aria-label="Per-position and per-theme attribution">
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
      </section>

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
        <CorrelationMatrix state={correlationState} />
        <CapUtilisation state={capState} />
      </div>

      {/* 9 — Book factor tilt (persisted). Stays full-width: the tilt bars are a
          diverging scale with a labelled −2.00 … +2.00 axis, and halving the
          column halves the resolution of the only chart on the page whose whole
          content is bar length. */}
      </section>

      <section id="exposure" aria-label="Factor exposure">
      <BookFactorTilt state={bookState} />
      </section>

      {/* 10 + 11 — Shape and figures for the same series, side by side rather
          than 600px apart: the chart answers "what did the drawdown look like",
          the table answers "what exactly did we make on the 23rd". Reading one
          against the other was previously a scroll. */}
      <section id="realised" aria-label="Realised performance">
      <div className="grid xl:grid-cols-2 gap-6 mb-6 items-start [&>*]:mb-0">
        <DrawdownChart
          loading={data.loading}
          rows={data.returns}
          failure={data.returnsFailure}
          inception={data.inception}
        />
        <DailyPLHistory limit={30} />
      </div>
      </section>
    </main>
  );
}
