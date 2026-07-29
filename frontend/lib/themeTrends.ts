// frontend/lib/themeTrends.ts
//
// Read model for the theme trends board — the nine ANCHOR themes' attention
// over time, Google-Trends style, from `theme_signals_history` (L1, daily
// since migration 001).
//
// The metric is a SHARE OF SOMETHING NAMED (ADR-0091): each theme's
// mention_count_1d over the day's total across all themes. Two honesty notes
// that the component must carry, stated here because they are properties of
// the data and not of the rendering:
//
//   * The denominator is the day's THEME-QUERY mentions. Every theme is
//     counted by its own Brave query (THEME_KEYWORDS), so this is relative
//     attention AMONG THE ANCHORS — not share of an unbiased corpus. The
//     narrative board carries the unbiased-corpus claim (ADR-0141); this
//     board deliberately does not.
//   * A NULL mention_count_1d is "the fetch did not report", not zero
//     (ADR-0066). It becomes a GAP in the series, never a zero point, and it
//     is excluded from that day's denominator.

import { supabase } from "@/lib/supabase";

export interface ThemeTrendRow {
  run_date: string;
  theme: string;
  mention_count_1d: number | null;
}

export interface ThemeTrendSeries {
  /** Named `phrase` so the series satisfies TrendPlot's TrendSeries shape. */
  phrase: string;
  /** Ascending by run_date; days with a NULL count are absent, not zero. */
  points: Array<{ run_date: string; share: number }>;
  latest: {
    share: number | null;
    mentions: number | null;
    /** share − prior share, when both exist. */
    delta: number | null;
  };
}

/** Load the last `days` of theme signals with theme names. */
export async function fetchThemeTrends(
  days = 30,
): Promise<{ rows: ThemeTrendRow[]; error: string | null }> {
  const { data, error } = await supabase
    .from("theme_signals_history")
    .select("run_date, mention_count_1d, themes(name)")
    .order("run_date", { ascending: false })
    .limit(days * 16);

  if (error) return { rows: [], error: error.message };
  const rows: ThemeTrendRow[] = [];
  for (const r of (data ?? []) as Array<{
    run_date: string;
    mention_count_1d: number | null;
    themes: { name: string } | { name: string }[] | null;
  }>) {
    const t = Array.isArray(r.themes) ? r.themes[0] : r.themes;
    if (!t?.name) continue;
    rows.push({ run_date: r.run_date, theme: t.name, mention_count_1d: r.mention_count_1d });
  }
  return { rows, error: null };
}

/**
 * The fewest same-day mentions, ACROSS ALL THEMES, that can carry a share.
 *
 * Not a taste call. This table reports a share to one decimal place, and a
 * denominator where a single article moves the printed figure by more than
 * ~5pp makes that precision a lie: 1/20 = 5.0pp, 1/10 = 10pp, 1/3 = 33pp.
 *
 * Observed 2026-07-29, when the Brave quota died mid-run (ADR-0156) and the
 * day's total fell to THREE mentions across nine themes:
 *
 *     US Election   66.7%   2 mentions   +55.0pp
 *     Fed Policy    33.3%   1 mention     -3.0pp
 *     (seven themes at 0.0%)
 *
 * Every figure there is arithmetic on a sample of three, rendered with the same
 * confidence as a healthy day's. Healthy days run 62-77 same-day mentions across
 * the nine themes (measured 2026-07-27 and -28), so this floor does not bind on
 * them — it binds exactly when the number would otherwise be invented.
 *
 * Same rule the discovery layer already applies to its own corpus
 * (`narrative_tracker.MIN_DOC_COUNT`, and `backfill_narratives --min-docs`:
 * "a share computed out of three documents is 33% by arithmetic and says
 * nothing"), and the same rule `lib/risk/sampleAdequacy.ts` applies to risk
 * statistics (ADR-0100).
 */
export const MIN_DAY_MENTIONS_FOR_SHARE = 20;

/**
 * Group rows into per-theme share-of-voice series.
 *
 * Share is computed against the day's total of NON-NULL counts. A day whose
 * total is zero — or below MIN_DAY_MENTIONS_FOR_SHARE — produces no points at
 * all: 0/0 is not a share, 2/3 is not a measurement, and a flat zero line would
 * read as "nobody mentioned anything", which is a different claim from "the
 * fetch returned nothing" (ADR-0066).
 */
export function toThemeTrendSeries(rows: ThemeTrendRow[]): ThemeTrendSeries[] {
  const dayTotals = new Map<string, number>();
  for (const r of rows) {
    if (r.mention_count_1d === null) continue;
    dayTotals.set(r.run_date, (dayTotals.get(r.run_date) ?? 0) + r.mention_count_1d);
  }

  const byTheme = new Map<string, ThemeTrendRow[]>();
  for (const r of rows) {
    const list = byTheme.get(r.theme) ?? [];
    list.push(r);
    byTheme.set(r.theme, list);
  }

  const out: ThemeTrendSeries[] = [];
  byTheme.forEach((list, theme) => {
    const points: Array<{ run_date: string; share: number }> = [];
    let latestMentions: number | null = null;
    for (const r of [...list].sort((a, b) => a.run_date.localeCompare(b.run_date))) {
      const total = dayTotals.get(r.run_date) ?? 0;
      // A gap, not a zero — and a thin day is a gap for the same reason an
      // empty one is: the share would be a statement about the sample size.
      if (r.mention_count_1d === null || total < MIN_DAY_MENTIONS_FOR_SHARE) continue;
      points.push({ run_date: r.run_date, share: r.mention_count_1d / total });
      latestMentions = r.mention_count_1d;
    }
    const last = points[points.length - 1] ?? null;
    const prev = points[points.length - 2] ?? null;
    out.push({
      phrase: theme,
      points,
      latest: {
        share: last?.share ?? null,
        mentions: latestMentions,
        delta: last && prev ? last.share - prev.share : null,
      },
    });
  });

  // Loudest today first — the same ordering the top-5 colour assignment uses,
  // so colour follows the entity for the life of the page load.
  return out.sort((a, b) => (b.latest.share ?? -1) - (a.latest.share ?? -1));
}

/**
 * The most recent run's mention total, when it is too thin to carry a share.
 *
 * `toThemeTrendSeries` drops such a day, which is correct and invisible — the
 * table simply renders em dashes. An absence has to state its cause (design
 * goal 2), and "the fetch collected three articles" is a very different fact
 * from "attention was flat", so the caller gets the number to say it with.
 *
 * Returns null when the latest day clears the floor, or when there is no data.
 */
export function latestSampleShortfall(
  rows: ThemeTrendRow[],
): { run_date: string; total: number } | null {
  const dayTotals = new Map<string, number>();
  for (const r of rows) {
    if (r.mention_count_1d === null) continue;
    dayTotals.set(r.run_date, (dayTotals.get(r.run_date) ?? 0) + r.mention_count_1d);
  }
  let latest: string | null = null;
  dayTotals.forEach((_total, day) => {
    if (latest === null || day > latest) latest = day;
  });
  if (latest === null) return null;
  const total = dayTotals.get(latest) ?? 0;
  return total < MIN_DAY_MENTIONS_FOR_SHARE ? { run_date: latest, total } : null;
}

/** The five colour slots are the cap; everything else lives in the table. */
export function topThemeSeries(series: ThemeTrendSeries[], n: number): ThemeTrendSeries[] {
  return series.filter((s) => s.points.length > 0).slice(0, n);
}

/** Human-readable share, e.g. 0.043 -> "4.3%". */
export function themeSharePct(v: number | null): string {
  return v === null ? "—" : `${(v * 100).toFixed(1)}%`;
}
