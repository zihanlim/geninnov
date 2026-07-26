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
      // Does NOT name a provider: this function has no access to the corpus and cannot
      // know which providers contributed. It said "Live Brave/Reddit signal" while Reddit
      // supplied zero of 1,005 rows. Which providers actually contributed is stated by
      // `independenceSentence`, from the data. See ADR-0094.
      return "Live provider signal";
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

// ─── Source independence ──────────────────────────────────────────────────────
//
// How many INDEPENDENT providers the attention signal rests on.
//
// This exists because of what the number turned out to be. `theme_news` held 1,005
// rows on 2026-07-26 and every single one carried `source = 'brave'` — Reddit
// contributed zero. The pipeline does call `fetch_posts_for_theme` and does tag its
// items `source: "reddit"`, but `REDDIT_CLIENT_ID` is not among the repo secrets, so
// `reddit_client` correctly returns `[]` in production rather than fabricating posts
// (ADR-0023 working as designed). The effect is that HypeScore's attention, volume and
// sentiment sub-scores all trace to ONE provider.
//
// Meanwhile three places on the site said "Brave News + Reddit" and one said "All
// collected text came from live Brave/Reddit responses" — naming a provider that supplies
// none of the rows, on the pages whose whole job is to say where a number came from.
//
// Computed from the data rather than stated as a constant, so the day Reddit credentials
// are added the disclosure corrects itself instead of becoming a new false claim in the
// opposite direction.

/**
 * Sources the daily pipeline is coded to fetch, whether or not they are configured.
 *
 * Hardcoded on purpose: it is the only way to distinguish "this provider returned
 * nothing today" from "this provider was never asked". Derived from the two fetchers in
 * `scripts/daily_refresh.py` (`fetch_news_for_theme` → brave,
 * `fetch_posts_for_theme` → reddit). A `mock_` prefix marks fallback rows.
 */
export const PIPELINE_SOURCES = ["brave", "reddit"] as const;

export interface SourceIndependence {
  /** Providers that actually contributed rows, largest first. */
  contributing: Array<{ source: string; items: number }>;
  /**
   * How many distinct providers contributed anything.
   *
   * This is the number a corroboration gate would need. At 1, a gate requiring N
   * independent source types either always passes (N=1) or can never pass (N>=2) — which
   * is why no such gate was built. See ADR-0094.
   */
  independentSources: number;
  /** Share of items from the single largest provider, 0-1. 1 means single-sourced. */
  topSourceShare: number | null;
  /** Coded into the pipeline but contributed nothing — asked and silent, or never asked. */
  absent: string[];
  /** Any contributing source carrying the `mock_` fallback prefix. */
  syntheticSources: string[];
  totalItems: number;
}

/** Independence of the attention corpus, from `theme_news` source counts. */
export function sourceIndependence(
  // `source?` not `source:` — a row that OMITS the key is the same case as one carrying
  // null, and requiring the key made an honest test fixture unrepresentable.
  rows: Array<{ source?: string | null }>,
): SourceIndependence {
  // A plain object rather than a Map: this tsconfig targets below es2015, so spreading a
  // Map iterator needs --downlevelIteration (the same trap method-anchors.test.ts
  // documents for RegExpStringIterator).
  const counts: Record<string, number> = {};
  for (const r of rows) {
    const s = (r.source ?? "").trim();
    if (!s) continue;
    counts[s] = (counts[s] ?? 0) + 1;
  }

  const contributing = Object.entries(counts)
    .map(([source, items]) => ({ source, items }))
    .sort((a, b) => b.items - a.items || a.source.localeCompare(b.source));

  const totalItems = contributing.reduce((s, c) => s + c.items, 0);
  const present = new Set(contributing.map((c) => c.source.replace(/^mock_/, "")));

  return {
    contributing,
    independentSources: contributing.length,
    // null, not 1, when nothing was collected: a share of an empty corpus is not
    // "fully concentrated", it is unmeasurable (ADR-0066).
    topSourceShare: totalItems > 0 ? contributing[0].items / totalItems : null,
    absent: PIPELINE_SOURCES.filter((s) => !present.has(s)),
    syntheticSources: contributing.filter((c) => c.source.startsWith("mock_")).map((c) => c.source),
    totalItems,
  };
}

/** One sentence a reader can act on. Never claims independence the corpus lacks. */
export function independenceSentence(si: SourceIndependence): string {
  if (si.totalItems === 0) {
    return "No attention text was collected, so the number of independent providers behind these scores is unknown.";
  }
  const names = si.contributing.map((c) => c.source).join(", ");
  const absent = si.absent.length
    ? ` ${si.absent.join(" and ")} ${si.absent.length === 1 ? "is" : "are"} fetched by the pipeline but contributed nothing.`
    : "";
  if (si.independentSources === 1) {
    return (
      `Attention is single-sourced: all ${si.totalItems} items came from ${names}, so these scores ` +
      `carry no cross-provider corroboration.${absent}`
    );
  }
  return (
    `Attention draws on ${si.independentSources} providers (${names}), the largest supplying ` +
    `${Math.round((si.topSourceShare ?? 0) * 100)}% of ${si.totalItems} items.${absent}`
  );
}

/** Source counts for the latest run present in `theme_news`. */
export async function fetchSourceIndependence(): Promise<{
  independence: SourceIndependence | null;
  error: string | null;
}> {
  const { data, error } = await supabase
    .from("theme_news")
    .select("source")
    .order("run_date", { ascending: false })
    .limit(2000);
  if (error) return { independence: null, error: error.message };
  return {
    independence: sourceIndependence((data ?? []) as Array<{ source: string | null }>),
    error: null,
  };
}
