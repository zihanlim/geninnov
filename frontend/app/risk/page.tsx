"use client";
// frontend/app/risk/page.tsx
//
// /risk — phase 4, Risk & scenario. What could go wrong, what it would cost, and
// where it is concentrated.
//
// This route has had three jobs in two days, and the third is the simplest.
// ADR-0025 made it a destination answering three phases at once; ADR-0170 dissolved
// it into /mandate, /risk-as-scenario and /attribution and left this path as a
// fragment-aware hop; ADR-0172 gives it back to this phase, because its question
// always WAS the risk question and naming the tab `Scenario` hid that.
//
// WHY THE HOP SURVIVES, MUCH SMALLER.
// Most of the old anchors are native again: `/risk#stress`, `#attribution`,
// `#exposure` and `#concentration` are all rendered by this page, so they resolve
// with no redirect at all. Only three fragments genuinely live elsewhere now —
// `#mandate` and `#limits` moved to /mandate, `#realised` to /attribution — and a
// URL fragment never reaches the server, so those still have to be hopped in the
// browser. `RISK_SECTION_PHASE` is the same map that decides what this page renders,
// so the hop and the render cannot disagree about who owns a section.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import RiskBody from "@/components/risk/RiskBody";
import { RISK_SECTION_PHASE, type RiskSectionId } from "@/lib/method/phaseSections";

/** Where a section lives, for the sections this page does NOT render. */
const ELSEWHERE = { mandate: "/mandate", attribution: "/attribution" } as const;

export default function RiskPage() {
  const router = useRouter();

  useEffect(() => {
    const hop = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id) return;
      const owner = RISK_SECTION_PHASE[id as RiskSectionId];
      // Rendered here, or unknown to us: leave the reader alone. Guessing a
      // destination for an id we do not recognise would strand them mid-page, and
      // hopping one we DO render would be a redirect loop.
      if (!owner || owner === "risk") return;
      router.replace(`${ELSEWHERE[owner]}#${id}`);
    };
    hop();
    // `hashchange`, not mount alone — the same listener `LegacyAnchorHop` carries
    // and for the same reason. Changing only the fragment is a SAME-DOCUMENT
    // navigation: the component never remounts, so a mount-only effect cannot see
    // it. The live case is a reader already on this page clicking an in-page link
    // to `#limits`, which now lives on /mandate; without this they would sit on
    // /risk#limits looking at a fragment nothing here renders.
    //
    // Found by a verification loop that walked fragments on one path and reported
    // every hop as "native" — the artefact was measuring the bug.
    window.addEventListener("hashchange", hop);
    return () => window.removeEventListener("hashchange", hop);
  }, [router]);

  return <RiskBody phase="risk" />;
}
