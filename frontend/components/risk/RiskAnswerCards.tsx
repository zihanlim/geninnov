// frontend/components/risk/RiskAnswerCards.tsx
//
// The four questions a PM arrives at /risk with, answered above the fold.
//
// Phase 3 asks "what could go wrong, what would it cost, and what proves the thesis
// right?" and the page's own answer — the six-scenario matrix — was measured at
// 2622px on 2026-07-30, nearly three screens below the fold, under per-position
// attribution and the what-if builder. This row is the fix (ADR-0172).
//
// WHY THE WORST-CASE FIGURE IS NOT HERE, though it is the obvious first card.
// `/book`'s row already carries it ("WHAT KILLS YOU / -2.1% / worst of the five
// stresses") and links to `/risk#stress`. Repeating it would break AnswerRow's own
// rule — nothing on a row may be a second copy of a number — and ADR-0084's stop
// rule for exactly this: split by SECTION, never by copy of the same data. So
// `/book` summarises the single worst number and this page goes deeper: both tails,
// which name to cut, how many ideas are really one, and what the model cannot see.
//
// EVERY FIGURE HERE IS EX-ANTE, and the fourth card is where that is stated rather
// than assumed. These are pure functions of the recommended weights and a 252-day
// sample covariance — valid as "what this book would risk if held", and NOT a
// measurement of what running the strategy has cost. Two consequences a reader is
// owed and one of them is uncomfortable:
//
//   * the same Σ that sized the book is the Σ that reports its risk
//     (`covariance_from_returns` feeds both the optimizer and the VaR/MC path), so
//     minimising w'Σw under a noisy estimate selects the directions where Σ
//     understates true covariance — the reported vol is a LOWER BOUND;
//   * μ is shrunk 50% toward zero (ADR-0033); Σ is now ALSO shrunk, toward constant
//     correlation, at a fixed 25% intensity (ADR-0173) — which narrows the bias
//     above without removing it. `covShrinkageIntensity` carries the ACTUAL figure
//     for the run being read, because a row predating ADR-0173 was genuinely
//     unshrunk and this card must not claim otherwise about history it cannot see.
//
// No realised statistic may appear on this row — no Sharpe, Sortino, Calmar,
// drawdown, realised beta, tracking error or IR. See the refusal list in
// `components/AnswerRow.tsx`; they are wrong here on both sample and basis.

import type { AnswerCard } from "@/components/AnswerRow";
import { pctOf } from "@/components/AnswerRow";
// Types from lib/risk/analytics, NOT lib/book/types. The two declare a
// `ScenarioResult` with the same name and different nullability
// (contribution_breakdown is optional on one), and this page is fed by the
// analytics reader — importing the book's copy typechecked as a mismatch.
import type { AnalyticsState, CorrelationPair, ScenarioResult } from "@/lib/risk/analytics";
import type { PositionAttribution } from "@/lib/risk/riskBoard";

/** Signed percent with an explicit sign, so a positive tail cannot read as a loss. */
const signedPct = (v: number) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;

/**
 * The melt-up scenario. Matched on `scenario_name` rather than on the sign of the
 * return: a risk-ON scenario that happens to price negative is exactly the finding
 * worth surfacing (ADR-0074 — a net-short book is stressed on BOTH tails), and
 * picking "the most positive scenario" would hide it by construction.
 */
function meltUp(rows: ScenarioResult[]): ScenarioResult | null {
  return (
    rows.find((r) => /melt|risk[-_ ]?on|squeeze/i.test(r.scenario_name ?? "")) ??
    rows.find((r) => /melt|risk[-_ ]?on|squeeze/i.test(r.label ?? "")) ??
    null
  );
}

function worst(rows: ScenarioResult[]): ScenarioResult | null {
  return rows.reduce<ScenarioResult | null>(
    (lo, r) =>
      typeof r.estimated_book_return === "number" &&
      (lo === null || r.estimated_book_return < lo.estimated_book_return)
        ? r
        : lo,
    null,
  );
}

/** Why a state has no value, in the words the card shows. Mirrors `explainGap`'s
 *  discipline: name the column, never say "no data". */
function why(state: AnalyticsState<unknown>, column: string): string {
  switch (state.status) {
    case "loading":
      return "Still loading.";
    case "query_error":
      return `The read of ${column} was rejected, so this is unknown rather than absent.`;
    case "no_row":
      return "No book has been published yet, so there is nothing to stress.";
    case "null_column":
      return `${column} is null for this run — the analytic did not run, which is not the same as no risk.`;
    case "empty":
      return `${column} is present but empty for this run.`;
    default:
      return "";
  }
}

export function riskAnswerCards({
  scenarioState,
  correlationState,
  attribution,
  positionCount,
  factorCoverage,
  covShrinkageIntensity,
}: {
  scenarioState: AnalyticsState<ScenarioResult[]>;
  correlationState: AnalyticsState<CorrelationPair[]>;
  attribution: PositionAttribution[];
  positionCount: number;
  /** Positions with a factor regression behind them — the ex-ante model's reach. */
  factorCoverage: number;
  /** `optimizer_result.cov_shrinkage_intensity`. undefined/null on a run that
   *  predates ADR-0173 — genuinely unshrunk, not merely unrecorded. */
  covShrinkageIntensity?: number | null;
}): AnswerCard[] {
  const scenarios = scenarioState.status === "ok" ? scenarioState.value : null;
  const pairs = correlationState.status === "ok" ? correlationState.value : null;

  // ── 1. Both tails ─────────────────────────────────────────────────────────
  const w = scenarios ? worst(scenarios) : null;
  const up = scenarios ? meltUp(scenarios) : null;
  const bothTails: AnswerCard = {
    label: "Both tails",
    href: "#stress",
    source: "research_recommendations.scenario_results",
    tone: up && up.estimated_book_return < 0 ? "warning" : "default",
    figure:
      w && up ? (
        <>
          {signedPct(w.estimated_book_return)} / {signedPct(up.estimated_book_return)}
        </>
      ) : null,
    consequence:
      !scenarios
        ? why(scenarioState, "scenario_results")
        : !up ? (
            <>
              {scenarios.length} scenarios ran and none is a risk-on case, so only the
              downside tail is measured. A net-short book can lose on a rally too, and
              nothing here would show it (ADR-0074).
            </>
          ) : up.estimated_book_return < 0 ? (
            <>
              Worst risk-off is {w!.label}; the melt-up ({up.label}) also loses. This
              book is stressed on <strong>both</strong> tails, which is what a net-short
              position does — the rally is not the safe side. Modelled, not realised.
            </>
          ) : (
            <>
              Worst risk-off is {w!.label}; the melt-up ({up.label}) gains. Both are
              modelled estimates from the recommended weights, not realised outcomes.
            </>
          ),
  };

  // ── 2. What to cut first ──────────────────────────────────────────────────
  // Ranked by |β contribution| — signed weight × β_mkt — because that is the
  // quantity a reader can act on: it says which single name is carrying the book's
  // market exposure, and therefore what cutting it buys.
  const ranked = attribution
    .filter((a) => typeof a.betaContribution === "number")
    .sort((x, y) => Math.abs(y.betaContribution!) - Math.abs(x.betaContribution!));
  const top = ranked[0] ?? null;
  const cutFirst: AnswerCard = {
    label: "Carrying the most beta",
    href: "#attribution",
    source: "portfolio_positions × factor_exposures.beta_mkt",
    figure: top ? (
      <>
        {top.asset}{" "}
        <span className="text-[13px] font-normal text-text-secondary">
          {top.betaContribution! >= 0 ? "+" : ""}
          {top.betaContribution!.toFixed(2)}
        </span>
      </>
    ) : null,
    consequence: top ? (
      <>
        {top.direction === "short" ? "Short" : "Long"} {top.asset} at{" "}
        {top.signedWeight === null ? "an unrecorded weight" : pctOf(Math.abs(top.signedWeight))}{" "}
        contributes the largest single share of book β
        {top.betaContributionShare === null
          ? ""
          : ` (${pctOf(top.betaContributionShare, 0)} of the total)`}
        . Cutting it moves the book&apos;s market exposure more than any other name.
      </>
    ) : (
      <>
        No position has a factor regression behind it, so no β contribution can be
        attributed. Absent, not zero — see <code className="num">factor_exposures</code>.
      </>
    ),
  };

  // ── 3. Ideas vs names ─────────────────────────────────────────────────────
  const namesInPairs = pairs
    ? new Set(pairs.flatMap((p) => [p.asset_a, p.asset_b].filter(Boolean) as string[])).size
    : null;
  const ideasVsNames: AnswerCard = {
    label: "Ideas vs names",
    href: "#concentration",
    source: "research_recommendations.correlation_pairs",
    tone: namesInPairs !== null && namesInPairs >= 4 ? "warning" : "default",
    figure:
      pairs && namesInPairs !== null ? (
        <>
          {positionCount} held · {pairs.length} flagged
        </>
      ) : null,
    consequence: !pairs ? (
      correlationState.status === "empty" ? (
        <>
          No pair cleared the correlation threshold this run, so on this measure every
          name is its own idea. That is a statement about ρ over 252 days, not a promise
          of independence.
        </>
      ) : (
        why(correlationState, "correlation_pairs")
      )
    ) : (
      <>
        {pairs.length} pair{pairs.length === 1 ? "" : "s"} cross the correlation
        threshold, touching {namesInPairs} of {positionCount} names — so the book holds
        fewer independent bets than positions. The single-name cap is evaded by a
        complex unless the group is capped too (ADR-0037).
      </>
    ),
  };

  // ── 4. What this cannot see ───────────────────────────────────────────────
  // The card that makes the basis explicit. Every other figure on this page is a
  // pure function of weights and a sample Σ; a reader is owed the reach of that
  // model and the direction of its residual bias before they act on the three
  // cards above.
  //
  // ADR-0173 shrinks Σ toward constant correlation before EITHER this book is
  // sized or its risk is reported (`optimizer.covariance_from_returns`), which
  // narrows the bias this card originally disclosed without eliminating it — a
  // FIXED intensity is not the same claim as "unbiased". `covShrinkageIntensity`
  // is read from the persisted run rather than assumed, because a run that
  // predates ADR-0173 genuinely was unshrunk and this card must not claim
  // otherwise about history it cannot see.
  const uncovered = positionCount - factorCoverage;
  const cannotSee: AnswerCard = {
    label: "What this cannot see",
    href: "#exposure",
    source: "factor_exposures.r_squared · optimizer.covariance_from_returns",
    tone: uncovered > 0 ? "warning" : "default",
    figure:
      positionCount > 0 ? (
        <>
          {factorCoverage}/{positionCount} modelled
        </>
      ) : null,
    consequence:
      positionCount === 0 ? (
        <>No positions are held, so there is nothing to model.</>
      ) : (
        <>
          {uncovered > 0 ? (
            <>
              {uncovered} position{uncovered === 1 ? "" : "s"} have no factor
              regression, so their risk enters only through covariance.{" "}
            </>
          ) : null}
          Every figure here is <strong>ex-ante</strong>: a function of the recommended
          weights and a 252-day sample covariance. The same estimate sized the book, so
          the reported volatility is still a <strong>lower bound</strong>
          {covShrinkageIntensity === null || covShrinkageIntensity === undefined ? (
            <>
              {" "}
              — and this run predates the covariance shrinkage that narrows that gap,
              so it applies with its full original severity.
            </>
          ) : covShrinkageIntensity > 0 ? (
            <>
              , narrowed but not removed: Σ is shrunk {pctOf(covShrinkageIntensity, 0)}{" "}
              toward constant correlation before either the sizing or this report reads
              it, while μ is shrunk 50%. A fixed, stated intensity — not a claim of no
              bias.
            </>
          ) : (
            <> — this run applied no shrinkage, so it holds with its full severity.</>
          )}
        </>
      ),
  };

  return [bothTails, cutFirst, ideasVsNames, cannotSee];
}
