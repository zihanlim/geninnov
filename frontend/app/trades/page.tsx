import { redirect } from "next/navigation";

// /trades is retired. It duplicated the sized book and — critically — rendered
// picks that bypassed the L5 citation guardrail, so a number shown here could
// contradict the verified book on /book. The consolidated decision triad is:
//
//   /book  — sized long-short book, screening funnel, per-trade derivation
//   /risk  — VaR/CVaR/Sharpe/beta, factor + scenario attribution
//   /method — how every score is computed, against live data
//
// The TradeScore ranking and the LensSelector that lived here are both present
// on /book (ranking via the EdgeScore/conviction columns, lens via the persisted
// recommendation). Nothing unique is lost by routing here.
//
// Server-side redirect so the old URL, any bookmark and any inbound deep link
// resolve to the live surface with no client flash.
export default function TradesPage() {
  redirect("/book");
}
