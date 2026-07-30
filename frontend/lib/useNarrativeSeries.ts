"use client";

// frontend/lib/useNarrativeSeries.ts
//
// ONE reading of `narrative_signals`, shared by every consumer of it.
//
// WHY THIS EXISTS. Three cards on `/` now render the same day of the same
// corpus: the detection plane (`NarrativeTrends`), the counts
// (`AttentionFunnel`) and the figures table (`NarrativeFigures`). Each used to
// own its `fetchNarratives(...)` call, and on 2026-07-29 that produced exactly
// the failure the arrangement invites — the funnel defaulted to
// `corpus: "combined"` while the board passed `"archive"`, so a strip reading
// "193 phrases tracked, velocity not measurable yet" sat directly beneath a
// chart reading 76 tracked with velocities to +2.27. Both were right about
// their own corpus. The pair was incoherent.
//
// The fix then was to align the arguments by hand. That is not a fix, it is a
// coincidence maintained by vigilance: the next card to render this table gets
// the same choice and the same chance to get it wrong, and nothing fails when
// it does. ADR-0163 made this argument about routes — "two routes querying
// `research_recommendations` separately are two chances to describe different
// vintages" — and it is the same argument one level down.
//
// So the CHOICE moves here, once:
//
//   • the corpus is `archive`, not `combined` (ADR-0153). A share is a fraction
//     OF a corpus, so a velocity only means something where the corpus is
//     defined the same way every day. `combined` is denser (~98 docs/day
//     against ~27) but its composition changes as providers come and go, so it
//     holds one run_date and zero measurable velocities.
//   • the day is the newest run that carries a measurable velocity, not
//     max(run_date) (ADR-0159). GDELT publishes with a lag, so the newest
//     publication day is structurally the thinnest and is the day most often
//     withheld; keying to it blanks a plane sitting on a series full of
//     velocities.
//   • `asOfFallback` is non-null exactly when the second rule fired, because a
//     count keyed to one day under a heading implying another is the mislabel,
//     not the fallback. Every consumer is expected to disclose it.
//
// Each consumer still issues its own request — React has no shared cache here —
// so they can differ if the nightly job lands mid-render. What they can no
// longer differ on is the corpus or the day RULE, which is what actually went
// wrong.

import { useEffect, useState } from "react";
import {
  fetchNarratives,
  latestMeasuredDate,
  toSeries,
  type NarrativeSeries,
} from "@/lib/narratives";

export interface NarrativeSeriesState {
  /** null while loading; [] is a real "measured, nothing tracked". */
  series: NarrativeSeries[] | null;
  /** Non-null when the series is an EARLIER day than the newest run. */
  asOfFallback: string | null;
  error: string | null;
}

/**
 * `skip` exists because a React hook cannot be called conditionally, so a component
 * that accepts a caller-supplied series still RUNS this hook — and therefore still
 * fетched. Measured on `/` after lifting the read to the page: requests to
 * narrative_signals went UP, because the page's call was added to the two the board
 * and the funnel were already making rather than replacing them. The flag is what
 * actually removes a read; the prop alone only chooses which result is displayed.
 */
export function useNarrativeSeries(
  days = 30,
  { skip = false }: { skip?: boolean } = {},
): NarrativeSeriesState {
  const [state, setState] = useState<NarrativeSeriesState>({
    series: null,
    asOfFallback: null,
    error: null,
  });

  useEffect(() => {
    if (skip) return;
    let live = true;
    fetchNarratives(days, "archive").then(({ rows, error }) => {
      if (!live) return;
      if (error) {
        setState({ series: null, asOfFallback: null, error });
        return;
      }
      const newest = toSeries(rows);
      const measurable = newest.some((s) => s.latest.velocity !== null);
      const measuredDay = measurable ? null : latestMeasuredDate(rows);
      setState({
        series: measuredDay ? toSeries(rows, measuredDay) : newest,
        asOfFallback: measuredDay,
        error: null,
      });
    });
    return () => {
      live = false;
    };
  }, [days, skip]);

  return state;
}
