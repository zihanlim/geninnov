"use client";
// frontend/app/risk/page.tsx
//
// /risk is no longer a destination. Its seven sections answered three different
// phases of the process, and once navigation became one tab per phase (ADR-0170)
// a single page could not be marked current for three of them. The body moved to
// `components/risk/RiskBody.tsx` and is rendered by /mandate, /scenario and
// /attribution, filtered by `phaseShows`.
//
// This route survives to keep inbound links working, and it is NOT a plain
// redirect. `/risk#stress` and `/risk#mandate` are cited from ADRs, PROGRESS.md
// rows and other components, and those now live on DIFFERENT routes — so where a
// reader lands depends on the fragment. A server redirect cannot see one: the
// browser strips it before the request. Same constraint, and the same shape of
// answer, as `LegacyAnchorHop` on /method.
//
// A bare `/risk` with no fragment goes to /mandate — the first phase the old
// page opened on, and the section that was at the top of it.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { RISK_SECTION_PHASE, type RiskSectionId } from "@/lib/method/phaseSections";

/** Which phase route now renders each of the old page's sections. */
const PHASE_ROUTE = {
  mandate: "/mandate",
  scenario: "/scenario",
  attribution: "/attribution",
} as const;

export default function RiskRedirect() {
  const router = useRouter();

  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    const phase = RISK_SECTION_PHASE[id as RiskSectionId];
    // An unknown fragment falls back to /mandate rather than being preserved
    // onto a route that may not render it — a fragment we do not recognise is
    // one no phase claims, and guessing would strand the reader mid-page.
    router.replace(phase ? `${PHASE_ROUTE[phase]}#${id}` : "/mandate");
  }, [router]);

  return (
    <main className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 wide:px-5 pt-7 pb-20">
      <div className="skeleton h-[180px]" />
    </main>
  );
}
