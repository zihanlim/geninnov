// frontend/lib/book/grid.ts
//
// The book row's column template, defined once.
//
// It was an inline `style={{ gridTemplateColumns: "..." }}` duplicated in two
// places — the legend header in app/book/page.tsx and the row itself in
// components/book/PositionRow.tsx. Two copies of a seven-column template that
// must agree exactly, with nothing connecting them: edit one and the header
// silently stops lining up with the numbers underneath it.
//
// Why an arbitrary-value utility rather than the 12-column grid this was first
// scoped as: a 12-col grid divides the row into twelfths, which at the page's
// 1320px max width is ~110px per column. Two of these columns are deliberately
// ~25px (the rank gutter and the disclosure caret) and one must absorb all
// remaining space (`1fr`). Equal fractions cannot express either, so a 12-col
// conversion would not be a refactor — it would be a different, worse layout.
// What the inline style actually needed was a name and a single home.
//
// Tailwind compiles this because `lib/**` is in the content globs (see
// tailwind.config.ts). Before that glob existed, a class defined here would have
// silently failed to compile.

/** What each column carries, in order. Keep in step with BOOK_ROW_GRID. */
export const BOOK_ROW_COLUMNS = [
  "rank",
  "asset · theme · rationale",
  "weight · notional",
  "EdgeScore",
  "conviction",
  "cap utilisation",
  "disclosure caret",
] as const;

/**
 * What each figure column is measured OVER, rendered as a second header line.
 *
 * The legend used to be six bare words. `Conv.` was a ratio with an undisclosed
 * denominator and `Cap` was headroom against an unstated limit, over the densest
 * table the app ships — a reader could not answer "per cent of what?" without
 * leaving the page for /method. Goal 1's test is whether a number's origin can be
 * found without asking, and always-visible beats a hover the keyboard cannot reach.
 *
 * Empty string = no scope line (the rank gutter, the descriptive column and the
 * caret are not figures and inventing a caption for them is noise). Kept here
 * rather than inline for the same reason BOOK_ROW_GRID is: the header and the row
 * must agree, and copy that lives in the markup drifts from the column it labels.
 *
 * ASCII only, deliberately. This file's strings are re-encoded on some saves in
 * this environment; `/` survives where a division sign has not.
 */
/* Kept SHORT on purpose. These sit in 78px columns, and the first draft
   ("OF $100M, THIS RUN", "SIGNED, THIS RUN") wrapped to three lines and pushed
   the figures down. The per-run scoping is already carried twice on the page —
   the RUN DATE stamp in the header and the ProvenanceStrip under the table — so
   repeating "THIS RUN" on all four columns bought nothing and cost the layout. */
export const BOOK_ROW_SCOPES = [
  "",
  "",
  "OF $100M",
  "SIGNED",
  "|EDGE| / VOL",
  "HEADROOM",
  "",
] as const;

/**
 * Shared column template for the /book position rows AND their legend header.
 * Both must use this — `tests/unit/book-row-grid.test.ts` fails if either
 * reintroduces an inline template.
 */
export const BOOK_ROW_GRID =
  "grid-cols-[28px_1fr_132px_78px_78px_78px_24px]";

/** The minimum width the seven columns need before they start colliding; the row
 *  lives inside a horizontal ScrollArea below this. */
export const BOOK_ROW_MIN_W = "min-w-[640px]";
