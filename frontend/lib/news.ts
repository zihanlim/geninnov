// frontend/lib/news.ts
//
// The read-model for `theme_news` — the headlines behind a HypeScore.
//
// WHY THIS EXISTS. Until 2026-07-27 these rows had exactly one reader-facing
// surface: the third of four sections inside ThemeDerivationDrawer, reachable
// only by clicking a 10px `ⓘ derive` hint that is `hidden md:inline` — i.e. not
// rendered at all on mobile. The pipeline fetches ~330 headlines a day, each now
// carrying a real publisher URL (migration 045/ADR-0089), and effectively none
// of it was visible. That is a provenance surface we pay for and hide.
//
// Kept in lib/ rather than inside a component for the usual reason in this
// repo: vitest runs in a `node` environment with no jsdom, so anything
// expressed only inside JSX cannot be asserted on. The sentiment→label mapping
// in particular is a claim about the world and needs a test.

import { supabase } from "@/lib/supabase";

/** A headline as persisted by `daily_refresh.persist_theme_news`. */
export interface NewsItem {
  theme_id: string | null;
  /** Resolved from the themes table; the cluster this headline scored into. */
  theme_name: string | null;
  headline: string;
  /** Publisher link. NULL on every row written before migration 045 —
   *  unbackfillable, the fetch responses were never stored — and on mock rows. */
  url: string | null;
  /** `brave` | `reddit` | `mock_*`. A `mock_` prefix must stay visible. */
  source: string;
  /** NULL when the publisher's page_age was missing or unparseable. Until
   *  2026-07-28 such items were stamped with the RUN's date, which sorted a
   *  page of unknown age to the top of the ribbon as if it were today's news. */
  published_date: string | null;
  run_date: string | null;
  /** Per-item VADER compound score, written from 2026-07-27 (ADR-0089). */
  sentiment: number | null;
}

/**
 * Tone of a single headline, from its own persisted score.
 *
 * This is deliberately NOT the "confidence %" the competitor's news row shows.
 * Theirs is an undisclosed model output presented as a probability; this is a
 * VADER compound score that the pipeline computed, persisted, and can be
 * reconciled against `theme_news.sentiment`. The threshold is VADER's own
 * conventional ±0.05 neutral band, not a number chosen to make the chips look
 * balanced.
 *
 * `null` in, `null` out — a headline collected before 2026-07-27 has no score,
 * and "we did not measure this" must not render as "neutral" (ADR-0066).
 */
export type NewsTone = "positive" | "negative" | "neutral";

export function toneOf(sentiment: number | null | undefined): NewsTone | null {
  if (sentiment === null || sentiment === undefined) return null;
  if (!Number.isFinite(sentiment)) return null;
  if (sentiment >= 0.05) return "positive";
  if (sentiment <= -0.05) return "negative";
  return "neutral";
}

/** Display label for a tone. Words, not colour — these sit near direction ink
 *  on the same page and must not be read as a book side (ADR-0085). */
export const TONE_LABEL: Record<NewsTone, string> = {
  positive: "positive",
  negative: "negative",
  neutral: "neutral",
};

/** True when a row came from the mock fallback rather than a live feed. */
export function isSynthetic(source: string | null | undefined): boolean {
  return String(source ?? "").startsWith("mock");
}

/**
 * Latest headlines across all themes, newest first.
 *
 * Reads the most recent `run_date` present rather than today's date: the
 * pipeline runs weekdays only, so on a Sunday "today" has no rows and asking
 * for it renders an empty feed over a perfectly good Friday. This is the bug
 * that made the drawer look broken on 2026-07-26.
 */
export async function fetchLatestNews(limit = 40): Promise<{
  items: NewsItem[];
  runDate: string | null;
  error: string | null;
}> {
  // Newest run_date that actually has rows.
  const latest = await supabase
    .from("theme_news")
    .select("run_date")
    .order("run_date", { ascending: false })
    .limit(1);

  if (latest.error) {
    return { items: [], runDate: null, error: latest.error.message };
  }
  const runDate = (latest.data?.[0] as { run_date?: string } | undefined)?.run_date ?? null;
  if (!runDate) return { items: [], runDate: null, error: null };

  const [rows, themes] = await Promise.all([
    supabase
      .from("theme_news")
      .select("theme_id, headline, url, source, published_date, run_date, sentiment")
      .eq("run_date", runDate)
      // nullsFirst matters: Postgres puts NULLs FIRST on a bare DESC, and
      // published_date is legitimately NULL for unknown-age items — which must
      // trail the dated ones, not open the ribbon.
      .order("published_date", { ascending: false, nullsFirst: false })
      .limit(limit),
    supabase.from("themes").select("id, name"),
  ]);

  if (rows.error) return { items: [], runDate, error: rows.error.message };

  const nameById = new Map<string, string>();
  for (const t of (themes.data ?? []) as { id: string; name: string }[]) {
    nameById.set(t.id, t.name);
  }

  type Raw = Omit<NewsItem, "theme_name">;
  const items: NewsItem[] = ((rows.data ?? []) as unknown as Raw[])
    .filter((r) => (r.headline ?? "").trim().length > 0)
    .map((r) => ({
      ...r,
      theme_name: r.theme_id ? nameById.get(r.theme_id) ?? null : null,
    }));

  return { items, runDate, error: null };
}

/**
 * The ribbon's slice: newest N, one per headline, de-duplicated by text.
 *
 * Dedupe matters because the same wire story is returned under several themes —
 * "Fed holds rates" scores into both Fed Policy and Inflation — and a ribbon
 * that shows it twice looks broken rather than thorough.
 */
export function topForRibbon(items: NewsItem[], n = 10): NewsItem[] {
  const seen = new Set<string>();
  const out: NewsItem[] = [];
  for (const it of items) {
    const key = it.headline.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
    if (out.length >= n) break;
  }
  return out;
}
