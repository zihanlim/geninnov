"use client";
// frontend/components/method/LegacyAnchorHop.tsx
//
// Keeps every documented /method#<id> deep link resolving after the chapter
// split. ADRs, PROGRESS.md rows and the design spec all link to anchors that
// used to live on one page; three of them now live on /method/evidence.
//
// This has to be client-side. A URL fragment is NEVER sent to the server — the
// browser strips it before the request — so next.config redirects(), middleware
// and a server redirect() all receive a bare `/method` with no way to know which
// section was asked for. Only the browser knows, and only after the page loads.
//
// Consequences worth naming rather than hiding:
//   * A reader following /method#guardrails sees a brief flash of the build
//     chapter before the hop. Unavoidable, for the reason above.
//   * router.replace, NOT push — otherwise Back returns the reader to /method,
//     which immediately re-hops, and they can never leave.
//   * Mounted on BOTH chapters, so a stale /method/evidence#hypescore link is
//     corrected too. routeForAnchor returning the current pathname is a no-op,
//     so there is no redirect loop.
//   * An unknown fragment is left alone. Guessing a destination for an id we do
//     not recognise would send a reader somewhere arbitrary.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { routeForAnchor } from "@/lib/method/anchors";

export default function LegacyAnchorHop() {
  const router = useRouter();

  useEffect(() => {
    const hop = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id) return;
      const target = routeForAnchor(id);
      if (target && target !== window.location.pathname) {
        router.replace(`${target}#${id}`);
      }
    };
    hop();
    // A reader can click a same-page anchor that belongs to the other chapter
    // (e.g. a CitationList link), which fires hashchange rather than a mount.
    window.addEventListener("hashchange", hop);
    return () => window.removeEventListener("hashchange", hop);
  }, [router]);

  return null;
}
