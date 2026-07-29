// frontend/app/book/page.tsx
//
// L6: the $100M book — per-trade thesis, pool depth, turnover, replication.
// (`/research`, `/portfolio` and `/trades` are retired server redirects to here.)
//
// The body lives in `components/book/BookBody.tsx`. It moved there for the `/book2`
// layout comparison (since retired) and stays because a route module may only export
// `default` and Next's config exports — the same constraint that keeps `PositionRow`
// out of this file — and because a thin route over a component body is the shape
// `components/method/MethodBody.tsx` already uses.

import { BookShell } from "@/components/book/BookBody";

export default function BookPage() {
  return <BookShell />;
}
