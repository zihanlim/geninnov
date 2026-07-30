// frontend/lib/method/phases.ts
//
// The six phases of the investment process. This is the site's NAVIGATION.
//
// WHY THIS FILE EXISTS.
// `task.md` Q1 is answered as a six-phase PM workflow, and this system performs
// five of the six. That sequence used to be invisible: ADR-0025 ordered four
// object-shaped destinations "as a PM's morning" and TopBar.tsx repeated the
// ordering in a CODE COMMENT, so a reader landing on `/` could not see that
// alpha feeds construction feeds attribution.
//
// ADR-0169 surfaced the sequence on one page and labelled each destination.
// ADR-0170 went further at the owner's direction: navigation IS the sequence
// now, one tab per phase, because a numbered strip teaches the process before a
// reader has read anything. `TopBar` renders this array directly — the tabs and
// the process map cannot disagree, because there is only one list.
//
// WHAT THAT COST, RECORDED HONESTLY.
// `/risk` answered three phases at once and could not survive as one
// destination; it is split across /mandate, /risk and /attribution by
// `lib/method/phaseSections.ts`. The three routes still share ONE fetch through
// `RiskBody`, because three useEffects are three chances to describe different
// vintages of the same run. `/method` and `/risk` remain as routes and leave the
// nav: the method chapters are cross-cutting — they explain every phase — so
// naming them as one would be false.
//
// PHASE 5 IS A ROUTE WITH NO FIGURES, ON PURPOSE. A sequence that skips from 4
// to 6 reads as a missing page. It is not missing; it is out of scope, and the
// reason is worth more than the tab costs.

/** A phase's implementation state. `absent` is a stated scope boundary, not a gap. */
export type PhaseCoverage = "live" | "absent";

export interface Phase {
  /** 1-based. The reader sees this; it is never written at a call site. */
  n: number;
  id: string;
  name: string;
  /** What a PM is asking when they are in this phase. Kept to one line. */
  question: string;
  /** Tab label. Short because six of these share one strip — `name` is the full
   *  title and is what the process map and the page headings use. */
  tab: string;
  /** Rail label. Shorter still: `SideRail` collapsed is 56px wide and cannot be
   *  widened (ADR-0086 — /book's two-pane layout needs every remaining pixel),
   *  which leaves ~48px for 10px type, or about nine characters. `Construction`
   *  and `Attribution` overrun it and clip.
   *
   *  A third label rather than a number, because SideRail's own rule is icon AND
   *  word, never icon alone: a reader who does not recognise the glyph must
   *  still be able to read where it goes, and "04" does not tell them. */
  short: string;
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
    short: "Mandate",
    tab: "Mandate",
    name: "Mandate & risk architecture",
    question: "What am I solving for, and inside which limits?",
    route: "/mandate",
    anchor: null,
    coverage: "live",
    note: "MandatePanel and the limit board that measures against it.",
  },
  {
    n: 2,
    id: "alpha",
    short: "Alpha",
    tab: "Alpha",
    name: "Alpha sourcing",
    question: "What is moving, and what does consensus not see yet?",
    route: "/",
    anchor: null,
    coverage: "live",
    note: "The theme board and the narrative detection plane (L1, L1b).",
  },
  {
    n: 3,
    // Renamed from `scenario` and given the `/risk` route (ADR-0172). Phase 3's
    // question already WAS the risk question, so this is a label and a route rather
    // than a new destination — the six-phase sequence is untouched.
    //
    // `name` and `question` widened with the tab. A tab reading `Risk` while the
    // phase says only "Catalyst & scenario" would be a mismatch that matters
    // mechanically, not just editorially: the answer row is generated FROM
    // `question`, so a narrow question puts the wrong four cards above the fold.
    id: "risk",
    short: "Risk",
    tab: "Risk",
    name: "Risk & scenario",
    question:
      "What could go wrong, what would it cost, and what proves the thesis right?",
    route: "/risk",
    anchor: null,
    coverage: "live",
    note: "StressScenarios — the six-scenario matrix, incl. the supply shock that does not transmit through market beta.",
  },
  {
    n: 4,
    id: "construction",
    short: "Sizing",
    tab: "Construction",
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
    short: "Execution",
    tab: "Execution",
    name: "Execution & microstructure",
    question: "Can this be put on without the impact eating the thesis?",
    route: "/execution",
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
    short: "Outcome",
    tab: "Attribution",
    name: "Attribution & feedback",
    question: "Was the thesis right, or was the sizing wrong?",
    route: "/attribution",
    anchor: null,
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
 * Still an ARRAY though every route now serves exactly one. Under ADR-0169
 * `/risk` genuinely served two, and the split that fixed that is a layout
 * decision rather than a law — a signature that returned one phase would have to
 * be widened again the moment two share a page, and callers written against it
 * would each have to pick a winner silently.
 */
export function phasesForRoute(route: string): Phase[] {
  return PHASES.filter((p) => p.route === route);
}

/** Zero-padded display number, matching the step numbers on /method's chapters. */
export function phaseNumber(p: Phase): string {
  return String(p.n).padStart(2, "0");
}
