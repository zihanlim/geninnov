// frontend/app/attribution/page.tsx
//
// Phase route over the shared risk body — see lib/method/phaseSections.ts for
// which sections this phase renders and why they sit here rather than elsewhere.
//
// One component, one fetch, filtered by `phaseShows`. This route does NOT own a
// query: three phase routes with their own useEffects are three chances to
// describe different vintages of the same run (ADR-0084).

import RiskBody from "@/components/risk/RiskBody";

export default function AttributionPage() {
  return <RiskBody phase="attribution" />;
}
