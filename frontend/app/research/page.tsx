import { redirect } from "next/navigation";

// /research is retired. It rendered the Q1 book view, per-pick theses, factor
// tilts and cross-cutting book risks — every one of which is now on /book,
// gated by the same AdvisoryDerivation provenance policy. Keeping a second copy
// invited the two surfaces to disagree about which book is current.
//
// The consolidated decision triad:
//
//   /book  — Q1 book view, per-pick thesis + citations, factor tilts, book risks
//   /risk  — VaR/CVaR/Sharpe/beta, factor + scenario attribution
//   /method — how every score is computed, against live data
//
// The market bar and prediction-market context that lived here remain available
// on the theme and book surfaces. Server-side redirect so old links resolve to
// the guardrail-verified book.
export default function ResearchPage() {
  redirect("/book");
}
