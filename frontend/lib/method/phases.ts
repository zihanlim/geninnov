// frontend/lib/method/phases.ts
//
// The six phases of the investment process, and which surface implements each.
//
// WHY THIS FILE EXISTS.
// The four destinations in `TopBar.tsx` are ordered as a portfolio manager's
// morning — what's moving, what we'd put on, what could go wrong, how it was
// derived — and ADR-0025 chose that ordering deliberately. But the ordering was
// only ever written in a CODE COMMENT. A reader landing on `/` could not see
// that Themes feeds Book feeds Risk, and no surface stated the process end to
// end. The workflow was real and invisible.
//
// WHY IT IS DATA AND NOT PROSE ON A PAGE.
// Two consumers read it: `ProcessMap` (the /method landing) and `PhaseChip`
// (the eyebrow on every destination header). Written twice, they drift, and the
// failure is silent — a chip claiming "Phase 3" on a page the map sends Phase 4
// to. Same reasoning as `anchors.ts`, which is data for the same reason.
//
// WHY NAVIGATION IS NOT ORGANISED BY THESE PHASES.
// A phase-per-tab structure was considered and rejected (ADR-0169). Two phases
// land on `/risk` — the mandate the book is measured against, and the scenarios
// that stress it — and splitting them to satisfy the numbering would break the
// risk picture apart for the sake of the narrative. Phase 5 has no surface at
// all. Navigation stays organised by the OBJECT a reader asks about; the process
// gets one surface and a label, which is what was actually missing.

/** A phase's implementation state. `absent` is a stated scope boundary, not a gap. */
export type PhaseCoverage = "live" | "absent";

export interface Phase {
  /** 1-based. The reader sees this; it is never written at a call site. */
  n: number;
  id: string;
  name: string;
  /** What a PM is asking when they are in this phase. Kept to one line. */
  question: string;
  /** The destination that answers it, or null when nothing does. */
  route: string | null;
  /** Section id within `route`. Null means the whole page is the answer. */
  anchor: string | null;
  coverage: PhaseCoverage;
  /**
   * Live: what renders the evidence, so a reader can go find it in the repo.
   * Absent: the REASON there is nothing, which is the content of that entry.
   */
  note: string;
}

/**
 * Every anchor below was verified to exist at the time of writing. A phase that
 * points at an id nothing renders is a link that scrolls to the top and looks
 * like a broken page, which is the failure `method-anchors.test.ts` already
 * guards for the /method chapters — `phases.test.ts` does the same here.
 */
export const PHASES: readonly Phase[] = [
  {
    n: 1,
    id: "mandate",
    name: "Mandate & risk architecture",
    question: "What am I solving for, and inside which limits?",
    route: "/risk",
    anchor: "mandate",
    coverage: "live",
    note: "MandatePanel — the caps, the lens and who chose them.",
  },
  {
    n: 2,
    id: "alpha",
    name: "Alpha sourcing",
    question: "What is moving, and what does consensus not see yet?",
    route: "/",
    anchor: null,
    coverage: "live",
    note: "The theme board and the narrative detection plane (L1, L1b).",
  },
  {
    n: 3,
    id: "scenario",
    name: "Catalyst & scenario",
    question: "What proves the thesis right, and what do the other paths cost?",
    route: "/risk",
    anchor: "risk-stress-heading",
    coverage: "live",
    note: "StressScenarios — the six-scenario matrix, incl. the supply shock that does not transmit through market beta.",
  },
  {
    n: 4,
    id: "construction",
    name: "Construction & sizing",
    question: "Given the edge and the budget, what weights?",
    route: "/book",
    // The `Sizing` panel, not `SizingProvenance`'s own root — that root is a
    // data-testid and it renders nothing at all until there is a book to size.
    anchor: "sizing",
    coverage: "live",
    note: "SizingProvenance — the optimizer's own account of how each weight was reached.",
  },
  {
    n: 5,
    id: "execution",
    name: "Execution & microstructure",
    question: "Can this be put on without the impact eating the thesis?",
    route: null,
    anchor: null,
    coverage: "absent",
    // Stated rather than left blank. An empty phase with no explanation reads as
    // an unfinished product; the boundary is a decision and says so. Per ADR-0040
    // the published book is a RECOMMENDATION — nobody has paid to put it on — so
    // there is no fill, no borrow cost and no slippage to report. Reporting them
    // would mean inventing them, which rule 1 of ADR-0025 forbids outright.
    note: "Out of scope, deliberately. The book is a recommendation, not a held position — there is no fill to report, and inventing one would break the no-authored-figures rule.",
  },
  {
    n: 6,
    id: "attribution",
    name: "Attribution & feedback",
    question: "Was the thesis right, or was the sizing wrong?",
    route: "/method/evidence",
    anchor: "track-record",
    coverage: "live",
    note: "TrackRecord — published picks resolved against a pipeline-assigned 21-day horizon (ADR-0090).",
  },
] as const;

/** The href a phase entry links to, or null when it has no destination. */
export function phaseHref(p: Phase): string | null {
  if (!p.route) return null;
  return p.anchor ? `${p.route}#${p.anchor}` : p.route;
}

/**
 * The phases a destination serves, in order.
 *
 * Returns an ARRAY and not a single phase because `/risk` genuinely serves two
 * (1 and 3). A signature that returned one would force a caller to pick, and
 * whichever it picked would be a page silently claiming to be half of itself.
 */
export function phasesForRoute(route: string): Phase[] {
  return PHASES.filter((p) => p.route === route);
}

/** Zero-padded display number, matching the step numbers on /method's chapters. */
export function phaseNumber(p: Phase): string {
  return String(p.n).padStart(2, "0");
}
