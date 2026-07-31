// frontend/components/AnswerRow.tsx
//
// The answer row: the questions a PM arrives with, answered above the fold.
//
// EXTRACTED FROM `components/book/AnswerCards.tsx`, WHERE IT WAS PROVEN.
// That component's own header records the diagnosis this shape fixes: "the measured
// defect this fixes is PLACEMENT, not paint. On the shipped page 'what changed since
// yesterday' sat three screens down inside the turnover panel, and 'what is binding'
// was on a different route entirely — so the two facts a reader most needs in their
// first ninety seconds were the two furthest from where they land."
//
// It was solving that for ONE page. Measured 2026-07-30, five of the six phase
// routes had no equivalent, and blocks sat on the tab whose question they did not
// answer — `/risk` asks "what could go wrong and what would it cost" and its stress
// scenarios were at 2622px, nearly three screens down. So the shape moves here and
// every phase composes its own row.
//
// THE CONTRACT, and each clause is load-bearing:
//
//   LABEL / FIGURE / CONSEQUENCE. A figure with a label is a KPI tile, which is a
//   number with no parent — the exact inverse of this product's claim. The
//   consequence says what the figure MEANS, and it is COMPUTED from the same row the
//   figure came from. A canned consequence string is a naked number delivered in a
//   confident authorial voice, which is strictly worse than a naked number.
//
//   The figure is a LINK into the panel that derives it, so a card is an index into
//   the evidence rather than a replacement for it. Nothing here may be a second copy
//   of a number — every value is read from the same row the panels below render.
//
//   `source` names the `table.column` (design goal 1). `figure={null}` renders an
//   em-dash and the consequence must then say WHY (goal 2) — "no data" and "zero"
//   are different claims.
//
// WHAT MAY NOT GO ON A CARD: Sharpe, Sortino, Calmar, max drawdown, realised beta,
// tracking error, information ratio. Those are computed from `portfolio_returns`,
// which is costless on a book measured at 92.7% mean daily turnover — `CostDrag`
// measured the sign flipping, +0.76% gross against -0.72% net — and on 6 sessions
// against minimums of 30-252. They are wrong on BOTH sample and basis, and this row
// is the worst possible place for a wrong number. `sampleAdequacy` already suppresses
// them on the panels; do not smuggle them up here.
//
// Ex-ante figures (VaR, CVaR, factor tilts, HHI, scenario stress, cap utilisation)
// ARE valid on a recommendation — they are pure functions of weights and covariance,
// and need no holding history. Those are what the rows use.

import Link from "next/link";
import type { ReactNode } from "react";

export interface AnswerCard {
  label: string;
  /** `null` renders an em-dash; the consequence must then say WHY (goal 2). */
  figure: ReactNode | null;
  consequence: ReactNode;
  /** `table.column` the figure was read from (goal 1). */
  source: string;
  /**
   * "This card's FIGURE is the multi-asset book's" — set only under a non-default
   * lens, and only when the figure itself is lens-less (ADR-0211's row-level
   * disclosure, one altitude up).
   *
   * Set by the card BUILDER, not derived here from `source`, because `source` and
   * `figure` are not always the same scope. `mandateAnswerCards`' first card is
   * sourced `book_metrics.gross_exposure × portfolio_risk.total_capital` — the
   * headline `48% gross` follows the lens and only the dollars in the consequence
   * sentence are lens-less (and identical under both books, being the mandate size).
   * Running `sourceProvenance` over that string returns "published" on the
   * published-wins-a-tie rule, which is right for one value in a table row and wrong
   * for a headline that does follow the lens. The builder knows which figure it put
   * on the card; this component does not.
   */
  scopeNote?: string;
  /** Anchor or route the figure drills into. Must resolve on the page that renders
   *  this row — `answer-rows.test.tsx` asserts every href has a target, after
   *  `phases.test.ts` passed on an anchor that existed only as a `data-testid`. */
  href: string;
  tone?: "default" | "warning";
}

export function Card({
  label,
  figure,
  consequence,
  source,
  href,
  tone = "default",
  scopeNote,
}: AnswerCard) {
  const figureCls =
    tone === "warning"
      ? "num text-[22px] font-semibold leading-[1.15] text-warning"
      : "num text-[22px] font-semibold leading-[1.15] text-text-primary";
  return (
    <div className="card">
      <div className="card-body flex flex-col gap-1">
        <div className="text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
          {label}
        </div>
        {/* The figure is the drill control. A reader who doubts it goes straight
            to the panel that derives it rather than hunting for it. */}
        <Link
          href={href}
          className={`${figureCls} no-underline hover:underline decoration-border-strong underline-offset-4`}
        >
          {figure ?? <span className="text-text-tertiary">—</span>}
        </Link>
        <div className="text-[12px] text-text-secondary leading-[1.5]">
          {consequence}
        </div>
        {/* [overflow-wrap:anywhere] because these are table.column identifiers with
            no spaces to break on, and `.card` CLIPS rather than scrolls: measured at
            1440, `research_recommendations.book_metrics.gross_exposure` is 312px
            inside a 288px body, so its tail was cut with nothing to say it had been.
            The same remedy `Ident` in SectionGap.tsx already carries, for the same
            reason — a source a reader cannot finish reading is not a source (goal 1).
            Predates the column narrowing; that just made it wider of the mark. */}
        <div className="text-[10px] text-text-tertiary num mt-0.5 [overflow-wrap:anywhere]">
          {source}
          {/* Same idiom, register and ink as the limit board's row tag: prose type
              beside the mono identifier, neutral rather than --warning, because
              nothing here is broken (ADR-0194 working as designed). A reader who has
              met one has met both. */}
          {scopeNote && (
            <span
              role="note"
              data-testid="answer-card-scope"
              className="font-sans text-text-secondary"
              title={scopeNote}
            >
              {" · multi-asset"}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The four-up grid. Four is not arbitrary: it is one screen-width of cards, and a
 * fifth would push the evidence below it further down — which is the defect this
 * component exists to remove, reintroduced by its own growth.
 *
 * `xl:grid-cols-4 gap-6`, and BOTH halves of that are the evidence grid's, not
 * this component's own taste (ADR-0187). An answer row sits directly above the
 * cards that justify it, so at any viewport where the two disagree the reader
 * sees two rulers: measured at 1440 the answer cards ran 76/403 · 415/742 ·
 * 754/1081 · 1093/1420 against a mandate row of 76/736 · 760/1078 · 1102/1420 —
 * every internal boundary 6–9px out, with only the page gutters agreeing. The gap
 * was 12px against 24, and the four-up gate was `wide` (1424) against the row's
 * `xl` (1280), so between those two widths the page also drew four evidence
 * columns under two answer columns.
 */
export default function AnswerRow({ cards }: { cards: AnswerCard[] }) {
  if (cards.length === 0) return null;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6 mb-6">
      {cards.map((c) => (
        <Card key={c.label} {...c} />
      ))}
    </div>
  );
}

/** Shared formatters, so four rows cannot each round differently. */
export const pctOf = (v: number, dp = 1) => `${(v * 100).toFixed(dp)}%`;
export const usdM = (v: number) => `$${(v / 1_000_000).toFixed(1)}M`;
export const listOf = (xs: string[], n = 3) =>
  xs.length <= n ? xs.join(", ") : `${xs.slice(0, n).join(", ")} +${xs.length - n}`;
