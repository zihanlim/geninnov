"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import RegimeHero from "@/components/RegimeHero";
import ConvictionCard, { ConvictionTheme } from "@/components/ConvictionCard";
import Watchlist from "@/components/Watchlist";
import ThemeDerivationDrawer from "@/components/ThemeDerivationDrawer";
import ThemeHeatmap from "@/components/ThemeHeatmap";
import MarketBar from "@/components/MarketBar";
import { FreshnessLabel } from "@/components/status/FreshnessLabel";
import { StatusBadge } from "@/components/status/StatusBadge";
import { EmptyState, QueryErrorState } from "@/components/status/EmptyState";
import {
  fetchThemeHistories,
  fetchThemeEdge,
  totalScoredObservations,
  DEFAULT_EDGE_WEIGHTS,
  type ThemeHistory,
  type ThemeEdge,
} from "@/lib/themeSignals";
import {
  fetchThemeProvenance,
  attentionConcentration,
  type ThemeProvenance,
} from "@/lib/themeProvenance";
import type { NumericStatus } from "@/lib/derivations/numeric";

interface Regime {
  cycle: string;
  sentiment: string;
  run_date?: string;
  yield_curve_slope?: number | null;
  hy_oas?: number | null;
  vix_level?: number | null;
  vix_term_diff?: number | null;
  real_rate?: number | null;
  spx_breadth?: number | null;
}

interface Factor {
  name: string;
  beta: number;
}

function fmtDate(d?: string | null) {
  if (!d) return "—";
  return d.slice(0, 10);
}

/**
 * Deterministic regime headline built from the classifier's own inputs.
 *
 * The previous implementation keyed off `regime.narrative`, a column that does
 * not exist on `regime_classifications`. It was therefore always undefined, and
 * the page rendered "Macro regime classification pending" directly beneath a
 * correctly-classified LATE / RISK-ON badge — a self-contradiction on the first
 * screen. This states the classification using only values that are actually
 * persisted, and says "unavailable" when they are not.
 */
function regimeHeadline(r: Regime | null): string {
  if (!r) return "No regime classification for any run date yet.";
  const cycle = r.cycle ?? "unknown";
  const sentiment = r.sentiment ?? "unknown";
  const bits: string[] = [];
  if (typeof r.yield_curve_slope === "number")
    bits.push(`10y−2y at ${r.yield_curve_slope.toFixed(0)}bps`);
  if (typeof r.hy_oas === "number") bits.push(`HY OAS ${r.hy_oas.toFixed(2)}`);
  if (typeof r.vix_level === "number") bits.push(`VIX ${r.vix_level.toFixed(1)}`);
  const evidence = bits.length ? ` on ${bits.join(", ")}` : "";
  return `${cycle[0].toUpperCase()}${cycle.slice(1)}-cycle, ${sentiment}${evidence}.`;
}

function regimeNarrative(r: Regime | null): string {
  if (!r) {
    return "Run the daily pipeline (daily_refresh.py → RegimeClassifier) to populate regime_classifications.";
  }
  const missing = (
    [
      ["yield curve slope", r.yield_curve_slope],
      ["HY OAS", r.hy_oas],
      ["VIX", r.vix_level],
      ["VIX term structure", r.vix_term_diff],
      ["real rate", r.real_rate],
      ["breadth", r.spx_breadth],
    ] as const
  )
    .filter(([, v]) => typeof v !== "number")
    .map(([k]) => k);

  const base =
    "Cycle is classified from the yield curve, HY credit spreads and the real rate; " +
    "sentiment from VIX level and term structure, spreads and breadth. Rule-based and auditable — expand for the thresholds.";
  return missing.length
    ? `${base} ${missing.length} of 6 inputs unavailable this run (${missing.join(", ")}), so the classification rests on the remainder.`
    : base;
}

/** Volatility regime label derived from the persisted VIX inputs. */
function volRegime(r: Regime | null): { label: string; sub: string } {
  const vix = r?.vix_level;
  const term = r?.vix_term_diff;
  if (typeof vix !== "number") return { label: "—", sub: "VIX unavailable this run" };
  const label = vix > 25 ? "STRESSED" : vix > 18 ? "ELEVATED" : "CALM";
  const structure =
    typeof term === "number"
      ? term > 0
        ? `backwardation ${term.toFixed(1)}`
        : `contango ${Math.abs(term).toFixed(1)}`
      : "term structure unavailable";
  return { label, sub: `VIX ${vix.toFixed(1)} · ${structure}` };
}

export default function ConvictionPage() {
  return (
    <Suspense
      fallback={
        <main className="max-w-[1320px] mx-auto px-8 pt-7 pb-20">
          <div className="skeleton h-[180px]" />
        </main>
      }
    >
      <ConvictionPageInner />
    </Suspense>
  );
}

function ConvictionPageInner() {
  const [themes, setThemes] = useState<ConvictionTheme[]>([]);
  const [regime, setRegime] = useState<Regime | null>(null);
  const [factors, setFactors] = useState<Factor[]>([]);
  const [factorCoverage, setFactorCoverage] = useState<number | null>(null);
  const [factorError, setFactorError] = useState<string | null>(null);
  const [themeError, setThemeError] = useState<string | null>(null);
  const [histories, setHistories] = useState<Record<string, ThemeHistory>>({});
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [edges, setEdges] = useState<Record<string, ThemeEdge>>({});
  const [provenance, setProvenance] = useState<Record<string, ThemeProvenance>>({});
  const [abstainThreshold, setAbstainThreshold] = useState<number>(
    DEFAULT_EDGE_WEIGHTS.abstainThreshold
  );
  const [loading, setLoading] = useState(true);
  const [runDate, setRunDate] = useState<string | null>(null);
  const [lastPipelineRun, setLastPipelineRun] = useState<string | null>(null);
  const [drawerTheme, setDrawerTheme] = useState<ConvictionTheme | null>(null);
  const [counts, setCounts] = useState({
    total: 0,
    longCount: 0,
    shortCount: 0,
    avgHype: 0,
    threshold: 50,
    topScore: 0,
  });

  useEffect(() => {
    async function load() {
      const [themesRes, regimeRes, factorsRes, candidateRes, cfgRes, pipeRes] =
        await Promise.all([
          supabase.from("themes").select("*").order("hype_score", { ascending: false }),
          supabase
            .from("regime_classifications")
            .select(
              "cycle, sentiment, run_date, yield_curve_slope, hy_oas, vix_level, vix_term_diff, real_rate, spx_breadth"
            )
            .order("run_date", { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from("portfolio_factor_exposure")
            .select("*")
            .order("run_date", { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase.from("trade_candidates").select("direction, hype_score"),
          supabase.from("scoring_config").select("param_name, value"),
          supabase
            .from("pipeline_runs")
            .select("run_date, finished_at, status")
            .order("run_date", { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);

      if (themesRes.error) setThemeError(themesRes.error.message);
      const rawThemes = (themesRes.data ?? []) as ConvictionTheme[];
      setThemes(rawThemes);
      setRegime((regimeRes.data as Regime) ?? null);
      setRunDate(rawThemes[0]?.updated_at ?? null);
      setLastPipelineRun(
        (pipeRes.data as { finished_at?: string; run_date?: string } | null)
          ?.finished_at ??
          (pipeRes.data as { run_date?: string } | null)?.run_date ??
          null
      );

      // Factor tilt of the book. This reads the `portfolio_factor_exposure`
      // view added in migration 021 — before it existed the query 404d and the
      // panel showed "Awaiting factor run..." while real betas sat unused.
      if (factorsRes.error) {
        setFactorError(factorsRes.error.message);
      } else if (factorsRes.data) {
        const f = factorsRes.data as Record<string, number | null>;
        const FACTOR_KEYS = [
          { key: "beta_mkt", name: "MKT-RF" },
          { key: "beta_smb", name: "SMB" },
          { key: "beta_hml", name: "HML" },
          { key: "beta_rmw", name: "RMW" },
          { key: "beta_cma", name: "CMA" },
          { key: "beta_umd", name: "UMD" },
        ];
        setFactors(
          FACTOR_KEYS.filter((k) => typeof f[k.key] === "number").map((k) => ({
            name: k.name,
            beta: Number(f[k.key]),
          }))
        );
        setFactorCoverage(
          typeof f.coverage === "number" ? Number(f.coverage) : null
        );
      }

      // Real attention history — drives deltas, sparklines and percentiles.
      // Plus the resolved EdgeScore direction (the trade the theme implies) and
      // the signal provenance (real / mock / mixed) per theme.
      const ids = rawThemes.map((t) => t.id).filter(Boolean);
      const [
        { byTheme, error: histErr },
        { byTheme: edgeByTheme },
        { byTheme: provByTheme },
      ] = await Promise.all([
        fetchThemeHistories(ids, 30),
        fetchThemeEdge(ids),
        fetchThemeProvenance(ids),
      ]);
      setHistories(byTheme);
      setHistoryError(histErr);
      setEdges(edgeByTheme);
      setProvenance(provByTheme);

      const cfg = Object.fromEntries(
        ((cfgRes.data ?? []) as { param_name: string; value: string }[]).map(
          (r) => [r.param_name, Number(r.value)]
        )
      );
      // Live abstain threshold — never hardcode. Falls back to the migration
      // default only when scoring_config has no row for it.
      if (Number.isFinite(cfg.edge_abstain_threshold)) {
        setAbstainThreshold(cfg.edge_abstain_threshold);
      }
      const cands = (candidateRes.data ?? []) as {
        direction: string;
        hype_score: number;
      }[];

      setCounts({
        total: rawThemes.length,
        longCount: cands.filter((c) => c.direction === "long").length,
        shortCount: cands.filter((c) => c.direction === "short").length,
        avgHype:
          rawThemes.length > 0
            ? rawThemes.reduce((s, t) => s + (t.hype_score ?? 0), 0) /
              rawThemes.length
            : 0,
        threshold: Number.isFinite(cfg.hype_score_threshold)
          ? cfg.hype_score_threshold
          : 50,
        topScore: rawThemes[0]?.hype_score ?? 0,
      });
      setLoading(false);
    }
    load();
  }, []);

  // Attach real history to each theme. `delta_1d` and `history` come from
  // theme_signals_history — previously `delta_1d` was never populated and the
  // watchlist delta was `hype_score - momentum_score * 0.1`, a quantity with no
  // meaning. Themes with no scored history keep `undefined`, which renders "—".
  const enriched = useMemo<ConvictionTheme[]>(
    () =>
      themes.map((t) => {
        const h = histories[t.id];
        return {
          ...t,
          delta_1d: h?.delta1d ?? undefined,
          mention_count_1d: h?.latestMentionCount ?? null,
          history: h && h.hypeSeries.length >= 2 ? h.hypeSeries : undefined,
          crowding_pct:
            h?.percentile === null || h?.percentile === undefined
              ? undefined
              : h.percentile,
          history_obs: h?.hypeSeries.length ?? 0,
          crowding:
            h?.percentile === null || h?.percentile === undefined
              ? undefined
              : h.percentile >= 80
                ? "high"
                : h.percentile <= 20
                  ? "low"
                  : "healthy",
        };
      }),
    [themes, histories]
  );

  const top3 = useMemo(() => enriched.slice(0, 3), [enriched]);
  const watchlistItems = useMemo(
    () =>
      enriched.slice(0, 7).map((t) => ({
        name: t.name,
        score: t.hype_score ?? 0,
        delta: t.delta_1d ?? null,
      })),
    [enriched]
  );

  const scoredObs = totalScoredObservations(histories);
  const vol = volRegime(regime);

  // Attention concentration — the attention analogue of the book's HHI.
  // Answers "is attention itself crowding into a few themes today?".
  const attn = useMemo(
    () => attentionConcentration(themes.map((t) => t.hype_score)),
    [themes]
  );

  const observed_age_seconds = runDate
    ? Math.max(0, Math.floor((Date.now() - new Date(runDate).getTime()) / 1000))
    : Number.POSITIVE_INFINITY;
  const runDateStatus: NumericStatus =
    !Number.isFinite(observed_age_seconds)
      ? "unavailable"
      : observed_age_seconds > 86400 * 2
        ? "stale"
        : observed_age_seconds > 86400
          ? "estimated"
          : "exact";
  const dashboardStatus: NumericStatus = [
    themes.length > 0 ? ("exact" as NumericStatus) : ("unavailable" as NumericStatus),
    regime ? ("exact" as NumericStatus) : ("unavailable" as NumericStatus),
    runDateStatus,
  ].reduce<NumericStatus>(
    (worst, cur) => (severity(cur) > severity(worst) ? cur : worst),
    "exact"
  );

  return (
    <main className="max-w-[1320px] mx-auto px-8 pt-7 pb-20">
      <div className="flex justify-between items-end mb-7 gap-4 flex-wrap">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.01em] m-0 mb-1">
            What we&apos;re watching
          </h1>
          <p className="m-0 text-text-secondary text-[13px]">
            Theme attention, macro regime, and book tilt.{" "}
            <span className="text-text-tertiary text-[12px]">
              Click any theme for its score derivation.
            </span>
          </p>
        </div>
        <div className="text-right text-text-secondary text-[12px]">
          <div className="flex items-center justify-end gap-3 mb-2">
            <StatusBadge status={dashboardStatus} />
          </div>
          <div className="mt-1">
            <span className="text-text-tertiary mr-1.5">RUN DATE</span>
            <span className="num">{fmtDate(runDate)}</span>
            {Number.isFinite(observed_age_seconds) && (
              <span className="ml-2" data-testid="updated-label">
                <FreshnessLabel observed_age_seconds={observed_age_seconds} />
              </span>
            )}
          </div>
          <div className="mt-1">
            <span className="text-text-tertiary mr-1.5">LAST PIPELINE RUN</span>
            <span className="num">{fmtDate(lastPipelineRun)}</span>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          <div className="skeleton h-[180px]" />
          <div className="grid grid-cols-3 gap-4">
            <div className="skeleton h-[260px]" />
            <div className="skeleton h-[260px]" />
            <div className="skeleton h-[260px]" />
          </div>
        </div>
      ) : (
        <>
          <MarketBar />
          <RegimeHero
            cycle={regime?.cycle ?? "—"}
            sentiment={regime?.sentiment ?? "—"}
            headline={regimeHeadline(regime)}
            narrative={regimeNarrative(regime)}
            cycleSubtext={
              typeof regime?.yield_curve_slope === "number"
                ? `10y−2y ${regime.yield_curve_slope.toFixed(0)}bps${
                    typeof regime?.real_rate === "number"
                      ? ` · real rate ${regime.real_rate.toFixed(2)}%`
                      : ""
                  }`
                : "Curve inputs unavailable this run"
            }
            volLabel={vol.label}
            volSubtext={vol.sub}
            factors={factors}
            factorCoverage={factorCoverage}
            factorUnavailableReason={
              factorError
                ? `portfolio_factor_exposure query failed: ${factorError}`
                : factors.length === 0
                  ? "No sized positions yet, so the book has no factor tilt to report."
                  : undefined
            }
            runDate={regime?.run_date}
          />

          <div className="mb-6">
            {themeError ? (
              <QueryErrorState
                what="Themes"
                message={themeError}
                source="themes"
              />
            ) : themes.length === 0 ? (
              <div className="card">
                <EmptyState
                  title="No themes in the registry"
                  cause="The themes table returned no rows, so there is no attention signal to rank."
                  remedy="Run scripts/theme_discovery.py to bootstrap the registry, then scripts/daily_refresh.py to score it."
                  source="themes"
                />
              </div>
            ) : (
              <ThemeHeatmap
                themes={enriched}
                onSelect={setDrawerTheme}
                edgeByTheme={edges}
                abstainThreshold={abstainThreshold}
                provByTheme={provenance}
              />
            )}
          </div>

          {historyError && (
            <div className="card mb-6">
              <QueryErrorState
                what="Theme attention history"
                message={historyError}
                source="theme_signals_history"
              />
            </div>
          )}
          {!historyError && themes.length > 0 && scoredObs === 0 && (
            <div className="card mb-6">
              <EmptyState
                title="No attention history — deltas and trends unavailable"
                cause={`theme_signals_history has no rows with a populated hype_score, so there is nothing to compare today against. Every Δ and sparkline on this page is therefore blank rather than zero.`}
                remedy="Backfill theme_signals_history.hype_score, then each subsequent daily run extends the series."
                source="theme_signals_history.hype_score"
                severity="warning"
                compact
              />
            </div>
          )}

          <div className="flex items-baseline justify-between mb-3.5">
            <h2 className="text-[16px] font-semibold m-0">
              Top {Math.min(3, top3.length)} themes by attention
            </h2>
            <span className="text-text-secondary text-[12px]">
              Ranked by HypeScore · volume, sentiment, |ρ| and momentum
            </span>
          </div>
          {top3.length === 0 ? (
            <div className="card mb-8">
              <EmptyState
                title="No themes to rank"
                cause="No theme carries a HypeScore for the latest run."
                remedy="Run scripts/daily_refresh.py."
                source="themes.hype_score"
              />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
              {top3.map((t, i) => (
                <ConvictionCard
                  key={t.id}
                  rank={i + 1}
                  theme={t}
                  hero={i === 0}
                  onOpenDerivation={setDrawerTheme}
                  edge={edges[t.id]}
                  abstainThreshold={abstainThreshold}
                  provenance={provenance[t.id]}
                />
              ))}
            </div>
          )}

          <div className="flex items-baseline justify-between mb-3.5">
            <h2 className="text-[16px] font-semibold m-0">
              Watchlist · emerging or fading
            </h2>
            <Link
              href="/book"
              className="text-text-secondary text-[12px] hover:text-text-primary"
            >
              View the book →
            </Link>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4">
            <div className="card">
              <div className="card-header">
                <span className="card-title">Theme momentum</span>
                <span className="num text-text-tertiary text-[11px]">
                  HypeScore · Δ vs prior run
                </span>
              </div>
              <div className="card-body pt-2">
                {watchlistItems.length > 0 ? (
                  <Watchlist items={watchlistItems} />
                ) : (
                  <EmptyState
                    title="Nothing on the watchlist"
                    cause="No themes are scored for the latest run."
                    source="themes"
                    compact
                  />
                )}
              </div>
            </div>
            <div className="card">
              <div className="card-header">
                <span className="card-title">Screening</span>
              </div>
              <div className="card-body flex flex-col gap-3.5">
                <Stat
                  label="Themes tracked"
                  value={String(counts.total)}
                  sub="Active in the registry"
                />
                <Stat
                  label="Long / short candidates"
                  value={`${counts.longCount} / ${counts.shortCount}`}
                  sub={`Above the HypeScore ${counts.threshold} threshold`}
                />
                <Stat
                  label="Avg HypeScore"
                  value={counts.avgHype.toFixed(1)}
                  sub={`Top theme at ${counts.topScore.toFixed(1)}`}
                />
                <Stat
                  label="Attention concentration"
                  value={
                    attn.top3Share === null
                      ? "—"
                      : `${(attn.top3Share * 100).toFixed(0)}%`
                  }
                  sub={
                    attn.hhi === null
                      ? "Need ≥2 scored themes to measure crowding"
                      : `Top-3 share of HypeScore · HHI ${attn.hhi.toFixed(
                          2
                        )} ≈ ${
                          attn.effectiveThemes
                            ? attn.effectiveThemes.toFixed(1)
                            : "—"
                        } effective themes`
                  }
                />
                {attn.hhi !== null && attn.hhi >= 0.25 && (
                  <div
                    className="rounded-[6px] border px-3 py-2.5 text-[12px] leading-[1.6]"
                    style={{
                      borderColor: "var(--warning)",
                      background: "var(--bg-elevated)",
                      color: "var(--text-secondary)",
                    }}
                  >
                    <span className="text-warning font-semibold">
                      Attention is crowded.
                    </span>{" "}
                    The top 3 themes hold{" "}
                    <span className="num text-text-primary">
                      {((attn.top3Share ?? 0) * 100).toFixed(0)}%
                    </span>{" "}
                    of all HypeScore across{" "}
                    <span className="num text-text-primary">
                      {attn.scoredCount}
                    </span>{" "}
                    scored themes (HHI{" "}
                    <span className="num text-text-primary">
                      {attn.hhi.toFixed(2)}
                    </span>
                    ) — today&apos;s attention is spread across only{" "}
                    <span className="num text-text-primary">
                      {attn.effectiveThemes?.toFixed(1) ?? "—"}
                    </span>{" "}
                    effective themes. The attention analogue of the book&apos;s
                    concentration HHI.
                  </div>
                )}
                {counts.longCount + counts.shortCount === 0 && counts.total > 0 && (
                  <div
                    className="rounded-[6px] border px-3 py-2.5 text-[12px] leading-[1.6]"
                    style={{
                      borderColor: "var(--warning)",
                      background: "var(--bg-elevated)",
                      color: "var(--text-secondary)",
                    }}
                  >
                    <span className="text-warning font-semibold">
                      No candidates cleared screening.
                    </span>{" "}
                    The highest HypeScore is{" "}
                    <span className="num text-text-primary">
                      {counts.topScore.toFixed(1)}
                    </span>{" "}
                    against a threshold of{" "}
                    <span className="num text-text-primary">
                      {counts.threshold}
                    </span>{" "}
                    — short by{" "}
                    <span className="num text-text-primary">
                      {(counts.threshold - counts.topScore).toFixed(1)}
                    </span>
                    . HypeScore is min-max normalised across the theme set each
                    day, so it is a relative measure gated by an absolute
                    threshold. Adjust{" "}
                    <code className="num">scoring_config.hype_score_threshold</code>{" "}
                    or widen the theme set.
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      <ThemeDerivationDrawer
        theme={drawerTheme}
        open={drawerTheme !== null}
        onClose={() => setDrawerTheme(null)}
      />
    </main>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div>
      <div className="text-[11px] text-text-tertiary uppercase tracking-[0.1em] mb-1">
        {label}
      </div>
      <div className="num text-[22px] font-semibold leading-[1.1]">{value}</div>
      {sub && <div className="text-[11px] text-text-secondary mt-0.5">{sub}</div>}
    </div>
  );
}

// Higher number = worse provenance.
function severity(s: NumericStatus): number {
  switch (s) {
    case "exact":
      return 0;
    case "estimated":
      return 1;
    case "stale":
      return 2;
    case "unverified":
      return 3;
    case "unavailable":
      return 4;
    default:
      return 5;
  }
}
