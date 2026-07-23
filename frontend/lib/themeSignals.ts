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
}

const EMPTY_HISTORY: ThemeHistory = {
  points: [],
  hypeSeries: [],
  delta1d: null,
  delta5d: null,
  percentile: null,
};

function summarise(points: ThemeSignalPoint[]): ThemeHistory {
  const scored = points.filter(
    (p): p is ThemeSignalPoint & { hype_score: number } =>
      typeof p.hype_score === "number" && !Number.isNaN(p.hype_score)
  );
  const hypeSeries = scored.map((p) => p.hype_score);

  if (hypeSeries.length === 0) return { ...EMPTY_HISTORY, points };

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
      "theme_id, run_date, hype_score, trade_score, mention_count_1d, avg_sentiment, price_corr"
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
