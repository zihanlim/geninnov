// frontend/components/book/AnswerCards.tsx
//
// The four questions a PM arrives with, answered above the fold.
//
// The measured defect this fixes is PLACEMENT, not paint. On the shipped page
// "what changed since yesterday" sat three screens down inside the turnover
// panel, and "what is binding" was on a different route entirely — so the two
// facts a reader most needs in their first ninety seconds were the two furthest
// from where they land.
//
// Every card is LABEL / FIGURE / CONSEQUENCE, and the consequence is the point.
// A figure with a label is a KPI tile, which is a number with no parent — the
// exact inverse of this product's claim. The consequence line says what the
// figure MEANS for the book, computed from the same row the figure came from,
// never hardcoded: a canned consequence string is a naked number delivered in a
// confident authorial voice, which is strictly worse than a naked number.
//
// Each card names its source table.column (goal 1) and each figure is a link
// into the panel that derives it, so the card is an index into the evidence
// rather than a replacement for it. Nothing here is a second copy of a number —
// every value is read from the same `rec` the panels below render.

import type { ReactNode } from "react";
import { Card, listOf, pctOf, usdM } from "@/components/AnswerRow";

// `Card`, the grid and the formatters moved to components/AnswerRow.tsx so the five
// other phase routes could compose their own rows against the same contract
// (ADR-0172). This file keeps ONLY the book's four cards and the arithmetic behind
// them — the extraction changed no rendered output on /book.
//
// Deliberately NOT rewritten to use <AnswerRow cards={...}>: these four cards carry
// branching JSX in their consequences (previous === null vs identical vs changed),
// which reads better as markup here than as an array of ReactNodes assembled above.
const pct = pctOf;
const usd = usdM;
const list = listOf;

export default function AnswerCards({
  current,
  previous,
  previousDate,
  gross,
  net,
  deployed,
  cash,
  worstLabel,
  worstReturn,
  bindingCaps,
  capsKnown,
}: {
  current: string[];
  /** null = no previous run persisted, which is NOT "nothing changed". */
  previous: string[] | null;
  previousDate: string | null;
  gross: number | null;
  net: number | null;
  deployed: number | null;
  cash: number | null;
  worstLabel: string | null;
  worstReturn: number | null;
  bindingCaps: Array<{ group: string; key: string; cap: number }>;
  /** Did cap_utilisation load at all? Distinguishes "nothing binding" from
   *  "we do not know", which are different claims (goal 2). */
  capsKnown: boolean;
}) {
  const prevSet = new Set(previous ?? []);
  const curSet = new Set(current);
  const entered = current.filter((t) => !prevSet.has(t));
  const exited = (previous ?? []).filter((t) => !curSet.has(t));
  const held = current.filter((t) => prevSet.has(t));

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 wide:grid-cols-4 gap-3 mb-6">
      <Card
        label="What changed"
        href="#solidity"
        source="research_recommendations.picks"
        figure={
          previous === null ? null : (
            <>
              {entered.length} in · {exited.length} out · {held.length} held
            </>
          )
        }
        consequence={
          previous === null ? (
            <>
              No previous run is persisted, so turnover cannot be computed. This is
              not the same as an unchanged book.
            </>
          ) : entered.length === 0 && exited.length === 0 ? (
            <>Identical to {previousDate ?? "the previous run"} — no name changed side or entered.</>
          ) : (
            <>
              {entered.length > 0 && <>New: {list(entered)}. </>}
              {exited.length > 0 && <>Dropped: {list(exited)}. </>}
              Against {previousDate ?? "the previous run"}.
            </>
          )
        }
      />

      <Card
        label="What you're being asked to put on"
        href="#holdings"
        source="book_metrics.gross_exposure"
        figure={gross === null ? null : <>{pct(gross)} gross</>}
        consequence={
          gross === null ? (
            <>Book metrics did not load, so exposure cannot be stated.</>
          ) : (
            <>
              Net {net === null ? "—" : pct(net)} directional
              {deployed !== null && cash !== null && (
                <>
                  {" · "}
                  {usd(deployed)} deployed, {usd(cash)} held back
                  {bindingCaps.length > 0 && (
                    <> by the {bindingCaps[0].group} cap on {bindingCaps[0].key}</>
                  )}
                </>
              )}
              .
            </>
          )
        }
      />

      <Card
        label="What kills you"
        href="/risk#stress"
        source="research_recommendations.scenario_results"
        tone={worstReturn !== null && worstReturn < 0 ? "warning" : "default"}
        figure={worstReturn === null ? null : <>{pct(worstReturn)}</>}
        consequence={
          worstReturn === null ? (
            <>No scenario results are persisted for this run, so the downside is unmeasured — not zero.</>
          ) : (
            <>
              Worst of the five stresses: {worstLabel ?? "unlabelled scenario"}. This is
              a modelled estimate, not a realised loss.
            </>
          )
        }
      />

      <Card
        label="What's binding"
        href="/mandate#limits"
        source="research_recommendations.cap_utilisation"
        tone={bindingCaps.length > 0 ? "warning" : "default"}
        figure={
          !capsKnown ? null : bindingCaps.length === 0 ? (
            <>None</>
          ) : (
            <>
              {bindingCaps.length} at limit
            </>
          )
        }
        consequence={
          !capsKnown ? (
            <>Cap utilisation did not load, so whether a limit binds is unknown — which is not the same as nothing binding.</>
          ) : bindingCaps.length === 0 ? (
            <>No sector or geography group is at its cap, so sizing is driven by conviction alone.</>
          ) : (
            <>
              {bindingCaps.map((c) => `${c.key} (${c.group})`).join(", ")} — capital these
              refused is held as cash rather than pushed into the next name.
            </>
          )
        }
      />
    </div>
  );
}
