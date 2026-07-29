import { redirect } from "next/navigation";

// /portfolio is retired. Its exposure summary, risk grid, factor exposure,
// allocation bar, P&L and cumulative-return panels are all rendered on the
// consolidated decision triad, where they cannot contradict each other:
//
//   /book  — sized long-short book, exposure, allocation, per-trade derivation
//   /risk  — VaR/CVaR/Sharpe/beta, factor exposure, scenario attribution
//   /method — how every score is computed, against live data
//
// The lens filter that lived here is applied on /book against the persisted
// recommendation, so no deep-value is stranded by this redirect.
//
// ── It came back for a day, and went again (ADR-0151 → ADR-0152) ─────────────
//
// ADR-0151 un-retired this route as the HELD book — the positions a portfolio
// following the research would actually own, net of trading costs. The reasoning
// was sound on its own terms: the held book is a genuinely different object from
// the published one, so it was not the duplicate ADR-0025 retired.
//
// It was still wrong, because it answered a question the brief does not ask.
// `task.md` Q1 is *"You have $100 million to invest… what are your top five long
// and short trades, and why?"* — the deliverable is TEN TRADES WITH REASONS. The
// $100M is scale framing: it says these are institutional-size positions, and it
// makes sizing part of a good answer. It is not a mandate to run money, and
// nothing in either question asks what the book EARNED.
//
// A page reporting NAV and since-inception return also invites "what is your track
// record?", which six sessions of data cannot answer and which ADR-0090 and
// ADR-0112 already refuse to claim. Building the surface made that question louder
// while the honest answer stayed "not yet".
//
// WHAT SURVIVED, and why it should: `book_holdings` and
// `book_holdings_performance` still exist and the nightly run still extends them,
// and `/risk` still renders `CostDrag`. That is not the portfolio feature — it is
// the correction to a false claim that predates all of this. The realised curve on
// /risk was gross of transaction costs on a book turning over 95.1% per run, and
// showing it net (+0.76% published against −0.72% held) is owed to a reader
// regardless of what the brief asks for. Deleting the page does not un-ask that.
//
// Server-side redirect so bookmarks and inbound links land on the live surface.
export default function PortfolioPage() {
  redirect("/book");
}
