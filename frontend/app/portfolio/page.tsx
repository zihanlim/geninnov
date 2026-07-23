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
// Server-side redirect so bookmarks and inbound links land on the live surface.
export default function PortfolioPage() {
  redirect("/book");
}
