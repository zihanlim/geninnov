// frontend/lib/themeSignals.ts
//
// Shared read-model for theme attention signals.
//
// Two defects this exists to fix once, rather than in every component:
//
// 1. UNIT MISMATCH. `themes.hype_score` is persisted on a 0–100 scale, but the
//    four sub-scores (volume/sentiment/corr/momentum) are persisted as [0,1]
//    decimals by daily_refresh.persist(). Components were reading both off the
//    same row and rendering them on one scale, so every sub-score cell showed
//    "1" against a colour ramp centred on 50. `toDisplayScore` is the single
//    conversion point.
//
// 2. NO HISTORY. `theme_signals_history` carries a daily row per theme, which is
//    the only place a change-in-attention can come from. Nothing read it, so
//    every delta rendered "—" and the Sparkline component was never fed. These
//    helpers load it and derive real deltas instead of inventing them.

import { supabase } from "@/lib/supabase";

/** A theme's persisted sub-scores are [0,1]; hype_score is 0–100. */
export const SUBSCORE_MAX = 1;
export const HYPE_MAX = 100;

/**
 * Convert a persisted [0,1] sub-score to the 0–100 scale used for display and
 * for the heatmap colour ramp. Returns null for absent values so callers render
 * an explicit "—" rather than a misleading 0.
 */
export function toDisplayScore(v: number | null | undefined): number | null {
  if (v === null || v === undefined || Number.isNaN(v)) return null;
  return v * (HYPE_MAX / SUBSCORE_MAX);
}

export interface ThemeSignalPoint {
  run_date: string;
  hype_score: number | null;
  trade_score: number | null;
  mention_count_1d: number | null;
  /**
   * Trailing 7-day average of daily mention counts. The 1-day count is often 0
   * (a run frequently collects no article dated that exact day), so the windowed
   * average is the stable "attention volume" figure a card should headline.
   */
  mention_count_7d_avg: number | null;
  avg_sentiment: number | null;
  price_corr: number | null;
}

export interface ThemeHistory {
  /** Ascending by run_date. */
  points: ThemeSignalPoint[];
  /** Hype series with nulls dropped — what Sparkline consumes. */
  hypeSeries: number[];
  /** Latest minus previous. Null when fewer than 2 scored observations exist. */
  delta1d: number | null;
  /** Latest minus the observation ~5 sessions back. Null when unavailable. */
  delta5d: number | null;
  /**
   * Where the latest score sits within its own history, 0–100.
   * This is the "crowding" measure — an attention score only means something
   * relative to how much attention that theme normally gets. Null under 5 obs.
   */
  percentile: number | null;
  /**
   * Raw mention count on the most recent run (`mention_count_1d`) — the literal
   * news + social volume that feeds the attention score. Taken from the latest
   * row regardless of whether it carries a scored hype_score, so the headline
   * "Mentions" figure is populated even before the hype series is backfilled.
   * Null only when no row carries a count.
   */
  latestMentionCount: number | null;
  /**
   * Trailing 7-day average daily mentions on the most recent run. This is the
   * headline "attention volume" a card shows, because the 1-day count is often
   * zero even for a theme with real weekly attention. Null when unavailable.
   */
  latestMention7dAvg: number | null;
}

const EMPTY_HISTORY: ThemeHistory = {
  points: [],
  hypeSeries: [],
  delta1d: null,
  delta5d: null,
  percentile: null,
  latestMentionCount: null,
  latestMention7dAvg: null,
};

function summarise(points: ThemeSignalPoint[]): ThemeHistory {
  // Latest mention figures are independent of the hype series: `points` is
  // ascending by run_date, so the last row carries today's attention volume.
  let latestMentionCount: number | null = null;
  let latestMention7dAvg: number | null = null;
  for (let i = points.length - 1; i >= 0; i--) {
    const m = points[i].mention_count_1d;
    if (latestMentionCount === null && typeof m === "number" && !Number.isNaN(m)) {
      latestMentionCount = m;
    }
    const a = points[i].mention_count_7d_avg;
    if (latestMention7dAvg === null && typeof a === "number" && !Number.isNaN(a)) {
      latestMention7dAvg = a;
    }
    if (latestMentionCount !== null && latestMention7dAvg !== null) break;
  }

  const scored = points.filter(
    (p): p is ThemeSignalPoint & { hype_score: number } =>
      typeof p.hype_score === "number" && !Number.isNaN(p.hype_score)
  );
  const hypeSeries = scored.map((p) => p.hype_score);

  if (hypeSeries.length === 0)
    return {
      ...EMPTY_HISTORY,
      points,
      latestMentionCount,
      latestMention7dAvg,
    };

  const latest = hypeSeries[hypeSeries.length - 1];
  const prev = hypeSeries.length >= 2 ? hypeSeries[hypeSeries.length - 2] : null;
  const back5 =
    hypeSeries.length >= 6 ? hypeSeries[hypeSeries.length - 6] : null;

  // Percentile of the latest value within its own history. Needs a meaningful
  // sample; below 5 observations the number would be noise dressed as signal.
  let percentile: number | null = null;
  if (hypeSeries.length >= 5) {
    const below = hypeSeries.filter((v) => v < latest).length;
    percentile = (below / (hypeSeries.length - 1)) * 100;
  }

  return {
    points,
    hypeSeries,
    delta1d: prev === null ? null : latest - prev,
    delta5d: back5 === null ? null : latest - back5,
    percentile,
    latestMentionCount,
    latestMention7dAvg,
  };
}

/**
 * Load per-theme attention history.
 *
 * Returns a map keyed by theme_id. A theme with no scored rows yields an empty
 * history rather than being omitted, so callers can distinguish "no data" from
 * "theme not found".
 *
 * `theme_signals_history.hype_score` is NULL for every row written before the
 * column was populated, so an empty `hypeSeries` on a theme that clearly has
 * signals is expected until that data is backfilled — surface it as unavailable,
 * never as zero.
 */
export async function fetchThemeHistories(
  themeIds: string[],
  days = 30
): Promise<{ byTheme: Record<string, ThemeHistory>; error: string | null }> {
  if (themeIds.length === 0) return { byTheme: {}, error: null };

  const { data, error } = await supabase
    .from("theme_signals_history")
    .select(
      "theme_id, run_date, hype_score, trade_score, mention_count_1d, mention_count_7d_avg, avg_sentiment, price_corr"
    )
    .in("theme_id", themeIds)
    .order("run_date", { ascending: true })
    .limit(themeIds.length * days);

  if (error) {
    return { byTheme: {}, error: error.message };
  }

  const grouped: Record<string, ThemeSignalPoint[]> = {};
  for (const row of data ?? []) {
    const id = (row as { theme_id: string }).theme_id;
    (grouped[id] ??= []).push(row as unknown as ThemeSignalPoint);
  }

  const byTheme: Record<string, ThemeHistory> = {};
  for (const id of themeIds) {
    byTheme[id] = summarise(grouped[id] ?? []);
  }
  return { byTheme, error: null };
}

/**
 * How many scored observations exist across all themes. Used to decide whether
 * to show history-dependent UI at all, or to explain why it is missing.
 */
export function totalScoredObservations(
  byTheme: Record<string, ThemeHistory>
): number {
  return Object.values(byTheme).reduce((n, h) => n + h.hypeSeries.length, 0);
}

// ── EdgeScore: the direction signal (ADR-0031) ──────────────────────────────
//
// Direction is `sign(EdgeScore)`, NOT `sign(TradeScore)`. EdgeScore =
// w_trend·trend + w_regime·regime_bias, anchoring long/short to a price-trend
// and regime-fit basis instead of near-zero news sentiment. TradeScore now only
// ranks WITHIN a side. Persisted on theme_signals_history by migration 023,
// explicitly "for /method and the derivation drawer" — so anything that shows a
// direction must read it here rather than reconstructing the superseded rule.

export interface ThemeEdge {
  edge_score: number | null;
  /** The four EdgeScore components, each in [-1, 1] (ADR-0031/0032). */
  trend_signal: number | null;
  regime_bias: number | null;
  carry_signal: number | null;
  value_signal: number | null;
  /** Contrarian sentiment tilt (Stage 5), in [-1, 1]. */
  sentiment_signal: number | null;
  /** conviction = |edge_score| / vol — the Stage-4 sizing weight. */
  conviction: number | null;
  vol: number | null;
  /** Resolved side, sign(edge_score). null = abstain / unknown. */
  direction: "long" | "short" | null;
  run_date: string | null;
}

/** The four EdgeScore component weights (from scoring_config), with defaults
 * matching migration 024. Callers should override with live scoring_config. */
export interface EdgeWeights {
  trend: number;
  regime: number;
  carry: number;
  value: number;
  sentiment: number;
  abstainThreshold: number;
}

/** IC-informed defaults (ADR-0033); the live values come from scoring_config. */
export const DEFAULT_EDGE_WEIGHTS: EdgeWeights = {
  trend: 0.2,
  regime: 0.23,
  carry: 0.34,
  value: 0.18,
  sentiment: 0.05,
  abstainThreshold: 0.15,
};

/** Weighted contribution of each component to the EdgeScore, for the bar
 * decomposition. Components absent (null) contribute 0 and are flagged. */
export function edgeContributions(edge: ThemeEdge, w: EdgeWeights) {
  return [
    { key: "Trend", raw: edge.trend_signal, weight: w.trend, contribution: (edge.trend_signal ?? 0) * w.trend },
    { key: "Regime", raw: edge.regime_bias, weight: w.regime, contribution: (edge.regime_bias ?? 0) * w.regime },
    { key: "Carry", raw: edge.carry_signal, weight: w.carry, contribution: (edge.carry_signal ?? 0) * w.carry },
    { key: "Value", raw: edge.value_signal, weight: w.value, contribution: (edge.value_signal ?? 0) * w.value },
    { key: "Sentiment", raw: edge.sentiment_signal, weight: w.sentiment, contribution: (edge.sentiment_signal ?? 0) * w.sentiment },
  ];
}

/** A PLAIN-ENGLISH rationale that names the dominant driver, e.g.
 * "Long · riding a strong price uptrend" or
 * "Short · a price downtrend outweighs a supportive regime".
 * The numeric breakdown lives in edgeRationale / the EdgeScore bars — this is the
 * always-visible line a reader understands without decoding component values. */
export function plainRationale(edge: ThemeEdge, w: EdgeWeights = DEFAULT_EDGE_WEIGHTS): string | null {
  if (edge.edge_score === null) return null;
  const abstained = Math.abs(edge.edge_score) < w.abstainThreshold;
  const side = abstained ? "Held out" : (edge.edge_score >= 0 ? "Long" : "Short");
  const phrase = (key: string, raw: number): string => {
    const up = raw >= 0;
    switch (key) {
      case "Trend": return up ? "a strong price uptrend" : "a price downtrend";
      case "Regime": return up ? "a supportive macro regime" : "an unfavourable macro regime";
      case "Carry": return up ? "attractive carry (paid to hold)" : "negative carry";
      case "Value": return up ? "a cheap valuation vs its own history" : "a rich valuation vs its own history";
      case "Sentiment": return up ? "a fadeable pessimistic crowd" : "a fadeable optimistic crowd";
      default: return "its edge signals";
    }
  };
  const contribs = edgeContributions(edge, w)
    .filter((c) => c.raw !== null && Math.abs(c.contribution) > 1e-9)
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  if (contribs.length === 0) return `${side} · weak net edge`;
  const lead = contribs[0];
  const sideSign = (edge.edge_score ?? 0) >= 0 ? 1 : -1;
  const opposer = contribs.find(
    (c) => Math.sign(c.contribution) !== sideSign && Math.abs(c.contribution) > Math.abs(lead.contribution) * 0.5
  );
  if (abstained) {
    return opposer
      ? "Held out · signals conflict, no net edge"
      : "Held out · signal too weak to trade";
  }
  const base = `${side} · ${phrase(lead.key, lead.raw as number)}`;
  return opposer ? `${base}, outweighing ${phrase(opposer.key, opposer.raw as number)}` : base;
}

/** One-line, IC-defensible rationale, e.g.
 * "Short — trend -0.90, regime +0.50, carry 0.00, value 0.00, sent +0.01 · conviction 9.5x". */
export function edgeRationale(edge: ThemeEdge): string {
  if (edge.edge_score === null) return "EdgeScore not yet computed";
  const side = edge.direction ? edge.direction[0].toUpperCase() + edge.direction.slice(1) : "Abstain";
  const f = (v: number | null) => (v === null ? "n/a" : v.toFixed(2));
  const conv = edge.conviction === null ? "" : ` · conviction ${edge.conviction.toFixed(1)}×`;
  return `${side} — trend ${f(edge.trend_signal)}, regime ${f(edge.regime_bias)}, carry ${f(edge.carry_signal)}, value ${f(edge.value_signal)}, sent ${f(edge.sentiment_signal)}${conv}`;
}

function edgeDirection(edge: number | null, abstainThreshold = 0): "long" | "short" | null {
  if (edge === null || Number.isNaN(edge)) return null;
  if (Math.abs(edge) < abstainThreshold) return null; // abstained — weak signal
  if (edge === 0) return null;
  return edge > 0 ? "long" : "short";
}

/**
 * Latest EdgeScore breakdown per theme, keyed by theme_id.
 *
 * A theme whose latest row predates migration 023 has null components — render
 * that as "not yet computed", never as a zero tilt. The `error` field is set on
 * a query failure (e.g. the columns don't exist yet) so callers can say so
 * rather than silently showing every direction as unknown.
 */
export async function fetchThemeEdge(
  themeIds: string[]
): Promise<{ byTheme: Record<string, ThemeEdge>; error: string | null }> {
  if (themeIds.length === 0) return { byTheme: {}, error: null };

  const { data, error } = await supabase
    .from("theme_signals_history")
    .select(
      "theme_id, run_date, edge_score, trend_signal, regime_bias, carry_signal, value_signal, sentiment_signal, conviction, vol"
    )
    .in("theme_id", themeIds)
    .order("run_date", { ascending: false })
    .limit(themeIds.length * 40);

  if (error) return { byTheme: {}, error: error.message };

  // First (most recent) row per theme wins.
  const byTheme: Record<string, ThemeEdge> = {};
  for (const row of data ?? []) {
    const r = row as {
      theme_id: string;
      run_date: string;
      edge_score: number | null;
      trend_signal: number | null;
      regime_bias: number | null;
      carry_signal: number | null;
      value_signal: number | null;
      sentiment_signal: number | null;
      conviction: number | null;
      vol: number | null;
    };
    if (byTheme[r.theme_id]) continue;
    byTheme[r.theme_id] = {
      edge_score: r.edge_score,
      trend_signal: r.trend_signal,
      regime_bias: r.regime_bias,
      carry_signal: r.carry_signal,
      value_signal: r.value_signal,
      sentiment_signal: r.sentiment_signal,
      conviction: r.conviction,
      vol: r.vol,
      direction: edgeDirection(r.edge_score),
      run_date: r.run_date,
    };
  }
  return { byTheme, error: null };
}

/**
 * The abstention roster: themes the engine considered but declined because
 * |EdgeScore| < abstain_threshold (ADR-0032). These are computed every run and
 * never surfaced today. Returns themes sorted by |EdgeScore| descending (the
 * "closest to a trade" first). `abstainThreshold` should come from scoring_config.
 */
export function abstainedThemes(
  byTheme: Record<string, ThemeEdge>,
  themeNames: Record<string, string>,
  abstainThreshold: number
): Array<ThemeEdge & { theme_id: string; name: string }> {
  return Object.entries(byTheme)
    .filter(([, e]) => e.edge_score !== null && Math.abs(e.edge_score) < abstainThreshold)
    .map(([theme_id, e]) => ({ ...e, theme_id, name: themeNames[theme_id] ?? theme_id }))
    .sort((a, b) => Math.abs(b.edge_score ?? 0) - Math.abs(a.edge_score ?? 0));
}
