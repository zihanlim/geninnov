// frontend/lib/method/anchors.ts
//
// Which /method chapter owns which section anchor.
//
// This exists as DATA rather than as a pair of hardcoded route files because a
// URL fragment is never sent to the server: `next.config` redirects(), edge
// middleware and a server-side redirect() all receive a bare `/method` with the
// `#guardrails` stripped by the browser. So the hop from a legacy anchor to its
// new chapter has to happen client-side, and both the hop and the tests need to
// read the same map — otherwise the map and the sections drift and a documented
// deep link starts landing on a page that does not contain its target.
//
// Every one of these ids is referenced from somewhere outside the app: ADRs,
// PROGRESS.md rows and the design docs all link to /method#<id>. Deleting a key
// here is a broken inbound link, which is why method-anchors.test.ts asserts the
// documented set by name rather than by count.

/** The two chapters of /method that `MethodBody` renders.
 *
 *  The process map at bare `/method` (ADR-0169) is deliberately NOT a member.
 *  This union means "a chapter MethodBody renders, filtered by chapterOwns" —
 *  `CHAPTER_STEPS`, `CHAPTER_NAV` and `chapterOwns` are all keyed on it, and the
 *  map renders no gated section, carries no step number and reads no Supabase
 *  table. Admitting it here would add three entries that could only be empty and
 *  would make `chapterOwns("process", id)` a question with no meaning. */
export type MethodChapter = "build" | "evidence";

export const CHAPTER_ROUTE: Record<MethodChapter, string> = {
  // Was bare `/method` until ADR-0169 reassigned that route to the process map.
  // Documented deep links of the form /method#hypescore still resolve: the
  // fragment never reaches the server, so `LegacyAnchorHop` reads this map
  // client-side and replaces to /method/build#hypescore.
  build: "/method/build",
  evidence: "/method/evidence",
};

/**
 * Section id → the chapter that renders it.
 *
 * The split axis is the reader's question, not the pipeline's taxonomy:
 *   build    — "how is this number built?"     formulas, weights, worked examples
 *   evidence — "did it run, and who checked it?" pipeline status, feeds, guardrails
 *
 * The falsifier for that split: "why is HypeScore 62 for theme X?" must be
 * answerable from one chapter alone. It is — the formula, the terms table, the
 * worked example, SignalValidation and the reconciliation all live in `build`.
 */
export const METHOD_ANCHORS = {
  hypescore: "build",
  tradescore: "build",
  edgescore: "build",
  factors: "build",
  // Rendered by SignalValidation, which sets this id itself. Live today and
  // previously undocumented — it is in the map so a link to it cannot silently
  // start resolving to the wrong chapter.
  "signal-validation": "build",
  pipeline: "evidence",
  sources: "evidence",
  guardrails: "evidence",
  // Rendered by TrackRecord (ADR-0090). `evidence`, not `build`: it answers "was the
  // published book right", which is the same reader question as "did it run, and who
  // checked it" — not "how is this number built".
  "track-record": "evidence",
  // Rendered by BookRevisions (ADR-0093). `evidence`: "was the published book changed"
  // is the same reader question as "did it run, and who checked it".
  corrections: "evidence",
} as const satisfies Record<string, MethodChapter>;

export type MethodAnchor = keyof typeof METHOD_ANCHORS;

/** Does `chapter` render the section with this id? */
export function chapterOwns(chapter: MethodChapter, id: string): boolean {
  return METHOD_ANCHORS[id as MethodAnchor] === chapter;
}

/** The route a legacy `/method#id` link should end up on, or null if `id` is
 *  not a known anchor (in which case leave the reader where they are rather
 *  than guessing at a destination). */
export function routeForAnchor(id: string): string | null {
  const chapter = METHOD_ANCHORS[id as MethodAnchor];
  return chapter ? CHAPTER_ROUTE[chapter] : null;
}

/**
 * The NUMBERED steps of each chapter, in render order.
 *
 * The step number beside a heading is derived from this, never written at the call
 * site. It used to be hardcoded — `index="01"` … `index="07"` — assigned when
 * /method was one 13,057px document. ADR-0084 split that document into two chapters
 * rendered from ONE `MethodBody` filtered by `chapterOwns`, and the hardcoded numbers
 * went with their sections: `build` opened on **02 HypeScore** with no 01 on the page,
 * and `evidence` ran 01, then jumped to 06. Both were reported as confusing, because
 * a step number is a promise about what precedes it.
 *
 * So the number is a function of position within its own chapter. Two consequences
 * worth stating: moving a section between chapters renumbers both automatically, and
 * a section that is not a numbered step simply is not listed here.
 *
 * Not every chapter-owned anchor is a step. `signal-validation` (build) and
 * `track-record` / `corrections` (evidence) are rendered by their own components with
 * their own headers, carry no step number today, and are deliberately absent — listing
 * them here would number a heading that has nowhere to show it.
 */
export const CHAPTER_STEPS: Record<MethodChapter, readonly MethodAnchor[]> = {
  build: ["hypescore", "tradescore", "edgescore", "factors"],
  evidence: ["pipeline", "sources", "guardrails"],
};

/**
 * The step number rendered beside a section heading: 1-based within its chapter,
 * zero-padded to two digits. Returns null for a section that is not a numbered step,
 * so the caller renders no number rather than an empty slot.
 */
export function stepNumber(chapter: MethodChapter, id: string): string | null {
  const i = CHAPTER_STEPS[chapter].indexOf(id as MethodAnchor);
  return i < 0 ? null : String(i + 1).padStart(2, "0");
}

/** Section nav items per chapter. Labels are nouns, never figures — see
 *  SectionNav, which is tested for the absence of digits. */
export const CHAPTER_NAV: Record<MethodChapter, Array<{ id: string; label: string }>> = {
  build: [
    { id: "hypescore", label: "HypeScore" },
    { id: "tradescore", label: "TradeScore" },
    { id: "edgescore", label: "EdgeScore" },
    { id: "factors", label: "Factors" },
  ],
  evidence: [
    { id: "pipeline", label: "Pipeline" },
    { id: "sources", label: "Sources" },
    { id: "guardrails", label: "Guardrails" },
    { id: "track-record", label: "Track record" },
    { id: "corrections", label: "Corrections" },
  ],
};
