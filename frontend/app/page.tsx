"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { DEFAULT_LENS, isLens } from "@/lib/book/lensView";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import RegimeHero from "@/components/RegimeHero";
import MacroCrossCurrents, { type CrossCurrents } from "@/components/MacroCrossCurrents";
import ConvictionCard, { type ConvictionTheme } from "@/components/ConvictionCard";
import Watchlist from "@/components/Watchlist";
import ThemeDerivationDrawer from "@/components/ThemeDerivationDrawer";
import ThemeHeatmap from "@/components/ThemeHeatmap";
import TerminalPane from "@/components/home/TerminalPane";
import DiscoveredThemes from "@/components/DiscoveredThemes";
import AttentionFunnel from "@/components/AttentionFunnel";
import NarrativeTrends from "@/components/NarrativeTrends";
import AnswerRow from "@/components/AnswerRow";
import { alphaAnswerCards } from "@/components/home/AlphaAnswerCards";
import { useNarrativeSeries } from "@/lib/useNarrativeSeries";
import ThemeTrends from "@/components/ThemeTrends";
import PredictionMarkets from "@/components/PredictionMarkets";
import MarketBar from "@/components/MarketBar";
import { FreshnessLabel } from "@/components/status/FreshnessLabel";
import { NewsFeed } from "@/components/news/NewsFeed";
import { NewsRibbon } from "@/components/news/NewsRibbon";
import { fetchLatestNews, type NewsItem } from "@/lib/news";
import { StatusBadge } from "@/components/status/StatusBadge";
import PageHeader from "@/components/PageHeader";
import { EmptyState, QueryErrorState } from "@/components/status/EmptyState";
import { resolveRunDates, ageSeconds } from "@/lib/homeFreshness";
import { formatSlopeBps } from "@/lib/regimeUnits";
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
  // ADR-0139/0140 cross-current readings (nullable — absence is "cannot say")
  debasement_pressure?: number | null;
  debasement_real_yield_comp?: number | null;
  debasement_dxy_decline_comp?: number | null;
  debasement_gold_rise_comp?: number | null;
  debasement_comovement_comp?: number | null;
  debasement_lookback_weeks?: number | null;
  fed_posture?: string | null;
  fed_pivot_delta?: number | null;
  fed_rate_change_13w_bps?: number | null;
  fed_curve_change_13w_bps?: number | null;
  fed_curve_steepness_bps?: number | null;
  fed_posture_evidence?: CrossCurrents["fed_posture_evidence"];
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
  // yield_curve_slope and hy_oas are persisted in PERCENTAGE POINTS (DGS10−DGS2 =
  // 0.36, BAMLH0A0HYM2 = 2.77), the same unit as the underlying FRED yields. The
  // curve is quoted in basis points, so formatSlopeBps scales it (0.36pp → 36bps);
  // rendering it raw printed "0bps" over a +36bps curve. HY OAS keeps percent and
  // gets its unit so "2.77" is not mistaken for bps.
  if (typeof r.yield_curve_slope === "number")
    bits.push(`10y−2y at ${formatSlopeBps(r.yield_curve_slope)}`);
  if (typeof r.hy_oas === "number") bits.push(`HY OAS ${r.hy_oas.toFixed(2)}%`);
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
        <main className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 wide:px-5 pt-7 pb-20">
          <div className="skeleton h-[180px]" />
        </main>
      }
    >
      <ConvictionPageInner />
    </Suspense>
  );
}

function ConvictionPageInner() {
  // This page is pinned to the multi-asset book and has no lens control: `?lens=`
  // reaches it only by a bookmark, a shared link, or a machine reading llms.txt,
  // since SideRail navigation emits bare routes. When it DOES arrive, the factor
  // tilt below is the multi-asset book's and says so. Null on every ordinary
  // visit, so the default homepage is byte-identical. Safe here without a new
  // boundary: `ConvictionPage` already wraps this component in <Suspense>.
  const lensParam = useSearchParams().get("lens");
  const otherBook =
    isLens(lensParam) && lensParam !== DEFAULT_LENS ? lensParam : null;
  // theme_ids the PUBLISHED BOOK holds, so a "positions →" link can only promise
  // positions that exist. Undefined until the read lands, which the link treats as
  // "unknown" rather than "none".
  //
  // From `research_recommendations.picks`, NOT `portfolio_positions` — the trap
  // AbstentionRoster documents: L1 writes its full candidate pool to positions first
  // and the pipeline reconciles it down only after L5, so for the several minutes that
  // takes every theme looks held. The book of record is the published picks (ADR-0040).
  const [heldThemeIds, setHeldThemeIds] = useState<Set<string> | undefined>(undefined);
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
  /** Newest headline per theme, for the card. Fetched once here rather than
   *  per-card: eight cards each reading theme_news would be eight round-trips
   *  for one table. The ribbon and feed below read it independently because
   *  they are self-contained sections. */
  const [topHeadlineByTheme, setTopHeadlineByTheme] = useState<
    Record<string, NewsItem>
  >({});
  // One read of narrative_signals for the whole page. `NarrativeTrends` and
  // `AttentionFunnel` each called `useNarrativeSeries` themselves, so this route
  // queried the table TWICE and the two cards could still land on different rows —
  // ADR-0168 unified which corpus they ask for and left the double read in place.
  // The answer row needs the same series, which would have made it three.
  const narratives = useNarrativeSeries();

  const [abstainThreshold, setAbstainThreshold] = useState<number>(
    DEFAULT_EDGE_WEIGHTS.abstainThreshold
  );
  const [loading, setLoading] = useState(true);
  const [runDate, setRunDate] = useState<string | null>(null);
  const [lastPipelineRun, setLastPipelineRun] = useState<string | null>(null);
  // Wall-clock time the pipeline finished, used ONLY for the "Updated Nm ago"
  // freshness age — kept apart from runDate, which is the forward-dated run_date the
  // rest of the site labels the data with (see the RUN DATE fix below).
  const [pipelineFinishedAt, setPipelineFinishedAt] = useState<string | null>(null);
  const [drawerTheme, setDrawerTheme] = useState<ConvictionTheme | null>(null);
  const [counts, setCounts] = useState({
    total: 0,
    longCount: 0,
    shortCount: 0,
    aboveThreshold: 0,
    avgHype: 0,
    // How many themes the average is actually over. Printed, because "Avg
    // HypeScore 57.8" over 8 of 9 themes is a different claim from the same
    // number over 9 of 9, and the strip cannot say which without it.
    scoredCount: 0,
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
              "cycle, sentiment, run_date, yield_curve_slope, hy_oas, vix_level, vix_term_diff, real_rate, spx_breadth, debasement_pressure, debasement_real_yield_comp, debasement_dxy_decline_comp, debasement_gold_rise_comp, debasement_comovement_comp, debasement_lookback_weeks, fed_posture, fed_pivot_delta, fed_rate_change_13w_bps, fed_curve_change_13w_bps, fed_curve_steepness_bps, fed_posture_evidence"
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
      // RUN DATE is the run's canonical run_date — the date the data is FOR, the same
      // identifier the status bar, /method and /book all show. It was sourced from
      // `themes.updated_at`, a write timestamp that lags the run_date: on 2026-07-25
      // the row held the 07-25 hype scores (US Election 60.1) but updated_at read
      // 2026-07-24T20:13, so the landing page dated the current run 2026-07-24 —
      // contradicting its own status bar three lines below ("Last run 2026-07-25").
      const pipe = pipeRes.data as
        | { finished_at?: string; run_date?: string }
        | null;
      const dates = resolveRunDates({
        pipeRunDate: pipe?.run_date,
        pipeFinishedAt: pipe?.finished_at,
        themeUpdatedAt: rawThemes[0]?.updated_at,
      });
      setRunDate(dates.display);
      // LAST PIPELINE RUN is the same run, so it shows the same canonical date rather
      // than finished_at (the execution wall-clock, which is what made it read 07-24).
      setLastPipelineRun(dates.display);
      setPipelineFinishedAt(dates.freshnessTs);

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
        bookPicksRes,
      ] = await Promise.all([
        fetchThemeHistories(ids, 30),
        fetchThemeEdge(ids),
        fetchThemeProvenance(ids),
        // Lens-pinned like every other read here (migration 062 keyed this table on
        // (run_date, lens); this page describes the multi-asset book).
        supabase
          .from("research_recommendations")
          .select("picks")
          .eq("lens", "multi_asset")
          .order("run_date", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      // Left undefined on a read error: "the query failed" is not "the book holds
      // nothing in this theme", and the link must not render the second for the first.
      if (!bookPicksRes.error && bookPicksRes.data) {
        const raw = (bookPicksRes.data as { picks: unknown }).picks;
        const picks = (typeof raw === "string" ? JSON.parse(raw || "[]") : raw) as
          | Array<{ theme_id?: string | null }>
          | null;
        if (Array.isArray(picks)) {
          setHeldThemeIds(
            new Set(
              picks.map((p) => p.theme_id).filter((t): t is string => Boolean(t)),
            ),
          );
        }
      }
      setHistories(byTheme);
      setHistoryError(histErr);
      setEdges(edgeByTheme);
      setProvenance(provByTheme);

      // Newest headline per theme. fetchLatestNews already returns the latest
      // run's rows sorted newest-first, so the FIRST hit per theme is the one
      // to show — no sort needed here.
      const news = await fetchLatestNews(120);
      const byThemeHeadline: Record<string, NewsItem> = {};
      for (const it of news.items) {
        if (!it.theme_id || byThemeHeadline[it.theme_id]) continue;
        byThemeHeadline[it.theme_id] = it;
      }
      setTopHeadlineByTheme(byThemeHeadline);

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

      const hypeGate = Number.isFinite(cfg.hype_score_threshold)
        ? cfg.hype_score_threshold
        : 50;
      // A theme is SCORED only once a pipeline run has written its HypeScore.
      // A theme created between runs has NULL across every sub-score, and NULL
      // is not a low score — it is the absence of one (ADR-0066).
      const scoredThemes = rawThemes.filter(
        (t) => typeof t.hype_score === "number" && Number.isFinite(t.hype_score),
      );
      setCounts({
        total: rawThemes.length,
        longCount: cands.filter((c) => c.direction === "long").length,
        shortCount: cands.filter((c) => c.direction === "short").length,
        // How many THEMES actually cleared the hype gate. The candidate counts
        // above are sized names, which is a different quantity entirely — a side
        // is frequently filled by backfilling the strongest SUB-threshold theme
        // (ADR-0029), so "candidates" and "above the gate" routinely disagree.
        aboveThreshold: rawThemes.filter((t) => (t.hype_score ?? 0) >= hypeGate)
          .length,
        // Averaged over the SCORED themes, not over every row.
        //
        // `reduce(s + (t.hype_score ?? 0)) / rawThemes.length` counted a theme
        // that no run has scored yet as a zero in the numerator AND as a member
        // of the denominator, so one unscored theme dragged the board average
        // down twice over. Live on 2026-07-28: eight scored themes average 57.8,
        // and adding AI Capex — created between two pipeline runs (ADR-0129) and
        // therefore NULL, not 0 — printed 51.4. That is not a low reading, it is
        // a reading of a theme that was never measured.
        avgHype:
          scoredThemes.length > 0
            ? scoredThemes.reduce((s, t) => s + (t.hype_score as number), 0) /
              scoredThemes.length
            : 0,
        scoredCount: scoredThemes.length,
        threshold: Number.isFinite(cfg.hype_score_threshold)
          ? cfg.hype_score_threshold
          : 50,
        // The query orders by hype_score desc with NULLs sorted by Postgres'
        // default (NULLS LAST on DESC), so rawThemes[0] is the top SCORED theme —
        // but read it from the filtered list rather than relying on that.
        topScore: scoredThemes[0]?.hype_score ?? 0,
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
          mention_count_7d_avg: h?.latestMention7dAvg ?? null,
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
      // Unscored themes are omitted from the watchlist rather than listed at 0.
      // A watchlist row IS a ranking claim, and a theme no run has scored has no
      // rank — showing it bottom at "0" asserts a measurement nobody made.
      enriched
        .filter((t) => typeof t.hype_score === "number" && Number.isFinite(t.hype_score))
        .slice(0, 7)
        .map((t) => ({
          name: t.name,
          score: t.hype_score as number,
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

  // Age is measured from the pipeline's finish TIMESTAMP, not runDate — runDate is
  // now the forward-dated run_date ("2026-07-25"), and `new Date("2026-07-25")` is in
  // the future relative to the ~20:13 UTC finish, which would clamp the age to 0 and
  // read "just now" over data that is hours old.
  const observed_age_seconds = ageSeconds(pipelineFinishedAt, Date.now());
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
    // The viewport lock from ADR-0103 is GONE, at the owner's direction. It made
    // every pane guess a height for content it could not measure, and the guesses
    // clipped: the regime pane truncated "FACTOR TILT OF BOO" and printed its
    // factor betas as "+0"/"-0" behind two scrollbars, and six panes each owned a
    // scroll context on one screen. A grid whose rows size to their content, on a
    // page that scrolls once, shows the same material without cutting any of it —
    // which is design goal 7's original position, restored.
    <main className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 wide:px-5 pt-4 pb-20">
      <PageHeader
        title="What we're watching"
        // Eleven words became a paragraph when the shared header gave this page
        // the same 14.5px lede every other route already had (ADR-0189). Phase 2
        // is where an idea ENTERS the process, and the two things a reader most
        // needs before reading a score are what it is made of and what it does
        // not claim — both were only available further down, inside the answer
        // cards, which is after the board they qualify.
        lede={
          <>
            Where an idea enters the process. Themes scored on attention, sentiment,
            market correlation and momentum; the narratives the daily tracker
            surfaced without being told to look for them; and the macro regime and
            factor tilt the book is built into. A high score means a theme is{" "}
            <em>loud</em>, not that it is right — nothing on this page is a position.
          </>
        }
        fine={
          <>
            Click any theme for its score derivation. The narrative board below is a
            detector rather than a book: it sizes nothing, and a phrase on it is a
            candidate for a theme, not a trade (ADR-0128).
          </>
        }
        aside={<StatusBadge status={dashboardStatus} />}
        meta={[
          {
            label: "Run date",
            value: (
              <>
                {fmtDate(runDate)}
                {Number.isFinite(observed_age_seconds) && (
                  <span className="ml-2" data-testid="updated-label">
                    <FreshnessLabel
                      observed_age_seconds={observed_age_seconds}
                      // pipelineFinishedAt, not runDate — for the reason spelled
                      // out where observed_age_seconds is computed above. The
                      // timestamp behind the label must be the one the age was
                      // measured from, or the tooltip contradicts the words next
                      // to it.
                      observed_at={pipelineFinishedAt}
                    />
                  </span>
                )}
              </>
            ),
          },
          { label: "Last pipeline run", value: fmtDate(lastPipelineRun) },
        ]}
      />

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
          {/* The four questions phase 2 asks, before the 420 numerals below them
              (ADR-0172). ABOVE MarketBar and the ribbon deliberately: those are
              context a reader glances at, and this is the page's own answer. */}
          <AnswerRow
            cards={alphaAnswerCards({
              themes,
              series: narratives.series,
              seriesError: narratives.error,
              aboveThreshold: loading ? null : counts.aboveThreshold,
              totalThemes: loading ? null : counts.total,
              hypeGate: counts.threshold,
            })}
          />

          <div className="shrink-0">
            <MarketBar />
          </div>
          {/* RESTORED at the owner's explicit direction, over ADR-0103's
              "the redundancy dies first".
              ADR-0103 removed it as a second rendering of the HEADLINES pane's
              data. That argument is sound only if the pane is genuinely always
              on screen — and measured, the pane is an inner scroller holding
              1,292px of content in a 482px box, so most of its list is no more
              visible than the old feed was. The ribbon and the pane answer
              different questions: the ribbon is "what broke today" at a glance
              in one line, the pane is "read the list". Keeping both is the
              owner's call and is recorded here so it is not re-litigated as an
              oversight. */}
          <div className="shrink-0">
            <NewsRibbon />
          </div>

          {/* ── Macro regime: a full-width banner, back at the top ───────────
              ADR-0103 demoted this into a grid cell on the argument that it is
              "context, not chrome". In a cell it had neither the width nor the
              height for what it carries: at 1920 it rendered "FACTOR TILT OF
              BOO", printed five factor betas as "+0"/"-0", and carried a
              vertical AND a horizontal scrollbar inside one card.
              It is the orientation every number below is read against — the
              regime decides what a LONG even means — so it goes first, at full
              width, where its three columns fit. Restored at the owner's
              direction. */}
          <div className="mb-4">
            <RegimeHero
              otherBook={otherBook}
              cycle={regime?.cycle ?? "—"}
              sentiment={regime?.sentiment ?? "—"}
              headline={regimeHeadline(regime)}
              narrative={regimeNarrative(regime)}
              cycleSubtext={
                typeof regime?.yield_curve_slope === "number"
                  ? `10y−2y ${formatSlopeBps(regime.yield_curve_slope)}${
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
          </div>

          {/* ── Macro cross-currents: the ADR-0139/0140 readings ────────────
              Immediately under the hero, because these answer the question
              cycle × sentiment cannot: is the dollar being structurally
              eroded, and which way is the Fed leaning? Shadow lifted early
              at the operator's direction (2026-07-28) — the chronological
              backfill had already validated shape and NULL semantics over
              270 real rows, which is what the 14-day accrual existed to do. */}
          <div className="mb-4">
            <MacroCrossCurrents cycle={regime?.cycle ?? null} cc={regime ?? null} />
          </div>

          {/* ── Screening: four aggregates, as a strip rather than a pane ────
              These are single figures, not a list — a pane would give them a
              scroller they never need and cost the grid a cell. The crowding
              warning stays inline because it is prose about the figure beside
              it (design goal 6), not a separate finding. */}
          <div className="shrink-0 card px-4 py-2.5 flex flex-wrap items-center gap-x-7 gap-y-2 mb-4">
            <StripStat label="Themes tracked" value={String(counts.total)} />
            <StripStat
              label="Long / short"
              value={`${counts.longCount} / ${counts.shortCount}`}
              sub={`${counts.aboveThreshold} of ${counts.total} cleared ${counts.threshold}`}
            />
            <StripStat
              label="Avg HypeScore"
              value={counts.avgHype.toFixed(1)}
              sub={
                counts.scoredCount < counts.total
                  ? `top ${counts.topScore.toFixed(1)} · ${counts.scoredCount} of ${counts.total} scored`
                  : `top ${counts.topScore.toFixed(1)}`
              }
            />
            <StripStat
              label="Attention concentration"
              value={attn.top3Share === null ? "—" : `${(attn.top3Share * 100).toFixed(0)}%`}
              sub={
                attn.hhi === null
                  ? "need ≥2 scored themes"
                  : `top-3 share · HHI ${attn.hhi.toFixed(2)} ≈ ${
                      attn.effectiveThemes ? attn.effectiveThemes.toFixed(1) : "—"
                    } effective`
              }
            />
            {attn.hhi !== null && attn.hhi >= 0.25 && (
              <span className="text-[11.5px] leading-[1.5] text-text-secondary">
                <span className="text-warning font-semibold">Attention is crowded.</span>{" "}
                Spread across only{" "}
                <span className="num text-text-primary">
                  {attn.effectiveThemes?.toFixed(1) ?? "—"}
                </span>{" "}
                effective themes — the attention analogue of the book&apos;s
                concentration HHI.
              </span>
            )}
            {counts.longCount + counts.shortCount === 0 && counts.total > 0 && (
              <span className="text-[11.5px] leading-[1.5] text-text-secondary">
                <span className="text-warning font-semibold">
                  No candidates cleared screening.
                </span>{" "}
                Top HypeScore{" "}
                <span className="num text-text-primary">{counts.topScore.toFixed(1)}</span>{" "}
                against a threshold of{" "}
                <span className="num text-text-primary">{counts.threshold}</span> — short
                by{" "}
                <span className="num text-text-primary">
                  {(counts.threshold - counts.topScore).toFixed(1)}
                </span>
                . Adjust <code className="num">scoring_config.hype_score_threshold</code>{" "}
                or widen the theme set.
              </span>
            )}
          </div>

          {/* ── The pane grid ────────────────────────────────────────────────
              Rows are `auto`, not `minmax(0,Nfr)`. Fractional rows divide a fixed
              height between panes and force every one of them to clip whatever
              does not fit; `auto` lets each row be as tall as its tallest pane,
              so a card shows its content instead of a scrollbar. `items-start`
              stops a short pane from stretching to match a tall neighbour.

              PLACEMENT IS EXPLICIT, and has to be. Auto-flow cannot fit a
              2-column pane after a 1-column one: with `themes` spanning 2x2 and
              the other three flowing, `discovery` was pushed to row 3 column 1
              and left columns 2-3 of that row empty -- an 891x731 hole at 1440,
              beside a card squeezed into 437px. The 2-row span made it worse:
              `items-start` meant `themes` (1450px) never filled the 1868px its
              span reserved, so a 435px void sat under it (576px at 1024).
              Measured, ~30% of the grid was empty.

              `items-start` IS STILL THE DEFAULT, but four panes now opt out with
              `self-stretch`. The two are not in tension: `items-start` exists so a
              pane never stretches to match a TALLER pane it has nothing to do with,
              and `self-stretch` is for panes that are deliberately paired across the
              grid and must share an edge. Where a pane opts in, the card inside it
              carries `lg:h-full` (or a `lg:flex-1` absorber) as well -- stretching a
              pane without stretching its card moves the ragged edge inward instead of
              removing it, which is the trap this page fell into twice.

              The five panes sit on three rows; see the map above `headlines` below.
              Below lg none of this applies and they stack in DOM order. */}
          <div className="lg:grid lg:grid-cols-3 lg:auto-rows-auto lg:items-stretch lg:gap-4">

          <TerminalPane
            id="themes"
            title="Theme scores"
            bare
            className="lg:col-span-2 lg:col-start-1 lg:row-start-1 lg:self-stretch"
          >
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
                heldThemeIds={heldThemeIds}
                themes={enriched}
                onSelect={setDrawerTheme}
                edgeByTheme={edges}
                abstainThreshold={abstainThreshold}
                provByTheme={provenance}
              />
            )}

            {/* RESTORED (user directive, 2026-07-27: "dont drop information").
                ADR-0103 deleted these two as duplicate renderings of the heatmap. The
                score BARS were duplicates; these blocks also carried things the table
                does not -- the rank-over-time sparkline, the derive affordance, and the
                per-theme momentum ordering. Cutting the whole block to remove the
                duplicated half was too blunt.

                They live INSIDE the scores pane rather than back on the page, which is
                what makes both things true at once: nothing is dropped, and the page is
                still one viewport. The pane scrolls; the document does not. That is the
                property ADR-0103 bought and the reason the content can come back without
                the 4.7 screens coming back with it. */}
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
            /* `lg:flex-1` makes this row of cards the pane's ABSORBER: row 1 is as
               tall as the taller of this pane and the news feed beside it, and
               whichever is shorter would otherwise end early and leave the two
               columns visibly ragged. The conviction cards grow into the slack
               instead, so their bottom edge meets the feed's. `mb-8` is gone —
               `Theme momentum` is its own grid row now and the grid gap spaces it. */
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 lg:flex-1">
              {top3.map((t, i) => (
                <ConvictionCard
                  heldThemeIds={heldThemeIds}
                  key={t.id}
                  rank={i + 1}
                  theme={t}
                  hero={i === 0}
                  onOpenDerivation={setDrawerTheme}
                  edge={edges[t.id]}
                  abstainThreshold={abstainThreshold}
                  provenance={provenance[t.id]}
                  topHeadline={topHeadlineByTheme[t.id] ?? null}
                />
              ))}
            </div>
          )}

          </TerminalPane>

          {/* `Theme momentum` IS ITS OWN GRID ROW, and that is a layout fix as much
              as an editorial one. Inside the scores pane, the boundary between the
              conviction cards and this card was an ordinary collapsed margin — not a
              grid line — so nothing in column 3 could align to it. The news feed
              therefore ran past the cards it sits beside, and `crowd` began wherever
              the feed happened to stop. As a row of its own the boundary is a real
              grid line: the feed ends on it, and `crowd` starts on it.

              The reason it lived inside the scores pane no longer holds either. That
              was ADR-0103's lock ("the pane scrolls; the document does not"), and the
              lock is gone — panes size to their content and the page scrolls. What
              the restoration actually required was that the block not be DROPPED;
              nothing required it to be a child of the scores pane. */}
          <TerminalPane
            id="momentum"
            title="Theme momentum"
            bare
            className="lg:col-span-2 lg:col-start-1 lg:row-start-2"
          >
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

            {/* Both of these are statements ABOUT the scores in this pane — that a Δ
                is blank rather than zero, or that the history could not be read — so
                they belong inside it. As their own full-width cards they used to sit
                between the scores and the duplicate renderings of the scores. */}
            {historyError && (
              <div className="card mt-4">
                <QueryErrorState
                  what="Theme attention history"
                  message={historyError}
                  source="theme_signals_history"
                />
              </div>
            )}
            {!historyError && themes.length > 0 && scoredObs === 0 && (
              <div className="card mt-4">
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
          </TerminalPane>

          {/* The rail is gone, and it was the wrong shape. It made column 3 one box
              spanning both rows so `crowd` could take the remainder after the feed --
              which aligned the BOTTOM of the column but left its internal split
              wherever the feed's last headline happened to fall. The split is now a
              grid line the left column also sits on, so the two columns agree by
              construction rather than by arithmetic:

                row 1   heatmap + top 3 cards   |  headlines
                row 2   theme momentum          |  crowd (spans rows 2-3)
                row 3   discovered themes       |

              `headlines` ends on the row-1 line, level with the conviction cards.
              `crowd` starts on the row-2 line, level with `Theme momentum`, and spans
              to the bottom of `discovered themes`. Below lg all of it is inert and the
              panes stack in DOM order. */}
          <TerminalPane
            id="headlines"
            title="Headlines behind today's scores"
            bare
            className="lg:col-start-3 lg:row-start-1 lg:self-stretch"
          >
            {/* embedded: the pane supplies the heading, the card and the scroll
                box. Without it the feed rendered its own <h2> with the same
                words, a card inside a card, and an mb-8. */}
            <NewsFeed embedded />
          </TerminalPane>

          <TerminalPane
            id="crowd"
            title="What the crowd is pricing"
            bare
            className="lg:col-start-3 lg:row-start-2 lg:row-span-2 lg:self-stretch"
          >
            <PredictionMarkets />
          </TerminalPane>

          <TerminalPane
            id="discovery"
            title="What the engine is discovering"
            bare
            // `self-stretch` so the pane fills row 3 even when `crowd`, spanning rows
            // 2-3 beside it, is what forces that row taller. Left at the grid's
            // `items-start` the pane would keep its content height and its bottom edge
            // would fall short of `crowd`'s by the difference -- the same misalignment
            // one row down.
            className="lg:col-span-2 lg:col-start-1 lg:row-start-3 lg:self-stretch"
          >
            <DiscoveredThemes />
          </TerminalPane>

          {/* Full width, and BELOW discovery rather than beside it. The trends
              board is a time series across several narratives, so it needs
              horizontal room the two-column slot cannot give it -- a 30-run x-axis
              squeezed into half the grid puts the run dates on top of each other.
              It sits next to `DiscoveredThemes` conceptually: that card is what the
              MONTHLY two-method job proposes, this is what the DAILY frequency
              method sees (ADR-0128). */}
          {/* ONE section, TWO boards: they answer the same question — what is
              the market paying attention to? — from two corpora with different
              biases, and the grouping says so structurally. Narratives first,
              because that board pairs with `DiscoveredThemes` directly above
              (monthly job proposes / daily frequency sees, ADR-0128), and the
              theme board's caption points "above" at it for the
              unbiased-corpus claim (ADR-0141/0145). NOT one chart: different
              denominators must not share an axis (ADR-0145's rejected
              alternative). NOT side by side: a trends x-axis in half the grid
              stacks its run dates (the width note above). */}
          {/* Each card in its own TerminalPane with explicit grid placement,
              matching DiscoveredThemes / PredictionMarkets. NarrativeTrends gets
              2 columns so the scatter has room; AttentionFunnel takes the right
              column beside it. ThemeTrends goes full-width below. */}
          <TerminalPane
            id="narratives"
            title="What the market is paying attention to"
            bare
            className="lg:col-span-2 lg:col-start-1 lg:row-start-4 lg:row-span-1 lg:h-full"
          >
            <NarrativeTrends shared={narratives} />
          </TerminalPane>

          <TerminalPane
            id="funnel"
            title="Attention funnel"
            bare
            className="lg:col-start-3 lg:row-start-4 lg:row-span-1 lg:h-full"
          >
            <AttentionFunnel shared={narratives} />
          </TerminalPane>

          <TerminalPane
            id="themes-trends"
            title="Theme trends"
            bare
            className="lg:col-span-3 lg:col-start-1 lg:row-start-5"
          >
            <ThemeTrends />
          </TerminalPane>
          </div>
        </>
      )}
    </main>
  );
}


/** One aggregate in the screening strip: a label, a figure, and an optional qualifier.
 *  Distinct from `Stat` below, which stacks for a card column; this reads inline so four
 *  of them fit one row without the strip wrapping on a 1024px viewport. */
function StripStat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="flex items-baseline gap-2 min-w-0">
      <span className="text-[10.5px] uppercase tracking-[0.06em] text-text-tertiary whitespace-nowrap">
        {label}
      </span>
      <span className="num text-[15px] font-semibold leading-none">{value}</span>
      {sub ? (
        <span className="text-[11px] text-text-tertiary truncate">{sub}</span>
      ) : null}
    </div>
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
