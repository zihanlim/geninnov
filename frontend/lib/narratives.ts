// frontend/lib/narratives.ts
//
// Read model for `narrative_signals` — the daily share-of-voice series per
// narrative phrase (ADR-0128).
//
// Two things this table is NOT, both worth stating here because the component
// that renders it must not imply otherwise:
//
//   * It is not the theme board. Nothing in it sizes a position or reaches the
//     L5 agent. A phrase trending in the news is evidence a narrative exists, not
//     evidence it is tradeable.
//   * It is not a keyword search. Nobody chose these phrases; they are whatever
//     the market news was about, which is the only way a narrative like the AI
//     capex cycle — named in no theme and no keyword list — can be seen at all.

import { supabase } from "@/lib/supabase";

export type NarrativeStatus = "new" | "emerging" | "established" | "fading";

export interface NarrativeRow {
  run_date: string;
  phrase: string;
  doc_count: number;
  corpus_size: number;
  /** doc_count / corpus_size. The comparable series — see the column comment. */
  share: number;
  /** Robust z of today's share vs this phrase's own history. Null = no reading. */
  velocity: number | null;
  days_observed: number;
  first_seen: string;
  status: NarrativeStatus;
  /** Anchor theme already covering this phrase, or null if nothing watches it. */
  covered_by: string | null;
}

export interface NarrativeSeries {
  phrase: string;
  /** Ascending by run_date. */
  points: Array<{ run_date: string; share: number }>;
  latest: NarrativeRow;
}

/** Load the last `days` of narrative signals, newest run first. */
export async function fetchNarratives(
  days = 30,
): Promise<{ rows: NarrativeRow[]; error: string | null }> {
  const { data, error } = await supabase
    .from("narrative_signals")
    .select(
      "run_date, phrase, doc_count, corpus_size, share, velocity, days_observed, first_seen, status, covered_by",
    )
    .order("run_date", { ascending: false })
    .limit(days * 150);

  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as NarrativeRow[], error: null };
}

/**
 * Group rows into per-phrase series, keeping only phrases present on the most
 * recent run.
 *
 * Dropping phrases absent from the latest run is deliberate: a chart line that
 * stops three days ago reads as "this narrative collapsed" when it usually means
 * the phrase fell below the document floor and stopped being tracked. Those are
 * different claims and the chart cannot tell them apart, so it does not draw the
 * one it cannot support.
 */
export function toSeries(rows: NarrativeRow[]): NarrativeSeries[] {
  if (rows.length === 0) return [];
  const latestDate = rows.reduce(
    (max, r) => (r.run_date > max ? r.run_date : max),
    rows[0].run_date,
  );

  const byPhrase = new Map<string, NarrativeRow[]>();
  for (const r of rows) {
    const list = byPhrase.get(r.phrase);
    if (list) list.push(r);
    else byPhrase.set(r.phrase, [r]);
  }

  // forEach rather than `for…of` over the Map: this project's tsconfig targets
  // below ES2015 for iteration, so destructuring a Map entry needs
  // --downlevelIteration. Not worth a compiler-flag change for one loop.
  const out: NarrativeSeries[] = [];
  byPhrase.forEach((list: NarrativeRow[], phrase: string) => {
    const latest = list.find((r) => r.run_date === latestDate);
    if (!latest) return;
    const points = [...list]
      .sort((a, b) => a.run_date.localeCompare(b.run_date))
      .map((r) => ({ run_date: r.run_date, share: r.share }));
    out.push({ phrase, points, latest });
  });
  return out;
}

/**
 * The chart's series: the loudest narratives on the latest run.
 *
 * Capped at `limit` because a line chart stops being readable well before it
 * stops being drawable, and because the validated categorical palette has a
 * fixed number of slots — a further series would need a generated hue, which is
 * exactly what the palette rules forbid. The caller reports how many were left
 * out rather than presenting the survivors as the whole picture.
 */
export function topSeries(series: NarrativeSeries[], limit = 5): NarrativeSeries[] {
  return [...series]
    .sort((a, b) => b.latest.share - a.latest.share)
    .slice(0, limit);
}

/**
 * The shortlist that answers "what is the pipeline not watching": accelerating,
 * young, and covered by none of the eight anchor themes.
 *
 * A surge in "fomc" is Fed Policy doing its job and is deliberately excluded —
 * it is not a miss.
 */
export function emergingUncovered(series: NarrativeSeries[]): NarrativeSeries[] {
  return series
    .filter((s) => s.latest.status === "emerging" && s.latest.covered_by === null)
    .sort((a, b) => (b.latest.velocity ?? 0) - (a.latest.velocity ?? 0));
}

/** Human-readable share, e.g. 0.043 -> "4.3%". */
export function sharePct(share: number, digits = 1): string {
  return `${(share * 100).toFixed(digits)}%`;
}
