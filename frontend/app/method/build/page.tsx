// frontend/app/method/build/page.tsx
//
// /method/build — chapter one: how a number is built.
//
// HypeScore, TradeScore, EdgeScore and the factor model, with their formulas
// rendered from live scoring_config and their reconciliations against the
// persisted values. The pipeline's own status, its data feeds and the LLM
// guardrails are chapter two, /method/evidence.
//
// The page was one 13,057px document — 14.5 screens — answering two unrelated
// reader questions. See ADR-0084 for the split axis and its stop rules.
//
// This content sat at bare `/method` until ADR-0169 gave that route to the
// process map. Inbound links are unaffected: every documented deep link is of
// the form /method#<id>, and `LegacyAnchorHop` reads `routeForAnchor()` to hop
// those fragments here. That is the same mechanism ADR-0084 already installed
// for the evidence chapter, pointed at one more route.

import MethodBody from "@/components/method/MethodBody";
import LegacyAnchorHop from "@/components/method/LegacyAnchorHop";

export default function MethodBuildPage() {
  return (
    <>
      <LegacyAnchorHop />
      <MethodBody chapter="build" />
    </>
  );
}
