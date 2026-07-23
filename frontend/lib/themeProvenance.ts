// frontend/lib/themeProvenance.ts
//
// Two Themes-home concerns that are NOT the direction/edge read-model in
// themeSignals.ts (which is shared and must not be edited), kept separate so
// this file can grow without touching it:
//
// 1. PROVENANCE. `theme_signals_history.data_source` (migration 020) records
//    whether a theme's attention signal came from live Brave/Reddit responses
//    ("real"), the mock fallback that fires when credentials are absent
//    ("mock"), a mix of both ("mixed"), or nothing ("none"/null). This honesty
//    lived only on /method; a PM ranking themes on the home page had no way to
//    see that a HypeScore was partly synthetic. `fetchThemeProvenance` surfaces
//    the latest-run classification per theme.
//
// 2. ATTENTION CONCENTRATION. The book has a concentration HHI; attention
//    itself can crowd into a few themes on a given day, which is the same
//    question one layer up. `attentionConcentration` computes the HHI and
//    top-3 share of HypeScore across the current theme set.

import { supabase } from "@/lib/supabase";

/** The provenance classes persisted by daily_refresh.persist() (migration 020). */
export type DataSource = "real" | "mock" | "mixed" | "none";

export interface ThemeProvenance {
  /** Normalised data_source for the theme's latest scored row. null = column
   * absent / no row, which must render as "unknown", never as "real". */
  data_source: DataSource | null;
  run_date: string | null;
}

/** Normalise a raw data_source string to a known class. Unknown strings that
 * look synthetic (e.g. "mock_brave") collapse to "mock" so the honesty flag
 * still fires; anything else we cannot vouch for becomes null (unknown). */
function normaliseSource(raw: string | null): DataSource | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  if (s === "real") return "real";
  if (s === "mixed") return "mixed";
  if (s === "none") return "none";
  if (s.startsWith("mock") || s.includes("synthetic") || s.includes("fallback"))
    return "mock";
  return null;
}

/** Is this score wholly or partly synthetic? Used to flag a HypeScore visibly. */
export function isSynthetic(p: DataSource | null): boolean {
  return p === "mock" || p === "mixed";
}

/** Colour token for a provenance dot, matching the /method vocabulary. */
export function provenanceColor(p: DataSource | null): string {
  switch (p) {
    case "real":
      return "var(--long)";
    case "mixed":
      return "var(--warning)";
    case "mock":
      return "var(--short)";
    default:
      return "var(--text-tertiary)";
  }
}

/** One-line human label for a provenance class. */
export function provenanceLabel(p: DataSource | null): string {
  switch (p) {
    case "real":
      return "Live Brave/Reddit signal";
    case "mixed":
      return "Mixed — some sources fell back to mock";
    case "mock":
      return "Mock fallback — no live signal; treat score as synthetic";
    case "none":
      return "No signal collected this run";
    default:
      return "Provenance unknown (data_source not populated)";
  }
}

/**
 * Latest-run data_source per theme, keyed by theme_id.
 *
 * `error` is set when the column does not exist yet (migration 020 not applied)
 * so callers can render "provenance unknown" rather than silently implying every
 * score is real.
 */
export async function fetchThemeProvenance(
  themeIds: string[]
): Promise<{ byTheme: Record<string, ThemeProvenance>; error: string | null }> {
  if (themeIds.length === 0) return { byTheme: {}, error: null };

  const { data, error } = await supabase
    .from("theme_signals_history")
    .select("theme_id, run_date, data_source")
    .in("theme_id", themeIds)
    .order("run_date", { ascending: false })
    .limit(themeIds.length * 40);

  if (error) return { byTheme: {}, error: error.message };

  // First (most recent) row per theme wins.
  const byTheme: Record<string, ThemeProvenance> = {};
  for (const row of data ?? []) {
    const r = row as { theme_id: string; run_date: string; data_source: string | null };
    if (byTheme[r.theme_id]) continue;
    byTheme[r.theme_id] = {
      data_source: normaliseSource(r.data_source),
      run_date: r.run_date,
    };
  }
  return { byTheme, error: null };
}

export interface AttentionConcentration {
  /** Herfindahl-Hirschman index of HypeScore shares, 0–1 (1 = one theme owns
   * all attention). Null when fewer than 2 themes carry a positive score. */
  hhi: number | null;
  /** Combined HypeScore share of the top 3 themes, 0–1. Null when unavailable. */
  top3Share: number | null;
  /** How many themes carried a positive HypeScore — the effective breadth. */
  scoredCount: number;
  /** 1/HHI — the "effective number of themes" attention is spread across. */
  effectiveThemes: number | null;
}

/**
 * Concentration of attention across a theme set, the attention analogue of the
 * book's concentration HHI. Answers "is attention itself crowding into a few
 * themes today?". Shares are computed from HypeScore (non-negative); themes with
 * a null or non-positive score contribute nothing and are excluded from breadth.
 */
export function attentionConcentration(
  hypeScores: Array<number | null | undefined>
): AttentionConcentration {
  const scores = hypeScores
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0)
    .sort((a, b) => b - a);

  const total = scores.reduce((s, v) => s + v, 0);
  if (scores.length < 2 || total <= 0) {
    return {
      hhi: null,
      top3Share: null,
      scoredCount: scores.length,
      effectiveThemes: null,
    };
  }

  const shares = scores.map((v) => v / total);
  const hhi = shares.reduce((s, w) => s + w * w, 0);
  const top3Share = shares.slice(0, 3).reduce((s, w) => s + w, 0);

  return {
    hhi,
    top3Share,
    scoredCount: scores.length,
    effectiveThemes: hhi > 0 ? 1 / hhi : null,
  };
}
