// frontend/app/method/page.tsx
//
// /method — chapter one: how a number is built.
//
// HypeScore, TradeScore, EdgeScore and the factor model, with their formulas
// rendered from live scoring_config and their reconciliations against the
// persisted values. The pipeline's own status, its data feeds and the LLM
// guardrails are chapter two, /method/evidence.
//
// The page was one 13,057px document — 14.5 screens — answering two unrelated
// reader questions. See ADR-0084 for the split axis and its stop rules.

import MethodBody from "@/components/method/MethodBody";
import LegacyAnchorHop from "@/components/method/LegacyAnchorHop";

export default function MethodPage() {
  return (
    <>
      <LegacyAnchorHop />
      <MethodBody chapter="build" />
    </>
  );
}
