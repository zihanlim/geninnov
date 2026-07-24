import { describe, it, expect } from "vitest";
import { bookAssetsFromPicks } from "@/lib/bookPicks";
import { reconcileToBook } from "@/lib/risk/bookOfRecord";

describe("bookAssetsFromPicks", () => {
  it("extracts distinct assets from a jsonb picks array", () => {
    const picks = [
      { asset: "SHY", direction: "long" },
      { asset: "BABA", direction: "short" },
    ];
    expect(bookAssetsFromPicks(picks)).toEqual(["SHY", "BABA"]);
  });

  it("parses the string form of the column", () => {
    expect(bookAssetsFromPicks('[{"asset":"XLE"},{"asset":"NOC"}]')).toEqual(["XLE", "NOC"]);
  });

  it("drops blanks and returns null for unusable input", () => {
    expect(bookAssetsFromPicks([{ asset: "XLE" }, { direction: "long" }])).toEqual(["XLE"]);
    expect(bookAssetsFromPicks("not json")).toBeNull();
    expect(bookAssetsFromPicks(null)).toBeNull();
    expect(bookAssetsFromPicks(42)).toBeNull();
  });
});

describe('"Held tickers" reflects the published book, not the provisional pool', () => {
  it("reports the book count and flags the divergence mid-reconcile", () => {
    // The live 2026-07-25 shape: portfolio_positions carries L1's 40-name pool while
    // the published book holds 9. "Held tickers" must read 9 (matching /book) and
    // disclose the 40, not silently show 40.
    const positions = Array.from({ length: 40 }, (_, i) => `A${i}`);
    const book = positions.slice(0, 9);
    const r = reconcileToBook(positions, book);
    expect(r.bookCount).toBe(9);
    expect(r.positionCount).toBe(40);
    expect(r.reconciled).toBe(false);
  });

  it("is reconciled once the pipeline narrows positions to the picks", () => {
    const book = ["SHY", "XLE", "NUE", "OIH", "SVXY", "PDD", "BABA", "SLV", "NOC"];
    const r = reconcileToBook(book, book);
    expect(r.reconciled).toBe(true);
    expect(r.bookCount).toBe(9);
    expect(r.positionCount).toBe(9);
  });
});
