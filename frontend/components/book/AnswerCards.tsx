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
import { lensHref } from "@/lib/book/lensView";

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
  lens,
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
  /**
   * The lens these figures are the book of, carried into the two cards that link
   * OUT to /risk and /mandate.
   *
   * Both cards state a figure that IS this lens's — the worst stress and the
   * binding cap — and anchor it to a page that has had its own `?lens=` control
   * since ADR-0197. Without the lens the reader clicks the credit book's own
   * −1.9% and arrives at the multi-asset stress table, which carries no marker
   * because a URL with no `?lens=` makes `showScopeNote` false for every panel
   * there. `lensHref` returns the bare path for the default lens, so the default
   * page's hrefs do not change.
   */
  lens?: string | null;
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
        href={lensHref("/risk#stress", lens)}
        source="research_recommendations.scenario_results"
        tone={worstReturn !== null && worstReturn < 0 ? "warning" : "default"}
        figure={worstReturn === null ? null : <>{pct(worstReturn)}</>}
        consequence={
          worstReturn === null ? (
            <>No scenario results are persisted for this run, so the downside is unmeasured — not zero.</>
          ) : (
            <>
              {/* No count. This read "the five stresses" and was wrong under BOTH
                  lenses — the multi-asset book carries six scenarios and the credit
                  book seven (S7_fallen_angel, ADR-0192, exists only under a credit
                  mandate). Stating the number here would mean threading a count prop
                  through from BookBody for a figure the reader can see enumerated on
                  /risk; naming the scenario and where the full set lives is the same
                  information without a numeral that can go stale. */}
              Worst of the persisted stresses: {worstLabel ?? "unlabelled scenario"}.
              This is a modelled estimate, not a realised loss.
            </>
          )
        }
      />

      <Card
        label="What's binding"
        href={lensHref("/mandate#limits", lens)}
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
