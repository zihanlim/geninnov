// frontend/app/scenario/page.tsx
//
// Retired. `/risk` is the risk phase since ADR-0172 (phase 4 since ADR-0188) — its question always was the risk
// question, and the `Scenario` label hid that from a reader scanning the tabs.
//
// A server redirect rather than deletion, and it is worth one line: `/scenario`
// existed for a few hours on 2026-07-30, and ADR-0170's own text, this session's
// PROGRESS row and several in-repo links all cite it. A dead link inside the record
// of a decision is a small thing that makes the record harder to trust — the same
// reasoning that kept `/trades`, `/portfolio` and `/research` alive as redirects.
//
// Unlike the fragment hop on `/risk`, this needs no fragment handling: every anchor
// `/scenario` ever rendered is rendered by `/risk` too, so a fragment survives the
// redirect on the client and lands on a section that exists.

import { redirect } from "next/navigation";

export default function ScenarioRedirect() {
  redirect("/risk");
}
