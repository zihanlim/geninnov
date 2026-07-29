// The book row's columns are defined once.
//
// The legend header (components/book/BookBody.tsx) and the rows beneath it
// (components/book/PositionRow.tsx) must use the same seven-column template or
// the headings stop lining up with the numbers they name. They used to hold two
// copies of an inline `style={{ gridTemplateColumns: "..." }}` with nothing
// connecting them, which is a silent-misalignment bug waiting for whoever edits
// one and not the other.
//
// Both now read lib/book/grid.ts. These tests fail if either reintroduces an
// inline template, and if the documented column list stops matching the template
// it documents.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  BOOK_ROW_COLUMNS,
  BOOK_ROW_GRID,
  BOOK_ROW_MIN_W,
} from "@/lib/book/grid";

const ROOT = path.resolve(__dirname, "../..");
// BookBody, not app/book/page.tsx: the body moved out of the route file so that
// /book and /book2 could share one fetch. A route module may only export `default`.
const CONSUMERS = ["components/book/PositionRow.tsx", "components/book/BookBody.tsx"];
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/** "grid-cols-[a_b_c]" -> ["a","b","c"] */
function templateColumns(cls: string): string[] {
  const inner = cls.match(/^grid-cols-\[(.+)\]$/);
  if (!inner) throw new Error(`not an arbitrary grid-cols utility: "${cls}"`);
  return inner[1].split("_");
}

describe("book row grid", () => {
  it("is a Tailwind utility, not an inline style", () => {
    // An inline style cannot be shared, so it was the reason there were two
    // copies. It also cannot be seen by the class-based tests above it.
    expect(BOOK_ROW_GRID).toMatch(/^grid-cols-\[/);
  });

  it("declares exactly as many columns as it documents", () => {
    // BOOK_ROW_COLUMNS is what a reader of lib/book/grid.ts is told the row
    // carries. If the template grows a column and the list does not, the next
    // person to touch this is working from a stale map.
    expect(templateColumns(BOOK_ROW_GRID)).toHaveLength(BOOK_ROW_COLUMNS.length);
  });

  it("keeps the rank and caret columns narrow and the name column flexible", () => {
    // The reason this is not the 12-column grid it was first scoped as: equal
    // twelfths are ~110px at the page's max width, which can express neither a
    // ~25px gutter nor "absorb the remainder".
    const cols = templateColumns(BOOK_ROW_GRID);
    expect(cols[0]).toBe("28px");
    expect(cols[cols.length - 1]).toBe("24px");
    expect(cols).toContain("1fr");
    expect(cols.filter((c) => c === "1fr")).toHaveLength(1);
  });

  it.each(CONSUMERS)("%s carries no inline column template", (rel) => {
    expect(read(rel)).not.toContain("gridTemplateColumns");
  });

  it.each(CONSUMERS)("%s reads the shared template", (rel) => {
    const src = read(rel);
    expect(src).toContain("BOOK_ROW_GRID");
    expect(src).toContain("BOOK_ROW_MIN_W");
    expect(src).toContain('from "@/lib/book/grid"');
  });

  it("keeps the row scrollable rather than letting columns collide", () => {
    expect(BOOK_ROW_MIN_W).toMatch(/^min-w-\[\d+px\]$/);
  });
});
