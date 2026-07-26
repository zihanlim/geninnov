"use client";
// frontend/components/method/MethodBody.tsx
//
// The body of /method, shared by both of its chapters.
//
// Rule for this file: no number is written by hand. Every figure below is read
// from Supabase at render time, and every panel that cannot produce a figure
// says which table or column is missing instead of rendering a plausible blank.
//
// WHY ONE COMPONENT RATHER THAN TWO PAGES.
// /method was 13,057px — 14.5 screens — because it answered two different
// reader questions in one document: "how is this number built?" and "did it run,
// and who checked it?". It is now two routes, but ONE body with ONE useEffect and
// ONE set of queries, filtered per chapter by `chapterOwns`. That is deliberate
// and load-bearing: two chapters with their own fetches are two chances to read
// different vintages of the same tables and disagree about what the pipeline did
// — exactly the class of contradiction ADR-0040 closed when /trades, /portfolio
// and /research were retired into /book.
//
// The knowingly accepted cost: each chapter fires all twelve queries, including
// the ones whose sections it does not render. Per-chapter query subsets were
// rejected for the reason above. Revisit only behind a shared cache, never by
// splitting the fetch.

import { useEffect, useState } from "react";
import Link from "next/link";
import SectionNav from "@/components/SectionNav";
import {
  CHAPTER_NAV,
  CHAPTER_ROUTE,
  chapterOwns,
  type MethodChapter,
} from "@/lib/method/anchors";
import { supabase } from "@/lib/supabase";
import {
  Section,
  SubHead,
  Formula,
  Code,
  Note,
  QueryError,
  EmptyState,
  Stat,
  TableWrap,
  Th,
  Td,
} from "@/components/method/primitives";
import { Reconciliation } from "@/components/Reconciliation";
import {
  EDGE_TOLERANCE,
  HYPE_TOLERANCE,
  reconcile,
} from "@/lib/method/reconciliation";
import SignalValidation from "@/components/method/SignalValidation";
import FactorReconciliation from "@/components/method/FactorReconciliation";
import EdgeValidation from "@/components/method/EdgeValidation";

/* ══ Row types ═══════════════════════════════════════════════════════════════ */

interface PipelineRun {
  run_id: string;
  run_date: string;
  stage: string;
  status: string;
  duration_s: number | null;
  source_freshness: Record<string, unknown> | null;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
}

interface ConfigRow {
  param_name: string;
  value: string;
}

interface ThemeRow {
  id: string;
  name: string;
  tier: string | null;
  hype_score: number | null;
  volume_score: number | null;
  sentiment_score: number | null;
  corr_score: number | null;
  momentum_score: number | null;
}

interface SignalRow {
  theme_id: string;
  run_date: string;
  mention_count_1d: number | null;
  mention_count_7d_avg: number | null;
  mention_count_7d_std: number | null;
  avg_sentiment: number | null;
  price_corr: number | null;
  momentum_raw: number | null;
  hype_score: number | null;
  trade_score: number | null;
  edge_score: number | null;
  trend_signal: number | null;
  regime_bias: number | null;
  // EdgeScore components 3–5 + sizing inputs (migrations 025–026).
  carry_signal: number | null;
  value_signal: number | null;
  sentiment_signal: number | null;
  conviction: number | null;
  vol: number | null;
}

interface ProvenanceRow {
  run_date: string;
  data_source: string | null;
}

interface AgentRun {
  run_date: string;
  prompt_version: string | null;
  model_id: string | null;
  verified: boolean | null;
  retries: number | null;
  citations: unknown;
}

interface MacroRow {
  series_id: string;
  fetch_date: string;
}

interface FactorRow {
  asset: string;
  run_date: string;
}

interface AssetRow {
  ticker: string;
  updated_at: string | null;
}

interface PredictionRow {
  slug: string;
  fetched_at: string | null;
}

/* ══ Query plumbing ══════════════════════════════════════════════════════════ */

interface Res<T> {
  rows: T[];
  count: number | null;
  error: string | null;
}

const PENDING = <T,>(): Res<T> => ({ rows: [], count: null, error: null });

async function q<T>(
  builder: PromiseLike<{
    data: unknown;
    error: { message: string } | null;
    count?: number | null;
  }>,
): Promise<Res<T>> {
  try {
    const r = await builder;
    if (r.error) return { rows: [], count: null, error: r.error.message };
    return { rows: ((r.data as T[] | null) ?? []), count: r.count ?? null, error: null };
  } catch (e) {
    return { rows: [], count: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/* ══ Formatting ══════════════════════════════════════════════════════════════ */

const int = (n: number) => n.toLocaleString("en-US");
const dec = (n: number, d = 2) => n.toFixed(d);
const fmtSigned = (n: number, d = 2) => `${n >= 0 ? "+" : ""}${n.toFixed(d)}`;

function fmtTs(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return (
    d.toLocaleString("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }) + " ET"
  );
}

function pad(s: string, n: number) {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}
function lpad(s: string, n: number) {
  return s.length >= n ? s : " ".repeat(n - s.length) + s;
}

/* ══ Stage definitions ═══════════════════════════════════════════════════════

   `instrumented` records whether scripts/daily_refresh.py wraps the stage in
   record_pipeline_run(). ALL SIX now do, so the absence of a row is evidence the
   stage never started — the "started" sentinel is written before the work begins.

   L1 and L4 were the exceptions until 2026-07-24, and the gap mattered: L1 is
   theme detection (the whole of Q2's daily process) and L4 produces every number
   on /risk, so neither could answer "did you run today?". The flag stays because
   conflating "no row" with "did not run" would be a lie for any stage that ever
   stops reporting.                                                            */

const STAGES: {
  code: string;
  name: string;
  what: string;
  writes: string;
  instrumented: boolean;
}[] = [
  {
    code: "L0",
    name: "Macro ingestion",
    what: "FRED series + yfinance prices",
    writes: "macro_indicators, macro_daily_history",
    instrumented: true,
  },
  {
    code: "L1",
    name: "Theme detection",
    what:
      "Brave News + Reddit → VADER sentiment, mention counts, price correlation, momentum",
    writes: "theme_signals_history",
    instrumented: true,
  },
  {
    code: "L2",
    name: "Factor exposure",
    what: "Ken French FF5 + UMD, 252-day rolling regression per asset",
    writes: "factor_exposures",
    instrumented: true,
  },
  {
    code: "L3",
    name: "Regime classifier",
    what:
      "yield curve, HY OAS, VIX, VIX term structure, real rate, breadth → cycle × sentiment",
    writes: "regime_classifications",
    instrumented: true,
  },
  {
    code: "L4",
    name: "Risk engine",
    what: "parametric VaR/CVaR, Sharpe, beta vs SPX, concentration HHI",
    writes: "portfolio_risk",
    instrumented: true,
  },
  {
    code: "L5",
    name: "Q1 reasoning agent",
    what:
      "screens candidates, computes book metrics + stress scenarios, LLM synthesises picks, citation guardrail verifies every number, sizes positions under caps",
    writes: "research_recommendations, research_agent_runs",
    instrumented: true,
  },
];

type StageVerdict =
  | { kind: "ran"; row: PipelineRun }
  | { kind: "did_not_run" }
  | { kind: "no_record" };

const STATUS_CHIP: Record<string, string> = {
  success: "badge badge-long",
  failure: "badge badge-short",
  partial: "badge badge-warning",
};

/* ══ Page ════════════════════════════════════════════════════════════════════ */

export default function MethodBody({ chapter }: { chapter: MethodChapter }) {
  const [loading, setLoading] = useState(true);

  const [runs, setRuns] = useState<Res<PipelineRun>>(PENDING<PipelineRun>());
  const [cfg, setCfg] = useState<Res<ConfigRow>>(PENDING<ConfigRow>());
  const [themes, setThemes] = useState<Res<ThemeRow>>(PENDING<ThemeRow>());
  const [signals, setSignals] = useState<Res<SignalRow>>(PENDING<SignalRow>());
  const [prov, setProv] = useState<Res<ProvenanceRow>>(PENDING<ProvenanceRow>());
  const [agent, setAgent] = useState<Res<AgentRun>>(PENDING<AgentRun>());
  const [macro, setMacro] = useState<Res<MacroRow>>(PENDING<MacroRow>());
  const [factors, setFactors] = useState<Res<FactorRow>>(PENDING<FactorRow>());
  const [assets, setAssets] = useState<Res<AssetRow>>(PENDING<AssetRow>());
  const [poly, setPoly] = useState<Res<PredictionRow>>(PENDING<PredictionRow>());
  const [candidates, setCandidates] = useState<Res<never>>(PENDING<never>());
  const [positions, setPositions] = useState<Res<never>>(PENDING<never>());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [
        rRuns,
        rCfg,
        rThemes,
        rSignals,
        rProv,
        rAgent,
        rMacro,
        rFactors,
        rAssets,
        rPoly,
        rCand,
        rPos,
      ] = await Promise.all([
        q<PipelineRun>(
          supabase
            .from("pipeline_runs")
            .select("*")
            .order("run_date", { ascending: false })
            .limit(400),
        ),
        q<ConfigRow>(supabase.from("scoring_config").select("param_name,value")),
        q<ThemeRow>(
          supabase
            .from("themes")
            .select(
              "id,name,tier,hype_score,volume_score,sentiment_score,corr_score,momentum_score",
            ),
        ),
        q<SignalRow>(
          supabase
            .from("theme_signals_history")
            .select(
              "theme_id,run_date,mention_count_1d,mention_count_7d_avg,mention_count_7d_std,avg_sentiment,price_corr,momentum_raw,hype_score,trade_score,edge_score,trend_signal,regime_bias,carry_signal,value_signal,sentiment_signal,conviction,vol",
            )
            .order("run_date", { ascending: false })
            .limit(1000),
        ),
        // Provenance probe. Migration 020 adds theme_signals_history.data_source.
        // If it has not been applied, this query errors with 42703 and we say so.
        q<ProvenanceRow>(
          supabase
            .from("theme_signals_history")
            .select("run_date,data_source")
            .order("run_date", { ascending: false })
            .limit(1000),
        ),
        q<AgentRun>(
          supabase
            .from("research_agent_runs")
            .select("run_date,prompt_version,model_id,verified,retries,citations")
            .order("run_date", { ascending: false })
            .limit(200),
        ),
        q<MacroRow>(
          supabase
            .from("macro_indicators")
            .select("series_id,fetch_date", { count: "exact" })
            .order("fetch_date", { ascending: false })
            .limit(2000),
        ),
        q<FactorRow>(
          supabase
            .from("factor_exposures")
            .select("asset,run_date", { count: "exact" })
            .order("run_date", { ascending: false })
            .limit(2000),
        ),
        q<AssetRow>(
          supabase.from("market_assets").select("ticker,updated_at", { count: "exact" }),
        ),
        q<PredictionRow>(
          supabase.from("prediction_markets").select("slug,fetched_at", { count: "exact" }),
        ),
        q<never>(
          supabase.from("trade_candidates").select("*", { count: "exact", head: true }),
        ),
        q<never>(
          supabase.from("portfolio_positions").select("*", { count: "exact", head: true }),
        ),
      ]);
      if (cancelled) return;
      setRuns(rRuns);
      setCfg(rCfg);
      setThemes(rThemes);
      setSignals(rSignals);
      setProv(rProv);
      setAgent(rAgent);
      setMacro(rMacro);
      setFactors(rFactors);
      setAssets(rAssets);
      setPoly(rPoly);
      setCandidates(rCand);
      setPositions(rPos);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* ── Derivations ───────────────────────────────────────────────────────── */

  const latestRunDate =
    runs.rows.length > 0
      ? runs.rows.reduce((m, r) => (r.run_date > m ? r.run_date : m), runs.rows[0].run_date)
      : null;

  const stageVerdict = (code: string, instrumented: boolean): StageVerdict => {
    const forStage = runs.rows.filter((r) => r.stage === code);
    const today = forStage.find((r) => r.run_date === latestRunDate);
    if (today) return { kind: "ran", row: today };
    if (forStage.length > 0 || instrumented) return { kind: "did_not_run" };
    return { kind: "no_record" };
  };

  const lastSuccess = (code: string): PipelineRun | null =>
    runs.rows
      .filter((r) => r.stage === code && r.status === "success")
      .sort((a, b) => (a.run_date < b.run_date ? 1 : -1))[0] ?? null;

  // scoring_config is key/value TEXT — parse to numbers, keep unparseable keys visible.
  const cfgMap = new Map<string, string>(cfg.rows.map((r) => [r.param_name, r.value]));
  const cfgNum = (k: string): number | null => {
    const raw = cfgMap.get(k);
    if (raw === undefined) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  const wVol = cfgNum("hype_volume_weight");
  const wSent = cfgNum("hype_sentiment_weight");
  const wCorr = cfgNum("hype_corr_weight");
  const wMom = cfgNum("hype_momentum_weight");
  const hypeThreshold = cfgNum("hype_score_threshold");
  const wTradeHype = cfgNum("trade_hype_weight");
  const wTradeSent = cfgNum("trade_sentiment_weight");
  // EdgeScore direction weights — the full 4-component model (ADR-0031/0032,
  // migrations 024/025). All four read live from scoring_config; nothing here
  // is hardcoded, and a missing weight surfaces as an EmptyState below.
  const wEdgeTrend = cfgNum("edge_trend_weight");
  const wEdgeRegime = cfgNum("edge_regime_weight");
  const wEdgeCarry = cfgNum("edge_carry_weight");
  const wEdgeValue = cfgNum("edge_value_weight");
  const wEdgeSentiment = cfgNum("edge_sentiment_weight");
  const edgeAbstain = cfgNum("edge_abstain_threshold");
  // ADR-0046. Read live like every other parameter; a missing row means the
  // override is off, which is a real state and is described as such below.
  const convictionOverride = cfgNum("edge_conviction_override");
  // ADR-0047. Read live like every other parameter; 0 or missing means the
  // floor is off, and the formula then shows a bare division as it used to.
  const volFloor = cfgNum("conviction_vol_floor") ?? 0;
  const lookback7 = cfgNum("lookback_momentum_7d");
  const hypeWeightsOk =
    wVol !== null && wSent !== null && wCorr !== null && wMom !== null;
  const hypeWeightSum = hypeWeightsOk ? wVol + wSent + wCorr + wMom : null;
  const tradeWeightsOk = wTradeHype !== null && wTradeSent !== null;

  const missingHypeWeights = [
    ["hype_volume_weight", wVol],
    ["hype_sentiment_weight", wSent],
    ["hype_corr_weight", wCorr],
    ["hype_momentum_weight", wMom],
  ]
    .filter(([, v]) => v === null)
    .map(([k]) => k as string);

  const scoredThemes = themes.rows
    .filter((t) => typeof t.hype_score === "number")
    .sort((a, b) => (b.hype_score ?? 0) - (a.hype_score ?? 0));
  const topTheme = scoredThemes[0] ?? null;

  const clearing =
    hypeThreshold === null
      ? null
      : scoredThemes.filter((t) => (t.hype_score ?? 0) >= hypeThreshold).length;

  // Latest L1 signal date and that date's rows.
  const latestSignalDate =
    signals.rows.length > 0
      ? signals.rows.reduce(
          (m, r) => (r.run_date > m ? r.run_date : m),
          signals.rows[0].run_date,
        )
      : null;
  const latestSignals = signals.rows.filter((r) => r.run_date === latestSignalDate);
  const topSignal = topTheme
    ? (latestSignals.find((s) => s.theme_id === topTheme.id) ?? null)
    : null;

  const mentionTotal = latestSignals.reduce((s, r) => s + (r.mention_count_1d ?? 0), 0);
  const distinctMentionCounts = new Set(
    latestSignals.map((r) => r.mention_count_1d).filter((v) => v !== null),
  );
  const signalsWithHype = signals.rows.filter((r) => typeof r.hype_score === "number").length;

  // Most recent row that actually carries a TradeScore, for the worked check.
  const tradeExample =
    signals.rows.find((r) => typeof r.trade_score === "number") ?? null;
  const tradeExampleTheme = tradeExample
    ? (themes.rows.find((t) => t.id === tradeExample.theme_id) ?? null)
    : null;
  // The prior snapshot the momentum term would be measured against: the most
  // recent earlier row for the same theme that actually carries a HypeScore.
  const tradePrior = tradeExample
    ? (signals.rows
        .filter(
          (r) =>
            r.theme_id === tradeExample.theme_id &&
            r.run_date < tradeExample.run_date &&
            typeof r.hype_score === "number",
        )
        .sort((a, b) => (a.run_date < b.run_date ? 1 : -1))[0] ?? null)
    : null;
  const tradeElapsedDays =
    tradeExample && tradePrior
      ? Math.max(
          1,
          Math.round(
            (new Date(tradeExample.run_date).getTime() -
              new Date(tradePrior.run_date).getTime()) /
              86_400_000,
          ),
        )
      : null;
  // Reason the momentum term is what it is — stated, never assumed.
  const tradeMomentum: { value: number; reason: string } | null = tradeExample
    ? typeof tradeExample.hype_score !== "number"
      ? { value: 0, reason: "hype_today is null on this row" }
      : !tradePrior || typeof tradePrior.hype_score !== "number"
        ? { value: 0, reason: "no earlier row for this theme carries a hype_score" }
        : tradePrior.hype_score === 0
          ? { value: 0, reason: "hype_yesterday is 0 — the ratio is undefined" }
          : {
              value: Math.max(
                -1,
                Math.min(
                  1,
                  (tradeExample.hype_score - tradePrior.hype_score) /
                    tradePrior.hype_score /
                    Math.max(1, tradeElapsedDays ?? 1),
                ),
              ),
              reason: `measured against run_date ${tradePrior.run_date}, ${tradeElapsedDays} day(s) elapsed`,
            }
    : null;
  const tradeRecomputed =
    tradeExample && tradeMomentum && tradeWeightsOk
      ? wTradeHype * tradeMomentum.value + wTradeSent * (tradeExample.avg_sentiment ?? 0)
      : null;
  const tradeDelta =
    tradeRecomputed !== null && typeof tradeExample?.trade_score === "number"
      ? tradeRecomputed - tradeExample.trade_score
      : null;

  // EdgeScore worked example — the most recent row that actually carries an
  // edge_score, so the 4-component direction rule shows real numbers rather than
  // a formula over nulls.
  const edgeExample =
    signals.rows.find((r) => typeof r.edge_score === "number") ?? null;
  const edgeExampleTheme = edgeExample
    ? (themes.rows.find((t) => t.id === edgeExample.theme_id) ?? null)
    : null;
  const edgeWeightsOk =
    wEdgeTrend !== null &&
    wEdgeRegime !== null &&
    wEdgeCarry !== null &&
    wEdgeValue !== null &&
    wEdgeSentiment !== null;
  const missingEdgeWeights = [
    ["edge_trend_weight", wEdgeTrend],
    ["edge_regime_weight", wEdgeRegime],
    ["edge_carry_weight", wEdgeCarry],
    ["edge_value_weight", wEdgeValue],
    ["edge_sentiment_weight", wEdgeSentiment],
  ]
    .filter(([, v]) => v === null)
    .map(([k]) => k as string);
  const edgeWeightSum = edgeWeightsOk
    ? (wEdgeTrend ?? 0) + (wEdgeRegime ?? 0) + (wEdgeCarry ?? 0) + (wEdgeValue ?? 0) + (wEdgeSentiment ?? 0)
    : null;

  // The four weighted contributions for the worked example, each read from the
  // persisted component × the live weight. A null component contributes 0 and is
  // flagged, never silently treated as a tilt.
  const edgeTerms =
    edgeExample && edgeWeightsOk
      ? ([
          { sym: "w_trend  × Trend", w: wEdgeTrend!, x: edgeExample.trend_signal },
          { sym: "w_regime × Regime", w: wEdgeRegime!, x: edgeExample.regime_bias },
          { sym: "w_carry  × Carry", w: wEdgeCarry!, x: edgeExample.carry_signal },
          { sym: "w_value  × Value", w: wEdgeValue!, x: edgeExample.value_signal },
          { sym: "w_sent   × Sentiment", w: wEdgeSentiment!, x: edgeExample.sentiment_signal },
        ] as const)
      : null;
  // RENORMALISED over the components that exist, exactly as `compute_edge_score`
  // does (ADR-0036). This block previously summed `w × (x ?? 0)` and printed
  // "(null → 0)", which is the behaviour ADR-0036 removed from the backend and never
  // removed from the page. On the live 2026-07-25 example the two disagreed 2×:
  //
  //   Σ w·x over present = 0.169999      persisted edge_score = 0.354165
  //   Σ w over present   = 0.20+0.23+0.05 = 0.48
  //   0.169999 / 0.48    = 0.354165      ← the persisted value, exactly
  //
  // Scoring a missing component as 0 is not neutral: it shrinks |EdgeScore| toward
  // the abstention band, penalising a theme for a gap in our data. The worked example
  // exists to prove the published number is reproducible from the published formula,
  // so a recomputation that cannot reproduce it is worse than no worked example.
  const edgeParts = edgeTerms
    ? {
        weightedSum: edgeTerms.reduce((a, t) => a + (t.x === null ? 0 : t.w * t.x), 0),
        weightPresent: edgeTerms.reduce((a, t) => a + (t.x === null ? 0 : t.w), 0),
      }
    : null;
  const edgeWeightedSum = edgeParts ? edgeParts.weightedSum : null;
  const edgeWeightPresent = edgeParts ? edgeParts.weightPresent : null;
  const edgeRecomputed = edgeParts
    ? edgeParts.weightPresent > 0
      ? edgeParts.weightedSum / edgeParts.weightPresent
      : 0
    : null;
  const edgeDelta =
    edgeRecomputed !== null && typeof edgeExample?.edge_score === "number"
      ? edgeRecomputed - edgeExample.edge_score
      : null;
  // conviction = |EdgeScore| / vol (Stage-4 sizing weight). Prefer the persisted
  // conviction; fall back to recomputing it only when both inputs are present.
  const edgeConviction =
    edgeExample && typeof edgeExample.conviction === "number"
      ? edgeExample.conviction
      : edgeExample &&
          typeof edgeExample.edge_score === "number" &&
          typeof edgeExample.vol === "number" &&
          edgeExample.vol > 0
        ? Math.abs(edgeExample.edge_score) / edgeExample.vol
        : null;
  const anyEdge = signals.rows.some((r) => typeof r.edge_score === "number");

  // Abstention roster: themes the engine scored on the latest signal run but
  // declined because |EdgeScore| < edge_abstain_threshold. Computed off the
  // latest-run signals already in memory — no theme takes a position here.
  const abstainedRoster =
    edgeAbstain !== null
      ? latestSignals
          .filter(
            (r) =>
              typeof r.edge_score === "number" &&
              Math.abs(r.edge_score) < edgeAbstain,
          )
          .map((r) => ({
            row: r,
            name: themes.rows.find((t) => t.id === r.theme_id)?.name ?? r.theme_id,
          }))
          .sort(
            (a, b) => Math.abs(b.row.edge_score ?? 0) - Math.abs(a.row.edge_score ?? 0),
          )
      : [];
  const scoredEdgeCount = latestSignals.filter(
    (r) => typeof r.edge_score === "number",
  ).length;

  // Worked HypeScore example.
  const wx = (() => {
    if (!topTheme || !hypeWeightsOk) return null;
    const v = topTheme.volume_score;
    const s = topTheme.sentiment_score;
    const c = topTheme.corr_score;
    const m = topTheme.momentum_score;
    if (
      typeof v !== "number" ||
      typeof s !== "number" ||
      typeof c !== "number" ||
      typeof m !== "number"
    ) {
      return null;
    }
    const terms = [
      { sym: "w_vol  × Volume", w: wVol, x: v },
      { sym: "w_sent × Sentiment", w: wSent, x: s },
      { sym: "w_corr × |ρ|", w: wCorr, x: c },
      { sym: "w_mom  × Momentum", w: wMom, x: m },
    ];
    const sum = terms.reduce((acc, t) => acc + t.w * t.x, 0);
    const recomputed = 100 * sum;
    const persisted = topTheme.hype_score ?? null;
    const delta = persisted === null ? null : recomputed - persisted;
    // Does the whole gap sit in the correlation term? |ρ| from the raw L1 row
    // versus the corr_score column persisted on themes.
    const rawCorr =
      topSignal && typeof topSignal.price_corr === "number"
        ? Math.abs(topSignal.price_corr)
        : null;
    const corrGap = rawCorr === null ? null : wCorr * 100 * (c - rawCorr);
    const corrExplains =
      delta !== null && corrGap !== null && Math.abs(corrGap - delta) < 0.1;
    return { terms, sum, recomputed, persisted, delta, rawCorr, corrGap, corrExplains };
  })();

  // Guardrail aggregates.
  const citationCount = (r: AgentRun) => (Array.isArray(r.citations) ? r.citations.length : 0);
  const nonArrayCitations = agent.rows.filter(
    (r) => r.citations != null && !Array.isArray(r.citations),
  ).length;
  const totalAgentRuns = agent.rows.length;
  const verifiedRuns = agent.rows.filter((r) => r.verified === true).length;
  const retryVals = agent.rows
    .map((r) => r.retries)
    .filter((v): v is number => typeof v === "number");
  const avgRetries =
    retryVals.length > 0 ? retryVals.reduce((a, b) => a + b, 0) / retryVals.length : null;
  const zeroCitationRuns = agent.rows.filter((r) => citationCount(r) === 0).length;
  // verify_citations rejects an empty citation list outright, so verified=true
  // with zero citations can only have come from the deterministic fallback.
  const fallbackSignature = agent.rows.filter(
    (r) => r.verified === true && citationCount(r) === 0,
  ).length;
  const unverifiedRuns = agent.rows.filter((r) => r.verified === false).length;
  const maxRetries = retryVals.length > 0 ? Math.max(...retryVals) : null;

  // Source coverage.
  const macroSeries = new Set(macro.rows.map((r) => r.series_id));
  const macroLatest = macro.rows.length > 0 ? macro.rows[0].fetch_date : null;
  const factorAssets = new Set(factors.rows.map((r) => r.asset));
  const factorLatest = factors.rows.length > 0 ? factors.rows[0].run_date : null;
  const assetLatest = assets.rows
    .map((r) => r.updated_at)
    .filter((v): v is string => !!v)
    .sort()
    .slice(-1)[0];
  const polyLatest = poly.rows
    .map((r) => r.fetched_at)
    .filter((v): v is string => !!v)
    .sort()
    .slice(-1)[0];

  // Provenance breakdown (migration 020). Absent column ⇒ prov.error is set.
  const provLatest =
    prov.rows.length > 0
      ? prov.rows.reduce((m, r) => (r.run_date > m ? r.run_date : m), prov.rows[0].run_date)
      : null;
  const provBuckets = new Map<string, number>();
  for (const r of prov.rows.filter((r) => r.run_date === provLatest)) {
    const k = r.data_source ?? "(null)";
    provBuckets.set(k, (provBuckets.get(k) ?? 0) + 1);
  }

  /* ── Render ────────────────────────────────────────────────────────────── */

  if (loading) {
    return (
      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 wide:px-5 pt-7 pb-20">
        <div className="skeleton h-[52px] mb-6" />
        <div className="skeleton h-[320px] mb-4" />
        <div className="skeleton h-[240px] mb-4" />
        <div className="skeleton h-[240px]" />
      </main>
    );
  }

  return (
    <main className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 wide:px-5 pt-7 pb-20">
      <header className="mb-5">
        <h1 className="text-[22px] font-semibold tracking-[-0.01em] m-0 mb-1">
          Method{" "}
          <span className="text-text-tertiary font-normal">
            · {chapter === "build" ? "How a number is built" : "Evidence it ran"}
          </span>
        </h1>
        <p className="m-0 text-text-secondary text-[13px] max-w-[92ch]">
          {chapter === "build" ? (
            <>
              How the pipeline turns attention into a score, and a score into a side. Every
              figure on this page is a live query against the tables the pipeline writes, and
              every formula is rendered from <Code>scoring_config</Code> at render time. Where a
              query returns nothing, the panel names the table and the reason rather than
              rendering a blank.
            </>
          ) : (
            <>
              Whether the process actually ran, what it read, and what was checked before a
              number reached the book. The pipeline&apos;s own status, its data sources and the
              guardrails on the reasoning layer — the audit trail rather than the arithmetic.
            </>
          )}
        </p>
        <p className="m-0 mt-2 text-[12px] text-text-tertiary">
          Latest <Code>pipeline_runs.run_date</Code>:{" "}
          <span className="num text-text-secondary">{latestRunDate ?? "none"}</span>
          {" · "}Latest <Code>theme_signals_history.run_date</Code>:{" "}
          <span className="num text-text-secondary">{latestSignalDate ?? "none"}</span>
        </p>

        {/* Chapter switch. Plain <Link>s, so this works with JS off and a reader
            can copy either chapter's URL. Both chapters render the same body from
            the same fetch, so switching cannot show a different vintage. */}
        <nav aria-label="Method chapters" className="flex gap-1 mt-3">
          {(["build", "evidence"] as const).map((c) => (
            <Link
              key={c}
              href={CHAPTER_ROUTE[c]}
              aria-current={c === chapter ? "page" : undefined}
              className={`px-3 py-1.5 rounded-md font-medium text-[12.5px] border transition-colors ${
                c === chapter
                  ? "text-text-primary bg-bg-elevated border-border-strong"
                  : "text-text-secondary border-border hover:text-text-primary hover:bg-bg-hover"
              }`}
            >
              {c === "build" ? "How it is built" : "Evidence it ran"}
            </Link>
          ))}
        </nav>
      </header>

      <SectionNav items={CHAPTER_NAV[chapter]} />

      {/* ═══ 1. Pipeline ═══════════════════════════════════════════════════ */}
      {chapterOwns(chapter, "pipeline") && (
      <Section
        id="pipeline"
        index="01"
        title="The daily process, as live status"
        lede={
          <>
            Six stages run once per day after the US close. L0–L4 are deterministic — same
            inputs, same outputs, no model. L5 is the only stage that calls an LLM, and its
            output is checked against the frozen L0–L4 snapshot before it is persisted. Status,
            duration and freshness below come from <Code>pipeline_runs</Code>.
          </>
        }
      >
        {runs.error ? (
          <QueryError table="pipeline_runs" message={runs.error} />
        ) : runs.rows.length === 0 ? (
          <EmptyState
            table="pipeline_runs"
            cause="The table is empty — no stage has ever recorded a run."
            remedy="Run scripts/daily_refresh.py; record_pipeline_run() writes a row when each instrumented stage starts and updates it on completion."
          />
        ) : (
          <>
            <ol className="card p-5 list-none m-0">
              {STAGES.map((s, i) => {
                const v = stageVerdict(s.code, s.instrumented);
                const ls = lastSuccess(s.code);
                const row = v.kind === "ran" ? v.row : null;
                const dotColor =
                  row?.status === "success"
                    ? "var(--long)"
                    : row?.status === "failure"
                      ? "var(--short)"
                      : row?.status === "partial"
                        ? "var(--warning)"
                        : "var(--border-strong)";
                const freshnessKeys = row?.source_freshness
                  ? Object.keys(row.source_freshness)
                  : [];
                return (
                  <li key={s.code} className="relative pl-9 pb-5 last:pb-0">
                    {i < STAGES.length - 1 && (
                      <span
                        aria-hidden
                        className="absolute left-[10px] top-[18px] bottom-0 w-px bg-border"
                      />
                    )}
                    <span
                      aria-hidden
                      className="absolute left-[5px] top-[5px] w-[11px] h-[11px] rounded-full border-2 border-bg-surface"
                      style={{ background: dotColor }}
                    />
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="min-w-[240px] flex-1">
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <span className="num text-[12px] text-accent font-semibold">
                            {s.code}
                          </span>
                          <span className="text-[14px] font-medium">{s.name}</span>
                        </div>
                        <div className="text-[12.5px] text-text-secondary mt-0.5 max-w-[76ch]">
                          {s.what} <span className="text-text-tertiary">→</span>{" "}
                          <span className="num text-[11.5px] text-text-tertiary">{s.writes}</span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        {v.kind === "ran" ? (
                          <span className={STATUS_CHIP[row!.status] ?? "badge badge-neutral"}>
                            {row!.status}
                          </span>
                        ) : v.kind === "did_not_run" ? (
                          <span className="badge badge-neutral">did not run</span>
                        ) : (
                          <span className="badge badge-neutral">not instrumented</span>
                        )}
                        <div className="text-[11px] text-text-tertiary mt-1 num">
                          {v.kind === "ran"
                            ? typeof row!.duration_s === "number"
                              ? `${dec(row!.duration_s, 1)}s`
                              : "no duration_s"
                            : "—"}
                        </div>
                      </div>
                    </div>

                    <div className="mt-2 text-[11.5px] text-text-tertiary leading-[1.55]">
                      <div>
                        Last success:{" "}
                        {ls ? (
                          <span className="num text-text-secondary">
                            {ls.run_date} · {fmtTs(ls.finished_at ?? ls.started_at)}
                          </span>
                        ) : (
                          <span className="text-warning">
                            never — no row with <span className="num">status=&apos;success&apos;</span>{" "}
                            in <span className="num">pipeline_runs</span>
                          </span>
                        )}
                      </div>

                      {v.kind === "ran" && row!.status === "partial" && (
                        <div className="text-warning mt-0.5">
                          <span className="num">partial</span> is the sentinel written when the
                          stage starts; it is overwritten on completion.
                          {row!.finished_at === null ? (
                            <>
                              {" "}
                              <span className="num">finished_at</span> is still null (started{" "}
                              {fmtTs(row!.started_at)}), so this stage recorded no terminal state.
                            </>
                          ) : null}
                        </div>
                      )}

                      {v.kind === "did_not_run" && (
                        <div className="mt-0.5">
                          No <span className="num">pipeline_runs</span> row for{" "}
                          <span className="num">{latestRunDate}</span>. This stage writes its
                          sentinel before doing any work, so it never started on that date.
                        </div>
                      )}

                      {v.kind === "no_record" && (
                        <div className="mt-0.5">
                          This stage does not call{" "}
                          <span className="num">record_pipeline_run()</span>, so it never appears
                          here. Absence is not evidence it did not run — check{" "}
                          <span className="num">{s.writes}</span> directly.
                        </div>
                      )}

                      {row?.error && (
                        <div className="text-short mt-0.5 break-words">
                          error: <span className="num">{row.error}</span>
                        </div>
                      )}

                      {freshnessKeys.length > 0 && (
                        <div className="mt-0.5">
                          source_freshness keys:{" "}
                          <span className="num text-text-secondary">
                            {freshnessKeys.join(", ")}
                          </span>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>

            <div className="mt-3 grid grid-cols-1 gap-3">
              <Note tone="info" label="How to read the absence of a row">
                <Code>scripts/daily_refresh.py</Code> wraps all six stages in{" "}
                <Code>record_pipeline_run()</Code>. The sentinel row is written before the stage
                does any work, so a missing row means the stage never started — not that it ran
                silently. L1 and L4 were uninstrumented until 2026-07-24 and reported{" "}
                <span className="num">not instrumented</span> here while the status bar counted
                &ldquo;4/4 succeeded&rdquo;; that denominator was the stages that reported, not
                the stages that exist.
              </Note>
              {runs.rows.some((r) => r.status === "partial" && r.finished_at === null) && (
                <Note tone="warn" label="Unfinished stages">
                  {runs.rows.filter((r) => r.status === "partial" && r.finished_at === null).length}{" "}
                  of {runs.rows.length} rows in <Code>pipeline_runs</Code> are still at the{" "}
                  <span className="num">partial</span> sentinel with a null{" "}
                  <span className="num">finished_at</span>. Those stages started and never wrote a
                  terminal status, so no duration and no success timestamp exist for them.
                </Note>
              )}
            </div>
          </>
        )}
      </Section>
      )}

      {/* ═══ 2. HypeScore ══════════════════════════════════════════════════ */}
      {chapterOwns(chapter, "hypescore") && (
      <Section
        id="hypescore"
        index="02"
        title="HypeScore — quantifying attention"
        lede={
          <>
            One number per theme per day, in [0, 100]. It combines how much a theme is being
            talked about, how positively, how tightly that talk co-moves with the theme&apos;s
            mapped assets, and how unusual today&apos;s volume is against its own recent window.
            Weights are read live from <Code>scoring_config</Code> — they are configuration, not
            code.
          </>
        }
      >
        {cfg.error ? (
          <QueryError table="scoring_config" message={cfg.error} />
        ) : !hypeWeightsOk ? (
          <EmptyState
            table="scoring_config"
            cause={`Missing or non-numeric param_name rows: ${missingHypeWeights.join(", ") || "none parsed"}.`}
            remedy="Insert the four hype weights into scoring_config (param_name, value). The formula cannot be rendered without them."
          />
        ) : (
          <div className="grid grid-cols-1 gap-4">
            <Formula label="live weights from scoring_config">
              {`HypeScore = 100 × ( ${dec(wVol, 2)}·Volume  +  ${dec(wSent, 2)}·Sentiment  +  ${dec(wCorr, 2)}·|ρ|  +  ${dec(wMom, 2)}·Momentum )`}
            </Formula>

            <div className="text-[12px] text-text-tertiary">
              Weights sum to{" "}
              <span className={`num ${Math.abs((hypeWeightSum ?? 0) - 1) < 1e-9 ? "text-text-secondary" : "text-warning"}`}>
                {dec(hypeWeightSum ?? 0, 2)}
              </span>
              {Math.abs((hypeWeightSum ?? 0) - 1) < 1e-9
                ? " — the bracket is a convex combination, so HypeScore is bounded by [0, 100]."
                : " — the bracket is not a convex combination, so the 0–100 bound does not hold."}
            </div>

            <div className="card">
              <div className="card-header">
                <span className="card-title">Terms</span>
                <span className="text-[11px] text-text-tertiary">
                  all four inputs are on [0, 1] before weighting
                </span>
              </div>
              <TableWrap>
                <table className="w-full border-collapse text-[12.5px]">
                  <caption className="sr-only">
                    The four HypeScore terms, their definitions, ranges and live weights.
                  </caption>
                  <thead>
                    <tr>
                      <Th>Term</Th>
                      <Th align="right">Weight</Th>
                      <Th>Definition</Th>
                      <Th>Range</Th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <Td mono>Volume</Td>
                      <Td mono align="right">{dec(wVol, 2)}</Td>
                      <Td>
                        Min-max normalised <strong>7-day average</strong> daily mention count
                        across all themes on the run date. The 7-day window (not the 1-day count,
                        which is often 0 on a run that collected no same-day article) is the
                        theme&rsquo;s sustained attention <em>level</em>; today&rsquo;s deviation
                        from it is captured separately by Momentum. Cross-sectional: it answers
                        &ldquo;loudest relative to the rest of the board&rdquo;, not &ldquo;loud in
                        absolute terms&rdquo;.
                      </Td>
                      <Td mono>[0, 1]</Td>
                    </tr>
                    <tr>
                      <Td mono>Sentiment</Td>
                      <Td mono align="right">{dec(wSent, 2)}</Td>
                      <Td>
                        VADER compound over the collected headlines and posts, in [-1, +1],
                        rescaled to [0, 1] via <Code>(c + 1) / 2</Code>. Neutral text maps to 0.5,
                        so the term never zeroes out a theme purely for being un-emotive.
                      </Td>
                      <Td mono>[0, 1]</Td>
                    </tr>
                    <tr>
                      <Td mono>|ρ|</Td>
                      <Td mono align="right">{dec(wCorr, 2)}</Td>
                      <Td>
                        Absolute correlation between daily mention volume and the returns of the
                        theme&apos;s mapped assets. Absolute because attention is
                        direction-agnostic: a theme whose chatter co-moves strongly with price
                        either way is market-relevant. The sign is not discarded from the
                        system — it is kept separately as the crowding signal, where direction is
                        the whole point.
                      </Td>
                      <Td mono>[0, 1]</Td>
                    </tr>
                    <tr>
                      <Td mono>Momentum</Td>
                      <Td mono align="right">{dec(wMom, 2)}</Td>
                      <Td>
                        Normalised z-score of today&apos;s mentions against the trailing{" "}
                        {lookback7 === null ? "7" : int(lookback7)}-day window (
                        <Code>lookback_momentum_7d</Code>), then min-max normalised across themes.
                        The raw z-score uses median/MAD rather than mean/std so a single viral day
                        cannot inflate the window it is being measured against.
                      </Td>
                      <Td mono>[0, 1]</Td>
                    </tr>
                  </tbody>
                </table>
              </TableWrap>
            </div>

            {/* Worked example */}
            <div className="card">
              <div className="card-header">
                <span className="card-title">Worked example · today&apos;s top theme</span>
                <span className="text-[11px] text-text-tertiary num">
                  {topTheme ? `themes.hype_score desc · limit 1` : "—"}
                </span>
              </div>
              <div className="card-body grid grid-cols-1 gap-3">
                {themes.error ? (
                  <QueryError table="themes" message={themes.error} />
                ) : !topTheme ? (
                  <EmptyState
                    table="themes"
                    cause={`${themes.rows.length} theme rows exist but none has a non-null hype_score.`}
                    remedy="The L1 stage populates themes.hype_score. Run scripts/daily_refresh.py to score the theme set."
                  />
                ) : !wx ? (
                  <EmptyState
                    table="themes"
                    cause={`"${topTheme.name}" has hype_score = ${topTheme.hype_score ?? "null"} but at least one of volume_score / sentiment_score / corr_score / momentum_score is null, so the arithmetic cannot be reproduced.`}
                    remedy="daily_refresh.py persists all four sub-score columns alongside hype_score; re-run the scoring stage."
                  />
                ) : (
                  <>
                    <div className="text-[12.5px] text-text-secondary">
                      <span className="text-text-primary font-medium">{topTheme.name}</span>
                      {topTheme.tier ? (
                        <span className="text-text-tertiary"> · {topTheme.tier} tier</span>
                      ) : null}
                      <span className="text-text-tertiary num"> · themes.id {topTheme.id}</span>
                    </div>

                    <Note tone="info" label="Unit convention">
                      <Code>themes.volume_score</Code>, <Code>sentiment_score</Code>,{" "}
                      <Code>corr_score</Code> and <Code>momentum_score</Code> are stored as [0, 1]
                      decimals. <Code>themes.hype_score</Code> is stored on 0–100. Everything in
                      the block below is on the decimal scale until the final{" "}
                      <span className="num">× 100</span>.
                    </Note>

                    <Formula label="substituting the persisted sub-scores">
                      {[
                        ...wx.terms.map(
                          (t) =>
                            `  ${pad(t.sym, 19)} = ${dec(t.w!, 2)} × ${dec(t.x, 4)} = ${lpad(dec(t.w! * t.x, 6), 9)}`,
                        ),
                        `  ${" ".repeat(19)}   ${" ".repeat(15)}${"─".repeat(9)}`,
                        `  ${pad("Σ", 19)} = ${" ".repeat(13)}${lpad(dec(wx.sum, 6), 9)}`,
                        ``,
                        `  HypeScore = 100 × Σ = ${dec(wx.recomputed, 2)}`,
                      ].join("\n")}
                    </Formula>

                    {/* Same claim, same rendering, same tolerance rule as the
                        EdgeScore block below and as /book's lineage steps — see
                        components/Reconciliation.tsx. Was three hand-rolled Stats
                        with the 0.05 threshold and its verdict copy inlined. */}
                    <Reconciliation
                      verdict={reconcile(wx.recomputed, wx.persisted, HYPE_TOLERANCE)}
                      labels={{
                        recomputed: "Recomputed from sub-scores",
                        recomputedSub: "100 × Σ of the four weighted terms above",
                        persisted: "Persisted themes.hype_score",
                        persistedSub: "what the rest of the product reads",
                      }}
                      format={{ decimals: 2, signed: false }}
                    />

                    {wx.delta !== null && Math.abs(wx.delta) >= HYPE_TOLERANCE && (
                      <Note tone="bad" label="Reconciliation failure">
                        Applying the live weights to the persisted sub-scores yields{" "}
                        <span className="num">{dec(wx.recomputed, 2)}</span>, but{" "}
                        <Code>themes.hype_score</Code> holds{" "}
                        <span className="num">{dec(wx.persisted!, 2)}</span>. The sub-score columns
                        and the score column were not written from the same inputs.
                        {wx.rawCorr !== null && (
                          <>
                            {" "}
                            The raw L1 row for this theme on{" "}
                            <span className="num">{latestSignalDate}</span> has{" "}
                            <Code>price_corr</Code> ={" "}
                            <span className="num">{dec(topSignal!.price_corr as number, 4)}</span>,
                            i.e. |ρ| = <span className="num">{dec(wx.rawCorr, 4)}</span>, while{" "}
                            <Code>themes.corr_score</Code> holds{" "}
                            <span className="num">{dec(topTheme.corr_score as number, 4)}</span>.
                            {wx.corrExplains ? (
                              <>
                                {" "}
                                That single discrepancy accounts for the entire gap:{" "}
                                <span className="num">
                                  {dec(wCorr, 2)} × 100 × ({dec(topTheme.corr_score as number, 4)} −{" "}
                                  {dec(wx.rawCorr, 4)}) = {dec(wx.corrGap!, 2)}
                                </span>
                                . The scorer used the raw |ρ|; the{" "}
                                <span className="num">corr_score</span> column was written with the
                                min-max normalised value instead.
                              </>
                            ) : null}
                          </>
                        )}
                      </Note>
                    )}

                    {/* Raw L1 inputs */}
                    <div>
                      <SubHead
                        note={
                          latestSignalDate ? (
                            <span className="num">
                              theme_signals_history · run_date {latestSignalDate}
                            </span>
                          ) : undefined
                        }
                      >
                        Raw L1 inputs behind those sub-scores
                      </SubHead>
                      {signals.error ? (
                        <QueryError table="theme_signals_history" message={signals.error} />
                      ) : !topSignal ? (
                        <EmptyState
                          table="theme_signals_history"
                          cause={`No row for theme_id ${topTheme.id} on the latest run_date${latestSignalDate ? ` (${latestSignalDate})` : ""}.`}
                          remedy="The L1 stage writes one row per theme per run_date. Re-run scripts/daily_refresh.py."
                        />
                      ) : (
                        <TableWrap>
                          <table className="w-full border-collapse text-[12.5px]">
                            <caption className="sr-only">
                              Raw L1 signal inputs for {topTheme.name} on {latestSignalDate}.
                            </caption>
                            <thead>
                              <tr>
                                <Th>Column</Th>
                                <Th align="right">Value</Th>
                                <Th>Feeds</Th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr>
                                <Td mono>mention_count_1d</Td>
                                <Td mono align="right">
                                  {topSignal.mention_count_1d ?? "null"}
                                </Td>
                                <Td>Volume (after cross-theme min-max)</Td>
                              </tr>
                              <tr>
                                <Td mono>mention_count_7d_avg</Td>
                                <Td mono align="right">
                                  {topSignal.mention_count_7d_avg === null
                                    ? "null"
                                    : dec(topSignal.mention_count_7d_avg, 4)}
                                </Td>
                                <Td>Momentum window centre</Td>
                              </tr>
                              <tr>
                                <Td mono>mention_count_7d_std</Td>
                                <Td mono align="right">
                                  {topSignal.mention_count_7d_std === null
                                    ? "null"
                                    : dec(topSignal.mention_count_7d_std, 4)}
                                </Td>
                                <Td>Momentum window dispersion</Td>
                              </tr>
                              <tr>
                                <Td mono>avg_sentiment</Td>
                                <Td mono align="right">
                                  {topSignal.avg_sentiment === null
                                    ? "null"
                                    : dec(topSignal.avg_sentiment, 4)}
                                </Td>
                                <Td>
                                  Sentiment, after{" "}
                                  <Code>(c + 1) / 2</Code>
                                  {topSignal.avg_sentiment !== null && (
                                    <>
                                      {" = "}
                                      <span className="num">
                                        {dec((topSignal.avg_sentiment + 1) / 2, 4)}
                                      </span>
                                    </>
                                  )}
                                </Td>
                              </tr>
                              <tr>
                                <Td mono>price_corr</Td>
                                <Td mono align="right">
                                  {topSignal.price_corr === null
                                    ? "null"
                                    : dec(topSignal.price_corr, 4)}
                                </Td>
                                <Td>
                                  |ρ|, after <Code>abs()</Code>
                                  {topSignal.price_corr !== null && (
                                    <>
                                      {" = "}
                                      <span className="num">
                                        {dec(Math.abs(topSignal.price_corr), 4)}
                                      </span>
                                    </>
                                  )}
                                </Td>
                              </tr>
                              <tr>
                                <Td mono>momentum_raw</Td>
                                <Td mono align="right">
                                  {topSignal.momentum_raw === null
                                    ? "null"
                                    : dec(topSignal.momentum_raw, 4)}
                                </Td>
                                <Td>Momentum (after cross-theme min-max)</Td>
                              </tr>
                            </tbody>
                          </table>
                        </TableWrap>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Caveats */}
            <div className="grid grid-cols-1 gap-3">
              <Note tone="warn" label="HypeScore is relative, not absolute">
                Volume and Momentum are min-max normalised <em>across the theme set on a single
                day</em>. The loudest theme of the day scores 1.0 on Volume whether it drew ten
                thousand mentions or ten. HypeScore therefore ranks themes against each other on
                one date; it does not measure attention on a stable scale, and two dates&apos;
                scores are not directly comparable. Comparisons over time need a percentile
                against a theme&apos;s own history, which the current schema does not persist —{" "}
                <Code>theme_signals_history.hype_score</Code> is non-null on{" "}
                <span className="num">{signalsWithHype}</span> of{" "}
                <span className="num">{signals.rows.length}</span> rows.
              </Note>

              {latestSignals.length > 0 && distinctMentionCounts.size === 1 && (
                <Note tone="bad" label="Degenerate normalisation on the latest run date">
                  All {latestSignals.length} themes recorded the same{" "}
                  <Code>mention_count_1d</Code> ={" "}
                  <span className="num">{Array.from(distinctMentionCounts)[0]}</span> on{" "}
                  <span className="num">{latestSignalDate}</span>. Min-max normalisation over a
                  constant vector has no spread, so the Volume term collapses to the fixed 0.5
                  fallback for every theme and carries{" "}
                  <span className="num">{dec(wVol * 100, 0)}%</span> of the weight while conveying
                  zero cross-sectional information. A HypeScore ranking built on this date is
                  driven by the Sentiment and Momentum terms alone.
                </Note>
              )}

              {hypeThreshold === null ? (
                <Note tone="warn" label="Threshold not configured">
                  <Code>scoring_config.hype_score_threshold</Code> is missing or non-numeric, so
                  the gate below cannot be evaluated.
                </Note>
              ) : (
                <Note
                  tone={clearing === 0 ? "bad" : "info"}
                  label={`Threshold gate · hype_score_threshold = ${dec(hypeThreshold, 2)}`}
                >
                  Only themes with <span className="num">HypeScore ≥ {dec(hypeThreshold, 2)}</span>{" "}
                  are expanded into trade candidates
                  {convictionOverride !== null && convictionOverride > 0 ? (
                    <>
                      {" "}
                      — unless one of the theme&apos;s assets carries{" "}
                      <span className="num">
                        |EdgeScore| ≥ {dec(convictionOverride, 2)}
                      </span>{" "}
                      (<Code>edge_conviction_override</Code>), which admits it anyway.
                      Attention chooses what we look at; it does not decide what is
                      tradable, and until ADR-0046 it silently did — the most negative
                      theme on the board sat 3.3 points under this gate and never became
                      a candidate
                    </>
                  ) : (
                    <>
                      ; everything below is dropped before the long/short split, because{" "}
                      <Code>edge_conviction_override</Code> is unset or zero
                    </>
                  )}
                  . Right now{" "}
                  <span className="num">
                    {clearing} of {scoredThemes.length}
                  </span>{" "}
                  scored themes clear it
                  {topTheme && typeof topTheme.hype_score === "number" ? (
                    <>
                      {" "}
                      — the highest is{" "}
                      <span className="text-text-primary">{topTheme.name}</span> at{" "}
                      <span className="num">{dec(topTheme.hype_score, 2)}</span>
                      {topTheme.hype_score < hypeThreshold ? (
                        <>
                          , short by{" "}
                          <span className="num">{dec(hypeThreshold - topTheme.hype_score, 2)}</span>
                        </>
                      ) : null}
                    </>
                  ) : null}
                  . Downstream:{" "}
                  <Code>trade_candidates</Code> holds{" "}
                  <span className="num">
                    {candidates.error ? "query failed" : (candidates.count ?? 0)}
                  </span>{" "}
                  rows and <Code>portfolio_positions</Code> holds{" "}
                  <span className="num">
                    {positions.error ? "query failed" : (positions.count ?? 0)}
                  </span>{" "}
                  rows. Because the gate is an absolute level applied to a cross-sectionally
                  normalised score, it tightens or loosens whenever the theme set changes — a
                  percentile gate would be the scale-invariant alternative.
                </Note>
              )}
            </div>
          </div>
        )}
      </Section>
      )}

      {/* Validation of the above — honest "is HypeScore predictive?" status.
          Sets its own id="signal-validation", which is why that id is in
          METHOD_ANCHORS even though no <Section> declares it. */}
      {chapterOwns(chapter, "signal-validation") && <SignalValidation />}

      {/* ═══ 3. TradeScore ═════════════════════════════════════════════════ */}
      {chapterOwns(chapter, "tradescore") && (
      <Section
        id="tradescore"
        index="03"
        title="TradeScore — conviction, and ranking within a side"
        lede={
          <>
            HypeScore says a theme is loud. TradeScore says whether the loudness is building or
            fading. It is a change measure — the level of attention is already priced, the second
            derivative is what is tradable. It <span className="text-text-primary">no longer
            picks the side</span>: since ADR-0031 direction comes from EdgeScore (section 4), and
            TradeScore only ranks names <em>within</em> the side EdgeScore has chosen.
          </>
        }
      >
        {cfg.error ? (
          <QueryError table="scoring_config" message={cfg.error} />
        ) : !tradeWeightsOk ? (
          <EmptyState
            table="scoring_config"
            cause="trade_hype_weight and/or trade_sentiment_weight are missing or non-numeric."
            remedy="Insert both rows into scoring_config (param_name, value)."
          />
        ) : (
          <div className="grid grid-cols-1 gap-4">
            <Formula label="live weights from scoring_config">
              {[
                `TradeScore   = ${dec(wTradeHype, 2)}·HypeMomentum  +  ${dec(wTradeSent, 2)}·Sentiment`,
                ``,
                `HypeMomentum = (hype_today − hype_yesterday) / hype_yesterday / max(1, elapsed_days)`,
                `             clamped to [−1, +1]`,
                ``,
                `Sentiment    = VADER compound, already on [−1, +1]  (NOT rescaled here)`,
              ].join("\n")}
            </Formula>

            <div className="card">
              <div className="card-body grid grid-cols-1 gap-2.5 text-[12.5px] text-text-secondary max-w-[92ch]">
                <p className="m-0">
                  <span className="text-text-primary font-medium">Why a ratio.</span>{" "}
                  <span className="num">HypeMomentum</span> is the fractional day-over-day change
                  in HypeScore, not the difference. A theme moving 20 → 30 is a bigger event than
                  70 → 80, and the ratio says so. Dividing by{" "}
                  <span className="num">max(1, elapsed_days)</span> makes a gap in the run history
                  cost momentum rather than manufacture it: a 50-point drift discovered after five
                  missed days contributes a fifth of what the same drift over one day would.
                </p>
                <p className="m-0">
                  <span className="text-text-primary font-medium">Why the clamp.</span> The
                  denominator is a small positive number, so a theme waking from near-zero
                  attention produces an unbounded ratio. Clamping to{" "}
                  <span className="num">[−1, +1]</span> keeps a single low-base theme from
                  dominating the ranking on arithmetic alone.
                </p>
                <p className="m-0">
                  <span className="text-text-primary font-medium">Ranking, not direction.</span>{" "}
                  TradeScore used to set the side via its sign — but with HypeMomentum near zero on
                  sparse data that collapsed to the sign of near-zero VADER sentiment, an unstable
                  basis for a long/short call. Direction now comes from{" "}
                  <span className="num">sign(EdgeScore)</span> (section 4). Once EdgeScore has
                  chosen long or short for a theme, names within that side are ordered by
                  |TradeScore| and the top N are expanded into one candidate per mapped asset.
                  Sentiment keeps its raw <span className="num">[−1, +1]</span> range here (a
                  conviction weight that can be negative) whereas HypeScore rescales it to{" "}
                  <span className="num">[0, 1]</span>: there the question is &ldquo;how much
                  attention&rdquo;, here it is &ldquo;building or fading&rdquo;.
                </p>
                <p className="m-0">
                  <span className="text-text-primary font-medium">Null handling.</span> When{" "}
                  <span className="num">hype_yesterday</span> is null or zero the momentum term
                  contributes 0 rather than raising — the sentiment term stands alone and the
                  trade is, correctly, a weaker signal.
                </p>
              </div>
            </div>

            {/* Live check on the momentum term */}
            {signals.error ? (
              <QueryError table="theme_signals_history" message={signals.error} />
            ) : (
              <div className="grid grid-cols-1 gap-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <Stat
                    label="Rows with a hype_score"
                    value={`${signalsWithHype} / ${signals.rows.length}`}
                    tone={signalsWithHype === 0 ? "bad" : "default"}
                    sub={<span className="num">theme_signals_history.hype_score</span>}
                  />
                  <Stat
                    label="Rows with a trade_score"
                    value={`${signals.rows.filter((r) => typeof r.trade_score === "number").length} / ${signals.rows.length}`}
                    sub={<span className="num">theme_signals_history.trade_score</span>}
                  />
                  <Stat
                    label="Weights"
                    value={`${dec(wTradeHype, 2)} / ${dec(wTradeSent, 2)}`}
                    sub="hype momentum / sentiment"
                  />
                </div>

                {signalsWithHype === 0 && signals.rows.length > 0 && (
                  <Note tone="bad" label="The momentum term is structurally dead right now">
                    <Code>theme_signals_history.hype_score</Code> is null on all{" "}
                    <span className="num">{signals.rows.length}</span> persisted rows, so{" "}
                    <span className="num">hype_yesterday</span> is never available and{" "}
                    <span className="num">HypeMomentum</span> evaluates to 0 for every theme. Every
                    TradeScore currently reduces to{" "}
                    <span className="num">
                      {dec(wTradeSent, 2)} × sentiment
                    </span>
                    , i.e. the direction is being set by VADER alone and{" "}
                    <span className="num">{dec(wTradeHype * 100, 0)}%</span> of the intended signal
                    is missing. Fixing it requires backfilling the per-run HypeScore into the
                    history table.
                  </Note>
                )}

                {!tradeExample ? (
                  <EmptyState
                    table="theme_signals_history"
                    cause={`None of the ${signals.rows.length} persisted rows carries a non-null trade_score, so there is no worked example to reconcile.`}
                    remedy="The L4 stage writes trade_score per theme per run_date. Run scripts/daily_refresh.py."
                  />
                ) : (
                  typeof tradeExample.trade_score === "number" &&
                  tradeMomentum !== null && (
                    <div className="card">
                      <div className="card-header">
                        <span className="card-title">
                          Most recent persisted TradeScore, recomputed
                        </span>
                        <span className="text-[11px] text-text-tertiary num">
                          run_date {tradeExample.run_date}
                        </span>
                      </div>
                      <div className="card-body grid grid-cols-1 gap-3">
                        <Formula>
                          {[
                            `theme          = ${tradeExampleTheme?.name ?? tradeExample.theme_id}`,
                            `hype_today     = ${tradeExample.hype_score === null ? "null" : dec(tradeExample.hype_score, 4)}`,
                            `hype_yesterday = ${
                              tradePrior && typeof tradePrior.hype_score === "number"
                                ? `${dec(tradePrior.hype_score, 4)}   (run_date ${tradePrior.run_date})`
                                : "unavailable"
                            }`,
                            `elapsed_days   = ${tradeElapsedDays ?? "n/a"}`,
                            `avg_sentiment  = ${tradeExample.avg_sentiment === null ? "null → treated as 0" : dec(tradeExample.avg_sentiment, 6)}`,
                            ``,
                            `  HypeMomentum = ${dec(tradeMomentum.value, 6)}   (${tradeMomentum.reason})`,
                            ``,
                            `  ${pad(`${dec(wTradeHype, 2)} × HypeMomentum`, 24)} = ${lpad(dec(wTradeHype * tradeMomentum.value, 6), 10)}`,
                            `  ${pad(`${dec(wTradeSent, 2)} × Sentiment`, 24)} = ${lpad(dec(wTradeSent * (tradeExample.avg_sentiment ?? 0), 6), 10)}`,
                            `  ${" ".repeat(24)}   ${"─".repeat(10)}`,
                            `  ${pad("TradeScore (recomputed)", 24)} = ${lpad(dec(tradeRecomputed ?? 0, 6), 10)}`,
                            `  ${pad("TradeScore (persisted)", 24)} = ${lpad(dec(tradeExample.trade_score, 6), 10)}`,
                            ``,
                            `  direction = sign(TradeScore) = ${tradeExample.trade_score > 0 ? "LONG" : tradeExample.trade_score < 0 ? "SHORT" : "neither (exactly zero)"}`,
                          ].join("\n")}
                        </Formula>

                        {tradeDelta !== null && Math.abs(tradeDelta) >= 1e-4 && (
                          <Note tone="bad" label="Recomputation does not match">
                            Recomputing from the persisted inputs gives{" "}
                            <span className="num">{dec(tradeRecomputed ?? 0, 6)}</span> against a
                            stored <Code>trade_score</Code> of{" "}
                            <span className="num">{dec(tradeExample.trade_score, 6)}</span> (Δ{" "}
                            <span className="num">
                              {tradeDelta >= 0 ? "+" : ""}
                              {dec(tradeDelta, 6)}
                            </span>
                            ). The score was written from inputs that differ from what{" "}
                            <Code>theme_signals_history</Code> now holds.
                          </Note>
                        )}

                        {tradeMomentum.value === 0 &&
                          tradeExample.avg_sentiment !== null &&
                          Math.abs(
                            wTradeSent * tradeExample.avg_sentiment - tradeExample.trade_score,
                          ) < 1e-4 && (
                            <Note tone="warn" label="The sentiment term alone reproduces the score">
                              <span className="num">
                                {dec(wTradeSent, 2)} × {dec(tradeExample.avg_sentiment, 6)} ={" "}
                                {dec(wTradeSent * tradeExample.avg_sentiment, 6)}
                              </span>{" "}
                              matches the persisted{" "}
                              <span className="num">
                                trade_score = {dec(tradeExample.trade_score, 6)}
                              </span>{" "}
                              to within 1e-4. Confirmed against the data: the HypeMomentum term
                              contributed exactly nothing to this score, because{" "}
                              {tradeMomentum.reason}.
                            </Note>
                          )}
                      </div>
                    </div>
                  )
                )}
              </div>
            )}
          </div>
        )}
      </Section>
      )}

      {/* ═══ 4. EdgeScore — direction ══════════════════════════════════════ */}
      {chapterOwns(chapter, "edgescore") && (
      <Section
        id="edgescore"
        index="04"
        title="EdgeScore — which side, how hard, and why"
        lede={
          <>
            The answer to task question 1&apos;s &ldquo;why long / why short&rdquo;. Direction is{" "}
            <span className="num">sign(EdgeScore)</span>, a weighted blend of four measurable
            expected-return proxies — trend, regime fit, carry and value — rather than the sign of
            near-zero news sentiment it used to collapse to (ADR-0031/0032). A theme whose signal is
            too weak takes <span className="text-text-primary">no position at all</span>, and the
            surviving names are sized by conviction, not by loudness.
          </>
        }
      >
        {cfg.error ? (
          <QueryError table="scoring_config" message={cfg.error} />
        ) : !edgeWeightsOk ? (
          <EmptyState
            table="scoring_config"
            cause={`Missing or non-numeric weight rows: ${missingEdgeWeights.join(", ") || "none parsed"}.`}
            remedy="Seed edge_trend_weight, edge_regime_weight, edge_carry_weight, edge_value_weight and edge_sentiment_weight into scoring_config. The 5-component formula cannot be rendered without all five."
          />
        ) : (
          <div className="grid grid-cols-1 gap-4">
            <Formula label="live weights from scoring_config">
              {[
                `EdgeScore = ${dec(wEdgeTrend ?? 0, 2)}·Trend  +  ${dec(wEdgeRegime ?? 0, 2)}·Regime  +  ${dec(wEdgeCarry ?? 0, 2)}·Carry  +  ${dec(wEdgeValue ?? 0, 2)}·Value  +  ${dec(wEdgeSentiment ?? 0, 2)}·Sentiment`,
                ``,
                `Trend     = tanh( mean 6-month basket return / 0.15 )          ∈ [−1, +1]`,
                `Regime    = risk_beta(asset_class)·sentiment_sign + cycle_tilt  ∈ [−1, +1]`,
                `Carry     = normalised yield / roll / funding advantage         ∈ [−1, +1]`,
                `Value     = z-score of the macro level vs its 252-day history   ∈ [−1, +1]`,
                `Sentiment = −tanh( avg VADER / 0.4 )  — CONTRARIAN: crowding to fade, not a buy`,
                ``,
                `direction = long    if EdgeScore ≥ +${dec(edgeAbstain ?? 0, 2)}`,
                `            short   if EdgeScore ≤ −${dec(edgeAbstain ?? 0, 2)}`,
                `            abstain if |EdgeScore| <  ${dec(edgeAbstain ?? 0, 2)}   (edge_abstain_threshold)`,
                ``,
                `conviction = |EdgeScore| / max(vol, ${dec(volFloor, 5)})   →  sizing weight ∝ conviction`,
                `             the floor (conviction_vol_floor, ~${dec((volFloor ?? 0) * Math.sqrt(252) * 100, 1)}% annualised) keeps the`,
                `             ratio describing the IDEA and not the denominator — ADR-0047`,
              ].join("\n")}
            </Formula>

            <div className="text-[12px] text-text-tertiary">
              Component weights sum to{" "}
              <span
                className={`num ${Math.abs((edgeWeightSum ?? 0) - 1) < 1e-9 ? "text-text-secondary" : "text-warning"}`}
              >
                {dec(edgeWeightSum ?? 0, 2)}
              </span>
              {Math.abs((edgeWeightSum ?? 0) - 1) < 1e-9
                ? " — a convex combination, so EdgeScore stays inside [−1, +1] where each component does."
                : " — not a convex combination, so the [−1, +1] envelope is not guaranteed."}
            </div>

            <div className="card">
              <div className="card-body grid grid-cols-1 gap-2.5 text-[12.5px] text-text-secondary max-w-[92ch]">
                <p className="m-0">
                  <span className="text-text-primary font-medium">Why not sentiment.</span> The old
                  rule set direction from <span className="num">sign(TradeScore)</span>, but on
                  sparse data HypeMomentum is ~0 and TradeScore reduces to the sign of a VADER score
                  hovering around zero — so a long/short call turned on news-tone noise. The four
                  EdgeScore components are slower and grounded in prices and fundamentals, which is
                  what a side ought to rest on.
                </p>
                <p className="m-0">
                  <span className="text-text-primary font-medium">Trend</span>{" "}
                  <span className="num">(w {dec(wEdgeTrend ?? 0, 2)})</span> — mean trailing six-month
                  return across the theme&apos;s mapped assets, squashed through{" "}
                  <span className="num">tanh(x / 0.15)</span> so a +15% basket maps to ~+0.76 and
                  extreme moves saturate instead of dominating. No computable return → 0.
                </p>
                <p className="m-0">
                  <span className="text-text-primary font-medium">Regime</span>{" "}
                  <span className="num">(w {dec(wEdgeRegime ?? 0, 2)})</span> — each asset class has a
                  risk-on beta (equity/credit <span className="num">+1</span>, government rates and
                  USD <span className="num">−1</span>), multiplied by the regime sentiment sign and
                  nudged by the cycle, so a risk-off tape shorts equity and goes long rates.
                </p>
                <p className="m-0">
                  <span className="text-text-primary font-medium">Carry</span>{" "}
                  <span className="num">(w {dec(wEdgeCarry ?? 0, 2)})</span> — the normalised
                  yield / roll / funding advantage of holding the position: a positive-carry long or
                  a negative-carry short is paid to wait, and the term tilts EdgeScore toward the
                  side that earns the carry rather than bleeds it.
                </p>
                <p className="m-0">
                  <span className="text-text-primary font-medium">Value</span>{" "}
                  <span className="num">(w {dec(wEdgeValue ?? 0, 2)})</span> — normalised cheapness
                  against a fair-value anchor: cheap tilts long, rich tilts short. Slow-moving, it is
                  the counterweight that keeps Trend from chasing an already-extended move.
                </p>
                <p className="m-0">
                  <span className="text-text-primary font-medium">Abstention.</span> When{" "}
                  <span className="num">|EdgeScore| &lt; {dec(edgeAbstain ?? 0, 2)}</span> the four
                  components have not agreed strongly enough to justify risk, and the theme is left
                  out of the book entirely — the discipline of <em>not</em> trading a weak signal is
                  as much of the edge as the trades taken. The roster below is who sat out this run.
                </p>
                <p className="m-0">
                  <span className="text-text-primary font-medium">Conviction sizing.</span> A
                  surviving name&apos;s pre-cap weight is <span className="num">∝ conviction =
                  |EdgeScore| / vol</span> — the classic conviction × inverse-vol rule, so a strong
                  signal in a quiet asset outsizes an equally strong signal in a jumpy one. This
                  replaces the old <span className="num">HypeScore / 100</span> sizing, which paid up
                  for attention rather than for edge-per-unit-risk. Caps (single-name / sector / geo)
                  are then applied — see the sizing walk-through under any trade&apos;s derivation.
                </p>
              </div>
            </div>

            {/* Live worked example — all four components reconciled to edge_score */}
            {signals.error ? (
              <QueryError table="theme_signals_history" message={signals.error} />
            ) : !anyEdge ? (
              <EmptyState
                table="theme_signals_history"
                cause="No row carries a non-null edge_score yet (columns exist but are unpopulated for these runs)."
                remedy="Run daily_refresh.py; compute_edge_scores writes edge_score with its four components (trend/regime/carry/value), conviction and vol."
              />
            ) : edgeExample && edgeTerms ? (
              <div className="card">
                <div className="card-header">
                  <span className="card-title">
                    Worked example{edgeExampleTheme ? ` · ${edgeExampleTheme.name}` : ""}
                  </span>
                  <span className="text-[11px] text-text-tertiary num">
                    theme_signals_history · run_date {edgeExample.run_date}
                  </span>
                </div>
                <div className="card-body grid grid-cols-1 gap-3">
                  <Note tone="info" label="Reading the block">
                    Each component is the value <Code>compute_edge_scores</Code> persisted for this
                    theme, multiplied by its live weight. A component shown as{" "}
                    <span className="num">null</span> was <strong>not computable</strong>, so it is{" "}
                    <strong>dropped and its weight redistributed</strong> over the components that
                    do exist — the weighted sum is divided by the weight actually present, not by
                    1.00. Scoring a missing component as 0 is not neutral: it would shrink
                    |EdgeScore| toward the abstention band and penalise a theme for a gap in our
                    data rather than judge it on the market&apos;s signal.
                  </Note>

                  <Formula label="substituting the persisted components">
                    {[
                      ...edgeTerms.map(
                        (t) =>
                          `  ${pad(t.sym, 20)} = ${dec(t.w, 2)} × ${
                            t.x === null ? pad("null", 8) : lpad(dec(t.x, 4), 8)
                          } = ${
                            t.x === null
                              ? `${lpad("—", 10)}   (dropped, weight redistributed)`
                              : lpad(dec(t.w * t.x, 6), 10)
                          }`,
                      ),
                      `  ${" ".repeat(20)}   ${" ".repeat(13)}${"─".repeat(10)}`,
                      `  ${pad("Σ weighted (present)", 20)} = ${" ".repeat(13)}${lpad(dec(edgeWeightedSum ?? 0, 6), 10)}`,
                      `  ${pad("Σ weight  (present)", 20)} = ${" ".repeat(13)}${lpad(dec(edgeWeightPresent ?? 0, 6), 10)}`,
                      `  ${pad("EdgeScore (recomputed)", 20)} = ${" ".repeat(13)}${lpad(dec(edgeRecomputed ?? 0, 6), 10)}   (Σ weighted / Σ weight)`,
                      `  ${pad("EdgeScore (persisted)", 20)} = ${" ".repeat(13)}${lpad(dec(edgeExample.edge_score ?? 0, 6), 10)}`,
                      ``,
                      `  |EdgeScore| = ${lpad(dec(Math.abs(edgeExample.edge_score ?? 0), 4), 8)}   vs abstain ${dec(edgeAbstain ?? 0, 2)}`,
                      `  direction   = ${
                        edgeAbstain !== null &&
                        typeof edgeExample.edge_score === "number" &&
                        Math.abs(edgeExample.edge_score) < edgeAbstain
                          ? "ABSTAIN (below threshold — no position)"
                          : (edgeExample.edge_score ?? 0) > 0
                            ? "LONG"
                            : (edgeExample.edge_score ?? 0) < 0
                              ? "SHORT"
                              : "abstain (exactly zero)"
                      }`,
                      `  vol         = ${edgeExample.vol === null ? "null" : dec(edgeExample.vol, 4)}`,
                      `  conviction  = |EdgeScore| / vol = ${edgeConviction === null ? "unavailable" : `${dec(edgeConviction, 3)}×`}${
                        edgeExample.conviction !== null ? "   (persisted)" : ""
                      }`,
                    ].join("\n")}
                  </Formula>

                  {/* EdgeScore lives on [-1,1] and its SIGN is the trade direction,
                      so it reads signed at 4dp against a 0.005 tolerance — a
                      tenth of HypeScore's scale. Same component, different scale,
                      one verdict rule. */}
                  <Reconciliation
                    verdict={reconcile(
                      edgeRecomputed,
                      typeof edgeExample.edge_score === "number"
                        ? edgeExample.edge_score
                        : null,
                      EDGE_TOLERANCE,
                    )}
                    labels={{
                      recomputed: "EdgeScore recomputed",
                      recomputedSub: "Σ weighted ÷ Σ weight present (ADR-0036)",
                      persisted: "Persisted edge_score",
                      persistedSub: "what sizing and the drawer read",
                    }}
                    format={{ decimals: 4, signed: true }}
                  />

                  {edgeDelta !== null && Math.abs(edgeDelta) >= EDGE_TOLERANCE && (
                    <Note tone="bad" label="Reconciliation failure">
                      Applying the live weights to the persisted components yields{" "}
                      <span className="num">{fmtSigned(edgeRecomputed ?? 0, 4)}</span>, but{" "}
                      <Code>theme_signals_history.edge_score</Code> holds{" "}
                      <span className="num">{fmtSigned(edgeExample.edge_score ?? 0, 4)}</span>. Either
                      the weights changed after this row was written, or a component column and the
                      score column were not written from the same inputs.
                    </Note>
                  )}
                </div>
              </div>
            ) : null}

            {/* Abstention roster — themes the engine declined this run */}
            <div>
              <SubHead
                note={
                  latestSignalDate ? (
                    <span className="num">
                      theme_signals_history · run_date {latestSignalDate}
                    </span>
                  ) : undefined
                }
              >
                Themes that abstained this run
              </SubHead>
              {edgeAbstain === null ? (
                <EmptyState
                  table="scoring_config"
                  cause="edge_abstain_threshold is missing or non-numeric, so no abstention line can be drawn."
                  remedy="Seed edge_abstain_threshold into scoring_config."
                />
              ) : scoredEdgeCount === 0 ? (
                <EmptyState
                  table="theme_signals_history"
                  cause={`No theme on the latest run_date${latestSignalDate ? ` (${latestSignalDate})` : ""} carries an edge_score, so abstention cannot be evaluated.`}
                  remedy="Run daily_refresh.py; compute_edge_scores writes edge_score for every scored theme."
                />
              ) : abstainedRoster.length === 0 ? (
                <Note tone="ok" label="Full conviction — nobody sat out">
                  All <span className="num">{scoredEdgeCount}</span> themes scored on{" "}
                  <span className="num">{latestSignalDate}</span> cleared{" "}
                  <span className="num">|EdgeScore| ≥ {dec(edgeAbstain, 2)}</span>, so every scored
                  theme took a side this run. Abstention is a live gate, not a permanent exclusion —
                  a theme drops out the moment its edge decays below the threshold.
                </Note>
              ) : (
                <div className="card">
                  <div className="card-header">
                    <span className="card-title">
                      {abstainedRoster.length} of {scoredEdgeCount} scored themes abstained
                    </span>
                    <span className="text-[11px] text-text-tertiary num">
                      |EdgeScore| &lt; {dec(edgeAbstain, 2)} · closest-to-a-trade first
                    </span>
                  </div>
                  <TableWrap>
                    <table className="w-full border-collapse text-[12.5px]">
                      <caption className="sr-only">
                        Themes whose EdgeScore fell below the abstention threshold on{" "}
                        {latestSignalDate}, with their four components.
                      </caption>
                      <thead>
                        <tr>
                          <Th>Theme</Th>
                          <Th align="right">EdgeScore</Th>
                          <Th align="right">Trend</Th>
                          <Th align="right">Regime</Th>
                          <Th align="right">Carry</Th>
                          <Th align="right">Value</Th>
                          <Th align="right">Gap to trade</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {abstainedRoster.map(({ row, name }) => {
                          const es = row.edge_score ?? 0;
                          const gap = edgeAbstain - Math.abs(es);
                          return (
                            <tr key={row.theme_id} className="hover:bg-bg-elevated">
                              <Td>{name}</Td>
                              <Td mono align="right" className="text-text-tertiary">
                                {fmtSigned(es, 3)}
                              </Td>
                              <Td mono align="right">
                                {row.trend_signal === null ? "—" : fmtSigned(row.trend_signal, 2)}
                              </Td>
                              <Td mono align="right">
                                {row.regime_bias === null ? "—" : fmtSigned(row.regime_bias, 2)}
                              </Td>
                              <Td mono align="right">
                                {row.carry_signal === null ? "—" : fmtSigned(row.carry_signal, 2)}
                              </Td>
                              <Td mono align="right">
                                {row.value_signal === null ? "—" : fmtSigned(row.value_signal, 2)}
                              </Td>
                              <Td mono align="right" className="text-warning">
                                {dec(gap, 3)}
                              </Td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </TableWrap>
                  <div className="px-4 py-2.5 text-[11.5px] text-text-tertiary leading-[1.55] border-t border-border">
                    &ldquo;Gap to trade&rdquo; is how much more <span className="num">|EdgeScore|</span>{" "}
                    each theme needs to clear the threshold. These are the themes to watch: a small gap
                    means one more session of trend or a regime flip could pull them into the book.
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Does the signal that decides the trades actually predict returns?
            Sits inside the EdgeScore section on purpose: a reader who has just
            read what the components ARE should immediately see what they are
            WORTH, rather than meeting the claim and the evidence on separate
            pages. */}
        <div className="mt-6">
          <EdgeValidation />
        </div>
      </Section>
      )}

      {/* ═══ 5. Factor model ═══════════════════════════════════════════════ */}
      {chapterOwns(chapter, "factors") && (
      <Section
        id="factors"
        index="05"
        title="Factor exposures — and do they reconcile?"
        lede={
          <>
            L2 regresses each asset&apos;s daily excess return on Fama-French 5 + UMD over a
            rolling 252-day window. Those betas are what the book&apos;s factor tilts and the
            scenario shocks are built from, so a tilt is only as trustworthy as the beta beneath
            it. Nothing on this site checked them until now — a factor model whose numbers nobody
            has reconciled is an assertion. The table below is the check a reviewer would ask
            for: assets whose market beta is known before you run anything.
          </>
        }
      >
        <FactorReconciliation />
      </Section>
      )}

      {/* ═══ 6. Data sources ═══════════════════════════════════════════════ */}
      {chapterOwns(chapter, "sources") && (
      <Section
        id="sources"
        index="06"
        title="Data sources and provenance"
        lede={
          <>
            Five external feeds. Counts below are live row counts, not capacity claims. A source
            that is not delivering shows as a small number here rather than as a confident score
            downstream.
          </>
        }
      >
        <div className="card mb-3">
          <TableWrap>
            <table className="w-full border-collapse text-[12.5px]">
              <caption className="sr-only">
                External data sources, the tables they land in, and live coverage counts.
              </caption>
              <thead>
                <tr>
                  <Th>Source</Th>
                  <Th>Lands in</Th>
                  <Th align="right">Rows</Th>
                  <Th align="right">Distinct</Th>
                  <Th>Latest</Th>
                  <Th>Consumed by</Th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <Td>FRED + yfinance</Td>
                  <Td mono>macro_indicators</Td>
                  <Td mono align="right">
                    {macro.error ? (
                      <span className="text-short">error</span>
                    ) : (
                      int(macro.count ?? macro.rows.length)
                    )}
                  </Td>
                  <Td mono align="right">
                    {macro.error ? "—" : `${macroSeries.size} series_id`}
                  </Td>
                  <Td mono>{macro.error ? "—" : (macroLatest ?? "—")}</Td>
                  <Td>L0 snapshot, L3 regime inputs, L5 citation source map</Td>
                </tr>
                <tr>
                  <Td>yfinance (index prices)</Td>
                  <Td mono>market_assets</Td>
                  <Td mono align="right">
                    {assets.error ? (
                      <span className="text-short">error</span>
                    ) : (
                      int(assets.count ?? assets.rows.length)
                    )}
                  </Td>
                  <Td mono align="right">—</Td>
                  <Td mono>{assets.error ? "—" : fmtTs(assetLatest)}</Td>
                  <Td>Market bar; price series for the |ρ| term</Td>
                </tr>
                <tr>
                  <Td>Brave News + Reddit</Td>
                  <Td mono>theme_signals_history</Td>
                  <Td mono align="right">
                    {signals.error ? (
                      <span className="text-short">error</span>
                    ) : (
                      int(signals.rows.length)
                    )}
                  </Td>
                  <Td mono align="right">
                    {signals.error ? "—" : `${latestSignals.length} themes @ latest`}
                  </Td>
                  <Td mono>{signals.error ? "—" : (latestSignalDate ?? "—")}</Td>
                  <Td>
                    L1 — every HypeScore term except the price leg.{" "}
                    <span className="num">Σ mention_count_1d</span> on{" "}
                    <span className="num">{latestSignalDate ?? "—"}</span> ={" "}
                    <span className="num">{signals.error ? "—" : int(mentionTotal)}</span>
                  </Td>
                </tr>
                <tr>
                  <Td>Ken French data library</Td>
                  <Td mono>factor_exposures</Td>
                  <Td mono align="right">
                    {factors.error ? (
                      <span className="text-short">error</span>
                    ) : (
                      int(factors.count ?? factors.rows.length)
                    )}
                  </Td>
                  <Td mono align="right">
                    {factors.error ? "—" : `${factorAssets.size} assets`}
                  </Td>
                  <Td mono>{factors.error ? "—" : (factorLatest ?? "—")}</Td>
                  <Td>L2 FF5 + UMD betas; L5 screening R² filter and book tilts</Td>
                </tr>
                <tr>
                  <Td>Polymarket</Td>
                  <Td mono>prediction_markets</Td>
                  <Td mono align="right">
                    {poly.error ? (
                      <span className="text-short">error</span>
                    ) : (
                      int(poly.count ?? poly.rows.length)
                    )}
                  </Td>
                  <Td mono align="right">—</Td>
                  <Td mono>{poly.error ? "—" : fmtTs(polyLatest)}</Td>
                  <Td>Event-probability cross-check on macro themes</Td>
                </tr>
              </tbody>
            </table>
          </TableWrap>
        </div>

        <div className="grid grid-cols-1 gap-3">
          {macro.error && <QueryError table="macro_indicators" message={macro.error} />}
          {assets.error && <QueryError table="market_assets" message={assets.error} />}
          {factors.error && <QueryError table="factor_exposures" message={factors.error} />}
          {poly.error && <QueryError table="prediction_markets" message={poly.error} />}

          {!macro.error && macroSeries.size > 0 && (
            <Note tone="info" label={`macro_indicators · ${macroSeries.size} distinct series_id`}>
              <span className="num text-[11.5px] break-words">
                {Array.from(macroSeries).sort().join(", ")}
              </span>
              <div className="mt-1 text-text-tertiary">
                The column mixes FRED series codes and yfinance tickers in one namespace; both are
                addressed by <Code>series_id</Code> and both are eligible citation source keys for
                the L5 agent.
              </div>
            </Note>
          )}

          {/* Provenance */}
          <div>
            <SubHead note="migration 020_signal_provenance.sql">
              Attention-signal provenance
            </SubHead>
            {prov.error ? (
              <Note tone="bad" label="Provenance tracking not yet deployed">
                Querying <Code>theme_signals_history.data_source</Code> failed:{" "}
                <span className="num break-words">{prov.error}</span>
                <div className="mt-1.5">
                  Migration <Code>020_signal_provenance.sql</Code> defines this column to record
                  whether a theme&apos;s attention signal came from live Brave/Reddit responses
                  (<span className="num">real</span>), from the mock fallback that fires when API
                  credentials are absent (<span className="num">mock</span>), from a mix (
                  <span className="num">mixed</span>), or from nothing at all (
                  <span className="num">none</span>). Until the migration is applied to this
                  database, a HypeScore computed from fabricated text is indistinguishable in the
                  schema from one computed from real headlines. Treat every score on this page as
                  provenance-unknown.
                </div>
                <div className="mt-1.5 text-text-tertiary">
                  Remedy: apply <span className="num">supabase/migrations/020_signal_provenance.sql</span>{" "}
                  and re-run the L1 stage so <span className="num">data_source</span> is populated.
                </div>
              </Note>
            ) : provBuckets.size === 0 ? (
              <EmptyState
                table="theme_signals_history"
                cause="The data_source column exists but no rows were returned for the latest run_date."
                remedy="Run scripts/daily_refresh.py; persist() classifies each theme's collected text and writes data_source."
              />
            ) : (
              <div className="card">
                <div className="card-header">
                  <span className="card-title">
                    data_source breakdown · run_date {provLatest}
                  </span>
                  <span className="text-[11px] text-text-tertiary num">
                    {Array.from(provBuckets.values()).reduce((a, b) => a + b, 0)} rows
                  </span>
                </div>
                <TableWrap>
                  <table className="w-full border-collapse text-[12.5px]">
                    <caption className="sr-only">
                      Count of theme signal rows by data_source on the latest run date.
                    </caption>
                    <thead>
                      <tr>
                        <Th>data_source</Th>
                        <Th align="right">Themes</Th>
                        <Th>Meaning</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from(provBuckets.entries())
                        .sort((a, b) => b[1] - a[1])
                        .map(([k, n]) => (
                          <tr key={k}>
                            <Td mono>
                              <span
                                className={
                                  k === "real"
                                    ? "text-long"
                                    : k === "mock"
                                      ? "text-short"
                                      : k === "mixed"
                                        ? "text-warning"
                                        : "text-text-tertiary"
                                }
                              >
                                {k}
                              </span>
                            </Td>
                            <Td mono align="right">
                              {n}
                            </Td>
                            <Td>
                              {k === "real"
                                ? "All collected text came from live Brave/Reddit responses."
                                : k === "mock"
                                  ? "All text came from the fallback stub — the HypeScore for these themes is not a market observation."
                                  : k === "mixed"
                                    ? "Some live, some fallback — the score is partly synthetic."
                                    : k === "none"
                                      ? "Nothing was collected for this theme."
                                      : "Value not defined by migration 020."}
                            </Td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </TableWrap>
              </div>
            )}
          </div>
        </div>
      </Section>
      )}

      {/* ═══ 6. Guardrails ═════════════════════════════════════════════════ */}
      {chapterOwns(chapter, "guardrails") && (
      <Section
        id="guardrails"
        index="07"
        title="Guardrails on the reasoning layer"
        lede={
          <>
            L5 is the only stage that lets a language model touch the output. It is fenced in two
            directions: the model only ever sees a frozen L0–L4 snapshot, and every numeric claim
            it makes is reconciled against that snapshot before anything is persisted. The audit
            log below is <Code>research_agent_runs</Code>, unfiltered.
          </>
        }
      >
        <div className="card mb-3">
          <div className="card-body grid grid-cols-1 gap-2.5 text-[12.5px] text-text-secondary max-w-[92ch]">
            <p className="m-0">
              <span className="text-text-primary font-medium">The contract.</span> The agent must
              emit, alongside its prose, a{" "}
              <Code>citations</Code> array in which every numeric claim carries a{" "}
              <Code>source</Code> key and the <Code>value</Code> it asserts. Verification is a
              pure function with two tests per citation: the source key must exist in the frozen
              snapshot (macro series IDs, <span className="num">theme:&lt;id&gt;:hype|trade|sentiment</span>,
              and the risk metrics), and the asserted value must match the snapshot within{" "}
              <span className="num">max(0.01, 2% × |actual|)</span>. A recognised key carrying the
              wrong number fails — catching value hallucination, not just invented sources.
            </p>
            <p className="m-0">
              <span className="text-text-primary font-medium">On failure.</span> Any failed
              citation rejects the whole output and re-runs the reasoning node, up to 2 retries.
              Exhausting them drops to a deterministic fallback book built by rule from the same
              inputs. An empty citations array is itself a failure — silence is not compliance.
            </p>
            <p className="m-0">
              <span className="text-text-primary font-medium">Known limitation.</span> A citation
              whose declared value matches its source but whose prose describes a different
              quantity is a source-selection error, and this verifier does not catch it. It checks
              arithmetic correspondence, not semantic correspondence.
            </p>
          </div>
        </div>

        {agent.error ? (
          <QueryError table="research_agent_runs" message={agent.error} />
        ) : totalAgentRuns === 0 ? (
          <EmptyState
            table="research_agent_runs"
            cause="No agent runs are logged, so the guardrail has never been exercised on this database."
            remedy="Run the L5 stage (scripts/daily_refresh.py invokes run_q1_agent); it writes one row per invocation."
          />
        ) : (
          <div className="grid grid-cols-1 gap-3">
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              <Stat label="Runs logged" value={int(totalAgentRuns)} sub="research_agent_runs" />
              <Stat
                label="Verified"
                value={`${dec((verifiedRuns / totalAgentRuns) * 100, 0)}%`}
                tone={verifiedRuns === totalAgentRuns ? "good" : "warn"}
                sub={`${verifiedRuns} of ${totalAgentRuns} rows`}
              />
              <Stat
                label="Avg retries"
                value={avgRetries === null ? "—" : dec(avgRetries, 2)}
                tone={avgRetries !== null && avgRetries > 0 ? "warn" : "default"}
                sub={maxRetries === null ? "no retries column data" : `max ${maxRetries}`}
              />
              <Stat
                label="Zero-citation runs"
                value={int(zeroCitationRuns)}
                tone={zeroCitationRuns > 0 ? "bad" : "good"}
                sub="empty or absent citations array"
              />
              <Stat
                label="Unverified"
                value={int(unverifiedRuns)}
                tone={unverifiedRuns > 0 ? "bad" : "good"}
                sub="verified = false"
              />
            </div>

            {zeroCitationRuns === totalAgentRuns && (
              <Note tone="bad" label="Not one run produced a citation">
                All <span className="num">{totalAgentRuns}</span> rows in{" "}
                <Code>research_agent_runs</Code> carry an empty{" "}
                <Code>citations</Code> array. The guardrail&apos;s entire evidence trail is
                therefore empty: nothing on <Code>/research</Code> is backed by a verified numeric
                claim, whatever the <span className="num">verified</span> flag says.
              </Note>
            )}

            {fallbackSignature > 0 && (
              <Note tone="warn" label="Deterministic fallback signature">
                <span className="num">{fallbackSignature}</span> run
                {fallbackSignature === 1 ? "" : "s"} carry{" "}
                <span className="num">verified = true</span> with zero citations. Verification
                rejects an empty citations array outright, so that combination cannot come from the
                verifier — it is the deterministic fallback path, which sets{" "}
                <span className="num">verified = true</span>, clears the citations and increments
                the retry counter. Those runs are rule-built books, not LLM-reasoned ones, and
                should not be read as model-verified output.
              </Note>
            )}

            {unverifiedRuns > 0 && (
              <Note tone="bad" label="Runs that never verified">
                <span className="num">{unverifiedRuns}</span> run
                {unverifiedRuns === 1 ? " is" : "s are"} persisted with{" "}
                <span className="num">verified = false</span>
                {retryVals.length > 0 && (
                  <>
                    {" "}
                    at retry counts{" "}
                    <span className="num">
                      {Array.from(
                        new Set(
                          agent.rows
                            .filter((r) => r.verified === false && typeof r.retries === "number")
                            .map((r) => r.retries as number),
                        ),
                      )
                        .sort((a, b) => a - b)
                        .join(", ")}
                    </span>
                  </>
                )}
                . The documented retry budget is 2, so a persisted counter above that is not a
                per-call retry index and cannot be read as one.
              </Note>
            )}

            {nonArrayCitations > 0 && (
              <Note tone="warn" label="Non-array citations payload">
                <span className="num">{nonArrayCitations}</span> row
                {nonArrayCitations === 1 ? " has" : "s have"} a{" "}
                <Code>citations</Code> value that is not a JSON array; its length cannot be counted
                and it is reported as zero above.
              </Note>
            )}

            <div className="card">
              <div className="card-header">
                <span className="card-title">Agent run audit log</span>
                <span className="text-[11px] text-text-tertiary num">
                  {totalAgentRuns} row{totalAgentRuns === 1 ? "" : "s"} · newest first
                </span>
              </div>
              <TableWrap>
                <table className="w-full border-collapse text-[12.5px]">
                  <caption className="sr-only">
                    Every logged L5 agent run with its prompt version, model, verification result,
                    retry count and citation count.
                  </caption>
                  <thead>
                    <tr>
                      <Th>run_date</Th>
                      <Th>prompt_version</Th>
                      <Th>model_id</Th>
                      <Th align="right">verified</Th>
                      <Th align="right">retries</Th>
                      <Th align="right">citations</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {agent.rows.map((r, i) => (
                      <tr key={`${r.run_date}-${i}`} className="hover:bg-bg-elevated">
                        <Td mono>{r.run_date}</Td>
                        <Td mono>{r.prompt_version ?? "—"}</Td>
                        <Td mono>{r.model_id ?? "—"}</Td>
                        <Td align="right">
                          <span
                            className={
                              r.verified === true
                                ? "badge badge-long"
                                : r.verified === false
                                  ? "badge badge-short"
                                  : "badge badge-neutral"
                            }
                          >
                            {r.verified === null ? "null" : String(r.verified)}
                          </span>
                        </Td>
                        <Td mono align="right">
                          {r.retries ?? "null"}
                        </Td>
                        <Td
                          mono
                          align="right"
                          className={citationCount(r) === 0 ? "text-short" : ""}
                        >
                          {citationCount(r)}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            </div>
          </div>
        )}
      </Section>
      )}

      <footer className="mt-10 pt-5 border-t border-border text-[11.5px] text-text-tertiary max-w-[92ch]">
        Every figure on this page was read from Supabase in the browser at page load. Formulas are
        rendered from <Code>scoring_config</Code> at render time, so changing a weight in the
        database changes both the scoring and this explanation together. Nothing here is hardcoded;
        where a number is missing, the panel above names the table and column responsible.
        {/* Static cross-chapter pointer. The segmented control at the top is the
            primary route, but it is above the fold and a reader who has scrolled
            this far has passed it — and the guardrail audit is the single
            strongest credibility artefact on the site, so it must not depend on
            noticing one control. Works with JS off. */}
        {chapter === "build" ? (
          <>
            {" "}
            Pipeline status, data sources and the guardrails on the reasoning layer are on{" "}
            <Link href={CHAPTER_ROUTE.evidence} className="text-accent hover:underline">
              Method · Evidence it ran
            </Link>
            .
          </>
        ) : (
          <>
            {" "}
            The formulas these runs executed — HypeScore, TradeScore, EdgeScore and the factor
            model — are on{" "}
            <Link href={CHAPTER_ROUTE.build} className="text-accent hover:underline">
              Method · How it is built
            </Link>
            .
          </>
        )}
      </footer>
    </main>
  );
}
