// frontend/app/book2/page.tsx
//
// TEMPORARY. The comparison surface for the Stitch "Systematic Alabaster" adoptions:
// thesis paired with its counter-thesis, visible source tokens in cited prose, and a
// master-detail reading model instead of an accordion. Open it beside `/book` in two
// tabs and decide.
//
// It renders `BookShell` — the SAME component `/book` renders, with one `useEffect`
// and one set of queries — told to draw the other layout. It deliberately does NOT
// fetch anything itself: two routes querying `research_recommendations` separately
// could describe two different runs, which is the failure ADR-0040 closed and the
// reason `/method` and `/method/evidence` share one body (ADR-0084).
//
// REMOVE THIS ROUTE once the comparison is settled, together with the `BookVariant`
// type and its branches. A comparison surface that outlives the comparison is a
// second code path over the same data, which is what ADR-0084's stop rule forbids.

import { BookShell } from "@/components/book/BookBody";

export default function BookNextPage() {
  return <BookShell variant="next" />;
}
