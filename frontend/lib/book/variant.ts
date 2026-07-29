// frontend/lib/book/variant.ts
//
// Which layout the book draws.
//
// TEMPORARY, and deliberately its own module. `BookBody` imports `PositionRow`, so a
// type declared in `BookBody` and imported by `PositionRow` would be a cycle. It sits
// here instead, where both can reach it and neither depends on the other.
//
// `next` is the `/book2` comparison surface for the layout ideas adopted from the
// Stitch "Systematic Alabaster" archive. When the comparison is decided, this file,
// the `/book2` route, and every `variant === "next"` branch are removed together.

export type BookVariant = "current" | "next";

/** True when rendering the comparison layout. Reads better at a call site than `=== "next"`. */
export const isNext = (v: BookVariant | undefined): boolean => v === "next";
