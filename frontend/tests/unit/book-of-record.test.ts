import { describe, it, expect } from "vitest";
import { reconcileToBook } from "@/lib/risk/bookOfRecord";

/**
 * ADR-0040 made the published book the book of record. The invariant holds once a
 * run finishes and breaks in the middle of one — caught live on 2026-07-25 with
 * /risk reporting "39 positions" and HHI 138 while the book held 8.
 */
describe("book-of-record reconciliation", () => {
  it("passes when the positions are exactly the published names", () => {
    const r = reconcileToBook(["UNH", "BIL", "GLD"], ["GLD", "UNH", "BIL"]);
    expect(r.reconciled).toBe(true);
    expect(r.extra).toEqual([]);
    expect(r.positionCount).toBe(3);
    expect(r.bookCount).toBe(3);
  });

  it("catches the provisional window — L1's full candidate set", () => {
    // The live shape: 39 sized candidates against an 8-name published book.
    const positions = Array.from({ length: 39 }, (_, i) => `T${i}`);
    const book = positions.slice(0, 8);
    const r = reconcileToBook(positions, book);
    expect(r.reconciled).toBe(false);
    expect(r.positionCount).toBe(39);
    expect(r.bookCount).toBe(8);
    expect(r.extra).toHaveLength(31);
  });

  it("catches a published name missing from the positions table", () => {
    // The other direction: reconciliation ran but dropped a pick.
    const r = reconcileToBook(["UNH"], ["UNH", "BIL"]);
    expect(r.reconciled).toBe(false);
    expect(r.extra).toEqual([]);
  });

  it("does not flag a run that has no published book yet", () => {
    // Nothing to disagree with. Calling this unreconciled would mark a first-ever
    // run as broken.
    const r = reconcileToBook(["UNH", "BIL"], null);
    expect(r.reconciled).toBe(true);
    expect(r.bookMissing).toBe(true);
    expect(r.bookCount).toBe(0);
  });

  it("treats an empty published book as a real disagreement, not a missing one", () => {
    const r = reconcileToBook(["UNH"], []);
    expect(r.bookMissing).toBe(false);
    expect(r.reconciled).toBe(false);
  });

  it("is not fooled by duplicate rows on either side", () => {
    const r = reconcileToBook(["UNH", "UNH", "BIL"], ["BIL", "UNH"]);
    expect(r.reconciled).toBe(true);
    expect(r.positionCount).toBe(2);
  });

  it("lists the extra names sorted, so the banner is stable between renders", () => {
    const r = reconcileToBook(["SLV", "AGG", "UNH"], ["UNH"]);
    expect(r.extra).toEqual(["AGG", "SLV"]);
  });
});
