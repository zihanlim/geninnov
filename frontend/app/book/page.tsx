// frontend/app/book/page.tsx
//
// L6: the $100M book — per-trade thesis, pool depth, turnover, replication.
// (`/research`, `/portfolio` and `/trades` are retired server redirects to here.)
//
// The body lives in `components/book/BookBody.tsx` so that `/book2` — the temporary
// surface for comparing adopted layout ideas — can render the SAME component with one
// `useEffect` and one set of queries, rather than a second copy that could describe a
// different run (ADR-0040, and the reason `/method` and `/method/evidence` share one
// `MethodBody` per ADR-0084). A route module may not export anything but `default` and
// Next's config exports, which is why the shared component is not exported from here.

import { BookShell } from "@/components/book/BookBody";

export default function BookPage() {
  return <BookShell variant="current" />;
}
