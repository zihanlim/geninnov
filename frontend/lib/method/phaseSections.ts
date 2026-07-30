// frontend/lib/method/phaseSections.ts
//
// Which phase route renders which of the risk body's sections.
//
// `/risk` was ONE page with seven sections answering three different phases of
// the process: the mandate a book is measured against (phase 1), the scenarios
// that stress it (phase 3), and what it actually did (phase 6). When navigation
// became one tab per phase, that page could no longer be one destination — a tab
// strip cannot mark three of its own tabs current at once.
//
// The split is by READER QUESTION, the same axis ADR-0084 used to cut /method in
// two, and for the same reason: a section belongs where the question it answers
// is being asked, not where it happened to be written.
//
// WHAT THIS DELIBERATELY DOES NOT DO: it does not split the FETCH. `RiskBody`
// keeps one useEffect and one set of queries and is filtered by `phaseShows`,
// exactly as `MethodBody` is filtered by `chapterOwns`. Three routes with their
// own fetches are three chances to describe different vintages of the same run —
// the contradiction ADR-0040 closed when /trades, /portfolio and /research were
// retired into /book, and ADR-0084 refused to reopen.

/** The phases that render part of the risk body. */
export type RiskPhase = "mandate" | "risk" | "attribution";

/**
 * Section id → the phase route that renders it.
 *
 *   mandate     — "what is this book allowed to be, and is it inside that?"
 *   risk        — "what could go wrong, and where is it concentrated?"
 *   attribution — "what did it actually do?"
 *
 * `limits` sits with the mandate rather than with stress: the limit board
 * MEASURES AGAINST the mandate panel directly above it, and separating a
 * constraint from the reading of that constraint is what made the caps
 * unreadable before MandatePanel existed.
 *
 * `attribution` (per-position risk decomposition) sits with RISK, not with the
 * phase of the same name. It is ex-ante — which position would hurt most if
 * something happened — and phase 6 is ex-post. Two different questions that the
 * shared word disguises.
 */
export const RISK_SECTION_PHASE = {
  mandate: "mandate",
  limits: "mandate",
  stress: "risk",
  // ADR-0172: moved off /mandate. The mandate LISTS a VaR limit and the metric
  // grid reports the one published figure; the four-way comparison is a risk
  // analysis, not a limits check.
  "var-methods": "risk",
  concentration: "risk",
  exposure: "risk",
  attribution: "risk",
  realised: "attribution",
} as const satisfies Record<string, RiskPhase>;

export type RiskSectionId = keyof typeof RISK_SECTION_PHASE;

/** Does `phase` render the section with this id? */
export function phaseShows(phase: RiskPhase, id: string): boolean {
  return RISK_SECTION_PHASE[id as RiskSectionId] === phase;
}

/** Section-nav items per phase route. Labels are nouns and carry no figure —
 *  `SectionNav` is asserted to contain no digits. */
/**
 * Phases whose sections all render in ONE row, on ONE screen — so a jump strip
 * has nowhere to jump.
 *
 * `mandate` earned this by measurement, not taste. Since ADR-0179/0181 its two
 * sections are columns of a single row: `#mandate` and `#limits` both begin at
 * y=474 and both end at y=2062. Two tabs that scroll to the same pixel are two
 * tabs a reader has to test to learn are the same, and `SectionNav` picks the
 * FIRST visible id in document order, so "Limits" could never win the active
 * state either — it was a control that could not be right.
 *
 * The section IDS stay. `/risk` still hops `#mandate` and `#limits` here as
 * fragments, and `llms.txt` and any external deep link resolve against them.
 * Only the strip is dropped.
 */
export const PHASES_WITHOUT_SECTION_NAV: RiskPhase[] = ["mandate"];

export const PHASE_SECTION_NAV: Record<
  RiskPhase,
  Array<{ id: string; label: string }>
> = {
  mandate: [],
  risk: [
    { id: "stress", label: "Stress" },
    { id: "var-methods", label: "Value at risk" },
    { id: "attribution", label: "Attribution" },
    { id: "concentration", label: "Concentration" },
    { id: "exposure", label: "Exposure" },
  ],
  attribution: [{ id: "realised", label: "Realised" }],
};
