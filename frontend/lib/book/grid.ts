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
 * Shared column template for the /book position rows AND their legend header.
 * Both must use this — `tests/unit/book-row-grid.test.ts` fails if either
 * reintroduces an inline template.
 */
export const BOOK_ROW_GRID =
  "grid-cols-[28px_1fr_132px_78px_78px_78px_24px]";

/** The minimum width the seven columns need before they start colliding; the row
 *  lives inside a horizontal ScrollArea below this. */
export const BOOK_ROW_MIN_W = "min-w-[640px]";
