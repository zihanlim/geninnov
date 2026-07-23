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
import { DrawdownChart } from "@/components/risk/DrawdownChart";
import { Ident } from "@/components/risk/SectionGap";
import {
  classify,
  isNum,
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

const ANALYTICS_COLUMNS =
  "run_date, lens, scenario_results, correlation_pairs, cap_utilisation, book_metrics";
const BASE_COLUMNS = "run_date, lens";
const RISK_COLUMNS =
  "run_date, updated_at, total_capital, var_95, cvar_95, sharpe, beta, concentration_hhi, numeric_derivations";
const RETURN_COLUMNS = "run_date, daily_return, cumulative_return, portfolio_value";

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
  riskFailure: QueryFailure | null;
  riskOrderingNote: string | null;
  returns: ReturnRow[];
  returnsFailure: QueryFailure | null;
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
  riskFailure: null,
  riskOrderingNote: null,
  returns: [],
  returnsFailure: null,
};

export default function RiskPage() {
  return (
    <Suspense
      fallback={
        <main className="max-w-[1320px] mx-auto px-8 pt-7 pb-20">
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
      const [analyticsRes, baseRes, riskRes, returnsRes] = await Promise.all([
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
        supabase
          .from("portfolio_risk")
          .select(RISK_COLUMNS)
          .order("run_date", { ascending: false })
          .limit(1),
        supabase
          .from("portfolio_returns")
          .select(RETURN_COLUMNS)
          .order("run_date", { ascending: true }),
      ]);

      // portfolio_risk.run_date only exists from migration 016. If ordering by it
      // is rejected, fall back to updated_at and say so rather than showing nothing.
      let risk: RiskRow | null =
        (riskRes.data?.[0] as RiskRow | undefined) ?? null;
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
          .limit(1);
        if (!fallback.error) {
          risk = (fallback.data?.[0] as RiskRow | undefined) ?? null;
          riskFailure = null;
          riskOrderingNote =
            `portfolio_risk could not be read as requested (${riskRes.error.code ?? "error"}: ` +
            `${riskRes.error.message}). Showing the most recent row ordered by updated_at instead — ` +
            `apply supabase/migrations/016_portfolio_risk_run_date.sql to restore run_date ordering.`;
        }
      }

      const baseRow = baseRes.data?.[0] as
        | { run_date: string | null; lens: string | null }
        | undefined;
      const analyticsRow =
        (analyticsRes.data?.[0] as ResearchAnalyticsRow | undefined) ?? null;

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
        riskFailure,
        riskOrderingNote,
        returns: (returnsRes.data as ReturnRow[] | null) ?? [],
        returnsFailure: toFailure(
          "portfolio_returns",
          RETURN_COLUMNS,
          returnsRes.error as PostgrestLikeError | null,
        ),
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

  const failures = [
    data.analyticsFailure,
    data.baseFailure,
    data.riskFailure,
    data.returnsFailure,
  ].filter((f): f is QueryFailure => f !== null);

  return (
    <main className="max-w-[1320px] mx-auto px-8 pt-7 pb-20">
      <div className="flex justify-between items-end mb-7 gap-6 flex-wrap">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.01em] m-0 mb-1">
            Book Risk
          </h1>
          <p className="m-0 text-text-secondary text-[13px] max-w-[80ch]">
            Stress scenarios, correlation crowding, cap headroom, factor tilt and
            realised drawdown for the sized long-short book. Every figure is read
            from a persisted pipeline artefact; nothing here is estimated in the
            browser.
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

      {/* 1 — Stress scenarios */}
      <StressScenarios state={scenarioState} />

      {/* 2 — Correlation */}
      <CorrelationMatrix state={correlationState} />

      {/* 3 — Cap utilisation */}
      <CapUtilisation state={capState} />

      {/* 4 — Book factor tilt */}
      <BookFactorTilt state={bookState} />

      {/* 5 — Risk metrics (always rendered) */}
      <RiskMetricsGrid
        loading={data.loading}
        risk={data.risk}
        failure={data.riskFailure}
        orderingNote={data.riskOrderingNote}
      />

      {/* 6 — Drawdown & daily P&L */}
      <DrawdownChart
        loading={data.loading}
        rows={data.returns}
        failure={data.returnsFailure}
      />
    </main>
  );
}
