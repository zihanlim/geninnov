// frontend/app/method/evidence/page.tsx
//
// /method/evidence — chapter two: did it run, and who checked it?
//
// Pipeline status, data sources and provenance, and the guardrails on the
// reasoning layer. This chapter renders no book, no positions and no score — it
// is the audit trail, not the arithmetic. The formulas are chapter one, /method.
//
// It shares MethodBody with /method, deliberately: one component, one useEffect,
// one set of queries. Two chapters that fetched separately could disagree about
// which run they are describing. See ADR-0084.

import MethodBody from "@/components/method/MethodBody";
import LegacyAnchorHop from "@/components/method/LegacyAnchorHop";

export default function MethodEvidencePage() {
  return (
    <>
      <LegacyAnchorHop />
      <MethodBody chapter="evidence" />
    </>
  );
}
