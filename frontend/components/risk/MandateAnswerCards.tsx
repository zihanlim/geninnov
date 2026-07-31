// frontend/components/risk/MandateAnswerCards.tsx
//
// The four questions a PM arrives at /mandate with, answered above the fold.
//
// Phase 1 asks "what am I solving for, and inside which limits?" — and unlike the
// other phases this page's own answer was already at the top (the mandate panel at
// 284px on 2026-07-30). What it lacked was the *reading* of that mandate: whether
// the published book sits inside it, which constraint is closest to binding, and how
// much of the mandate is traceable rather than a code default. Those were 1752px and
// further down, or on another route entirely (ADR-0172).
//
// WHAT THESE CARDS DO NOT DO. They do not restate the limits. `MandatePanel` below
// lists every cap with its source, and a card repeating "single name 20%" would be a
// second copy of a number the panel already owns — AnswerRow's rule, and ADR-0084's
// split-by-section-never-by-copy. These four answer the question the panel cannot:
// how the BOOK stands against it right now.
//
// The third card is the one that matters most for believability and is easy to
// mistake for bookkeeping. A cap read from `scoring_config` is a decision someone
// recorded; a cap falling back to a house default is a decision nobody recorded, and
// a mandate that cannot say which is which is not auditable. `LimitRow.limitSource`
// already distinguishes them per row and nothing aggregated it.
//
// No realised statistic may appear here — see the refusal list in
// `components/AnswerRow.tsx`. `max_drawdown_pct` is a MONITORED limit in the mandate,
// and the drawdown that would measure against it comes from a costless 6-session
// series, so a "drawdown vs limit" card would be a wrong number wearing a limit's
// authority. It is deliberately absent.

import type { AnswerCard } from "@/components/AnswerRow";
import { pctOf, usdM } from "@/components/AnswerRow";
import type { AnalyticsState, BookMetrics, CapUtilisation } from "@/lib/risk/analytics";
import type { LimitRow } from "@/lib/risk/riskBoard";

/** The limit closest to its ceiling, breaches first. Null when nothing is measurable. */
function tightest(rows: LimitRow[]): LimitRow | null {
  // A not-applicable limit is excluded, and this is the load-bearing half of that
  // status. The net-exposure band read 167% on the long-only credit book — the
  // highest utilisation on the page — so it WAS this card's headline: "Closest to
  // binding: Net exposure 167%", in warning colour, about a limit that governs
  // nothing and that no long-only book could satisfy. It displaced the limits that
  // genuinely bind (two single-name caps and the sector cap, all at 100%).
  //
  // Filtering on `utilisation` alone would not do it: the utilisation is deliberately
  // kept on the row so the board can still show |net| against the band. It is the
  // VERDICT that is withheld, so the verdict is what has to be filtered.
  const measurable = rows.filter(
    (r) => typeof r.utilisation === "number" && r.status !== "not_applicable",
  );
  if (measurable.length === 0) return null;
  return measurable.reduce((hi, r) => (r.utilisation! > hi.utilisation! ? r : hi));
}

export function mandateAnswerCards({
  limitRows,
  capState,
  bookMetrics,
  totalCapital,
}: {
  limitRows: LimitRow[];
  capState: AnalyticsState<CapUtilisation>;
  bookMetrics: BookMetrics | null;
  totalCapital: number | null;
}): AnswerCard[] {
  const gross = bookMetrics?.gross_exposure ?? null;
  const capital = totalCapital ?? null;
  const deployed = gross !== null && capital !== null ? gross * capital : null;
  const cash = deployed !== null && capital !== null ? capital - deployed : null;

  // ── 1. How much of the mandate is being used ──────────────────────────────
  const capitalAtRisk: AnswerCard = {
    label: "Mandate in use",
    href: "#limits",
    // Both tables, because the consequence sentence spends both: the percentage is
    // `book_metrics.gross_exposure` (lens-following) and every dollar figure beside
    // it — deployed, cash, the $100.0M base — is that percentage times
    // `portfolio_risk.total_capital`, which is lens-LESS. Declaring only the first
    // left the card's dollars sourced to a table they do not come from. The value
    // is 100,000,000 under both books today, so nothing on screen was false; the
    // source line was incomplete, which on a page whose whole subject is provenance
    // is its own defect.
    source:
      capital === null
        ? "research_recommendations.book_metrics.gross_exposure"
        : "research_recommendations.book_metrics.gross_exposure × portfolio_risk.total_capital",
    figure: gross === null ? null : <>{pctOf(gross)} gross</>,
    consequence:
      gross === null ? (
        <>
          <code className="num">book_metrics</code> carries no gross exposure for this
          run, so how much of the mandate is in use cannot be stated. Unknown, not zero.
        </>
      ) : cash !== null && cash > 500_000 ? (
        <>
          {usdM(deployed!)} deployed of {usdM(capital!)}; {usdM(cash)} is held as cash
          because the limits below refuse it, not because the book chose to wait. Gross
          is a ceiling the sizer reaches from below — it is not a target.
        </>
      ) : (
        <>
          {usdM(deployed!)} deployed of {usdM(capital!)}. Gross is a ceiling reached from
          below, never a target: whatever the limits refuse is held, not redeployed.
        </>
      ),
  };

  // ── 2. Which constraint is actually binding ───────────────────────────────
  const t = tightest(limitRows);
  const breached = limitRows.filter((r) => r.status === "breached");
  const tightestCard: AnswerCard = {
    label: "Closest to binding",
    href: "#limits",
    // The TIGHTEST ROW'S own source, not a fixed pair — and this card never read
    // `portfolio_positions` at all. `mandateAnswerCards` takes `limitRows`,
    // `capState`, `bookMetrics` and `totalCapital`; there is no positions input in
    // the signature.
    //
    // The stale literal was not merely imprecise, it inverted the card's meaning
    // under a lens. `portfolio_positions` is LENS-LESS (ADR-0194), so the scope
    // banner names it among the tables that "are the multi-asset published book,
    // not the Credit Lens book" — while the figure above it is read from
    // `book_metrics.net_exposure`, which FOLLOWS the lens. On the 2026-07-30
    // credit book that figure is a 167% breach of the 30% net limit (net 0.50);
    // the multi-asset book sits at 26% and breaches nothing. So the source line
    // invited a reader to discount the credit book's own breach — the only breach
    // on the page — as some other book's number.
    //
    // `LimitDef.source` (ADR-0180) already states where each observed value comes
    // from, and the limit board renders it per row. Reading it here means the card
    // and the row it links to cannot disagree, and a limit added later needs no
    // edit in this file.
    source: t ? `scoring_config × ${t.source}` : "scoring_config",
    tone: t && t.utilisation !== null && t.utilisation >= 0.9 ? "warning" : "default",
    figure: t ? (
      <>
        {t.label}{" "}
        <span className="text-[13px] font-normal text-text-secondary">
          {t.utilisation === null ? "" : pctOf(t.utilisation, 0)}
        </span>
      </>
    ) : null,
    consequence: !t ? (
      <>
        No limit has a measurable current value, so none can be shown as binding. That
        is a gap in the inputs, not a book with room everywhere.
      </>
    ) : t.utilisation !== null && t.utilisation >= 1 ? (
      <>
        {t.label} is <strong>at or past its ceiling</strong>. The sizer treats the
        enforced caps as solver constraints, so a breach here is a defect rather than a
        market event.
      </>
    ) : (
      <>
        {t.label} consumes the most of its allowance
        {t.headroom === null ? "" : `, leaving ${pctOf(Math.abs(t.headroom))} of room`}.
        This is the constraint that decides what the next idea can be sized to.
      </>
    ),
  };

  // ── 3. Is the mandate traceable? ──────────────────────────────────────────
  const sourced = limitRows.filter((r) => r.limitSource === "scoring_config").length;
  const traceable: AnswerCard = {
    label: "Traceable limits",
    href: "#mandate",
    source: "scoring_config.param_name",
    tone: limitRows.length > 0 && sourced < limitRows.length ? "warning" : "default",
    figure:
      limitRows.length === 0 ? null : (
        <>
          {sourced}/{limitRows.length} sourced
        </>
      ),
    consequence:
      limitRows.length === 0 ? (
        <>No limits were built, so none can be traced. See the board below.</>
      ) : sourced === limitRows.length ? (
        <>
          Every limit is read from <code className="num">scoring_config</code>, so each
          one is a decision somebody recorded and can be changed without a deploy.
        </>
      ) : (
        <>
          {limitRows.length - sourced} of {limitRows.length} fall back to a house
          default — a number nobody recorded a decision for. It still binds; it just
          cannot be attributed, and the board below names which.
        </>
      ),
  };

  // ── 4. Does the published book sit inside it? ─────────────────────────────
  const caps = capState.status === "ok" ? capState.value : null;
  const violations = caps?.violations ?? null;
  const inside: AnswerCard = {
    label: "Book vs mandate",
    href: "#limits",
    source: "research_recommendations.cap_utilisation.violations",
    tone:
      (violations && violations.length > 0) || breached.length > 0 ? "warning" : "default",
    figure:
      caps === null && breached.length === 0 ? null : violations && violations.length > 0 ? (
        <>
          {violations.length} breach{violations.length === 1 ? "" : "es"}
        </>
      ) : (
        <>inside</>
      ),
    consequence:
      caps === null ? (
        capState.status === "null_column" ? (
          <>
            <code className="num">cap_utilisation</code> is null for this run, so cap
            compliance was not computed. Unknown — which is not the same as compliant.
          </>
        ) : capState.status === "query_error" ? (
          <>The read of cap_utilisation was rejected, so this is unknown rather than clean.</>
        ) : (
          <>No published book to check against the mandate yet.</>
        )
      ) : violations && violations.length > 0 ? (
        <>
          {violations.join("; ")}. The enforced caps enter the optimizer as constraints,
          so a breach is a bug in the sizer and not a market move.
        </>
      ) : (
        <>
          Every enforced cap holds on the published book. Checked against the group
          TOTAL, not per name — two names at 20% breach a 30% sector cap while neither
          breaches on its own (ADR-0037).
        </>
      ),
  };

  return [capitalAtRisk, tightestCard, traceable, inside];
}
