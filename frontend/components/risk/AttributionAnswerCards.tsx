// frontend/components/risk/AttributionAnswerCards.tsx
//
// The four questions a PM arrives at /attribution with, answered above the fold.
//
// Phase 6 asks "was the thesis right, or was the sizing wrong?" and at 7 sessions the
// honest answer is *not yet* — so three of these cards report what CAN be said and
// the fourth reports precisely when the rest unlocks. That fourth card replaces a
// down-capture-vs-benchmark card from an earlier draft of the plan, which would have
// rendered an em-dash: tracking error needs 60 sessions and `portfolio_returns` has 6.
// Two em-dashes in a four-card row is a weak answer to a page's own question; making
// the sample adequacy itself the answer is the strong one, and it fits the product —
// the absence, stated, with the threshold that ends it.
//
// WHAT THIS PAGE MAY SAY AND WHAT IT MAY NOT.
// A count is valid at any n. A ratio over 6 observations is not. So:
//
//   * hit / miss / pending counts from `pick_outcomes` — VALID, they are counts, and
//     rows are written `pending` at publication so the denominator precedes the
//     outcome (ADR-0090);
//   * concentration HHI from `portfolio_risk.concentration_hhi` — VALID, it is a
//     pure function of the sized weights and needs no holding history. The limit it
//     is read against is `MONITORED.hhi` (2 000 on the 0–10 000 scale — five
//     equal-weight names), so a breach or near-breach is an attribution-relevant
//     fact: the book is more concentrated than the mandate watches for. If the value
//     is absent the card says why, rather than implying diversification;
//   * Sharpe / Sortino / Calmar / drawdown / realised beta / TE / IR — REFUSED. They
//     come from `portfolio_returns`, which is costless on a book measured at 92.7%
//     mean daily turnover, and `CostDrag` measured what that is worth: the published
//     series reads +0.76% while the same book net of its own trading reads -0.72%.
//     The sign flips. Wrong on sample AND basis; `sampleAdequacy` already suppresses
//     them on the panels below and they must not reappear here.
//
// The cost card is the one a reader should leave with. It is the finding this whole
// surface exists to make unmissable: over the observed window gross -1.26% became net
// -2.01%, and the difference is not a rounding error, it is the strategy. It renders
// as "Gross against net" rather than a standalone cost card: the gross and net
// RETURNS ARE the cost, restated, and two cards saying the same thing is the
// duplication this row exists to avoid.

import type { AnswerCard } from "@/components/AnswerRow";
import { pctOf } from "@/components/AnswerRow";
import type { HoldingsPerformanceRow } from "@/components/risk/CostDrag";
import type { TrackRecord } from "@/lib/method/trackRecord";
import { MIN_SESSIONS_BY_FIELD } from "@/lib/risk/sampleAdequacy";
import { MONITORED } from "@/lib/mandate";

const sum = (xs: Array<number | null | undefined>) =>
  xs.reduce<number>((a, x) => a + (typeof x === "number" ? x : 0), 0);

/** The statistics still suppressed at `sessions`, cheapest threshold first. */
function stillSuppressed(sessions: number): Array<[string, number]> {
  return Object.entries(MIN_SESSIONS_BY_FIELD)
    .filter(([, needs]) => sessions < needs)
    .sort((a, b) => a[1] - b[1]);
}

export function attributionAnswerCards({
  track,
  hhi,
  holdings,
  sessions,
}: {
  /** From `pick_outcomes` via buildTrackRecord, or null when the read failed. */
  track: TrackRecord | null;
  /**
   * The published book's concentration HHI (`portfolio_risk.concentration_hhi`),
   * on the 0–10 000 scale the backend writes (`Σwᵢ²·10 000`). Null when the run
   * predates the field or the read failed.
   */
  hhi: number | null;
  holdings: HoldingsPerformanceRow[];
  /** `portfolio_returns` row count — what every ratio below is gated on. */
  sessions: number;
}): AnswerCard[] {
  // ── 1. The forward record, as counts ──────────────────────────────────────
  const record: AnswerCard = {
    label: "Published picks resolved",
    href: "#realised",
    source: "pick_outcomes.verdict",
    figure: !track
      ? null
      : track.resolved === 0 ? (
          <>{track.pending} pending</>
        ) : (
          <>
            {track.hits}/{track.resolved} hit
          </>
        ),
    consequence: !track ? (
      <>
        <code className="num">pick_outcomes</code> could not be read, so the forward
        record is unknown rather than empty.
      </>
    ) : track.total === 0 ? (
      <>
        No pick has been published with a resolution horizon yet. The table is written
        at publication, so this is genuinely nothing rather than a pending write.
      </>
    ) : track.resolved === 0 ? (
      <>
        All {track.total} picks across {track.books} book
        {track.books === 1 ? "" : "s"} are still inside their {track.horizonDays}-day
        horizon
        {track.firstExpectedMaturity ? `; the first matures ${track.firstExpectedMaturity}` : ""}
        . Rows are written <em>pending</em> at publication, so the denominator exists
        before any outcome does (ADR-0090).
      </>
    ) : (
      <>
        {track.resolved} of {track.total} picks have matured at {track.horizonDays} days
        {track.pending > 0 ? `, ${track.pending} still open` : ""}. No Brier score:
        conviction is a sizing input, not a probability the call is right.
      </>
    ),
  };

  // ── 2. Concentration — the one headline risk metric this phase can publish ──
  // The four VaR/Sharpe/beta tiles on the grid above are ALL suppressed at the
  // current session count (30–60 required), which is why the fourth card exists to
  // say so. HHI is not gated: it is a pure function of the sized weights and needs
  // no holding history, so it is the one number that answers "is the sizing doing
  // what the thesis promised" on a book too young to measure any return statistic.
  // The ceiling it is read against is MONITORED.hhi — watched, never enforced.
  const hhiLimit = MONITORED.hhi.value; // 2 000 ≈ five equal-weight names (DOJ scale)
  const concentration: AnswerCard = {
    label: "Concentration",
    href: "#realised",
    source: "portfolio_risk.concentration_hhi",
    tone: hhi !== null && hhi >= hhiLimit ? "warning" : "default",
    figure:
      hhi === null ? null : (
        <>
          {hhi.toFixed(0)}
          <span className="text-[12px] text-text-tertiary font-normal">
            {" "}/ {hhiLimit.toLocaleString()}
          </span>
        </>
      ),
    consequence:
      hhi === null ? (
        <>
          <code className="num">portfolio_risk.concentration_hhi</code> is not recorded
          for this run, so concentration is unmeasured rather than low. The risk grid
          above reports the same absence.
        </>
      ) : (
        <>
          Book HHI on the 0–10 000 scale — {pctOf(hhi / hhiLimit, 0)} of the{" "}
          {hhiLimit.toLocaleString()} monitored ceiling (
          {hhiLimit.toLocaleString()} ≈ five equal-weight names).{" "}
          {hhi >= hhiLimit
            ? "The book is more concentrated than the mandate watches for."
            : "Inside the monitored ceiling — a book this size reads as concentrated, not broad."}
        </>
      ),
  };

  // ── 3. Gross against net — where the sign lives ───────────────────────────
  const g = holdings.length ? sum(holdings.map((h) => h.gross_return)) : null;
  const n = holdings.length ? sum(holdings.map((h) => h.net_return)) : null;
  const flips = g !== null && n !== null && g >= 0 && n < 0;
  const grossNet: AnswerCard = {
    label: "Gross against net",
    href: "#realised",
    source: "book_holdings_performance.gross_return · net_return",
    tone: flips ? "warning" : "default",
    figure:
      g === null || n === null ? null : (
        <>
          {(g * 100).toFixed(2)}% / {(n * 100).toFixed(2)}%
        </>
      ),
    consequence:
      g === null || n === null ? (
        <>
          The held book has no return series yet, so gross and net cannot be compared —
          and the gap between them is the whole question on this page.
        </>
      ) : flips ? (
        <>
          <strong>The sign flips.</strong> The same positions earn {pctOf(g, 2)} before
          trading costs and lose {pctOf(Math.abs(n), 2)} after them. The cost is not a
          haircut on the result; over this window it <em>is</em> the result.
        </>
      ) : (
        <>
          {pctOf(g, 2)} before trading costs, {pctOf(n, 2)} after. The gap is what
          reconstituting the book each run costs, priced by this repo&apos;s own cost
          model rather than assumed away.
        </>
      ),
  };

  // ── 4. Can this be judged yet? ────────────────────────────────────────────
  const suppressed = stillSuppressed(sessions);
  const next = suppressed[0] ?? null;
  const judgeable: AnswerCard = {
    label: "Can this be judged yet?",
    href: "#realised",
    source: "portfolio_returns · lib/risk/sampleAdequacy",
    tone: suppressed.length > 0 ? "warning" : "default",
    figure: (
      <>
        {sessions} session{sessions === 1 ? "" : "s"}
      </>
    ),
    consequence:
      suppressed.length === 0 ? (
        <>
          Every gated statistic now has the history it needs, so the panels below
          publish rather than refuse.
        </>
      ) : (
        <>
          {suppressed.length} statistic{suppressed.length === 1 ? "" : "s"} are still
          withheld for want of history — {next![0]} unlocks at {next![1]}. A ratio over{" "}
          {sessions} observations is arithmetic, not evidence: the persisted Sharpe reads
          5.14 and is not published for exactly that reason.
        </>
      ),
  };

  return [record, concentration, grossNet, judgeable];
}
