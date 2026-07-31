// frontend/lib/book/lensView.ts — the pure resolution logic behind /book's
// lens toggle, tested against fixed (run_date, lens) row arrays rather than a
// live Supabase call. Same separation as lib/turnover.ts and
// lib/book/positionEdge.ts: the query is a thin wrapper BookBody.tsx owns,
// the DECISION is a pure function tested here.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_LENS,
  availableLensesForLatestRun,
  isLens,
  resolveLens,
} from "@/lib/book/lensView";

describe("isLens", () => {
  it("accepts every real lens value", () => {
    for (const l of ["multi_asset", "credit", "rates", "equity", "fx", "commodity"]) {
      expect(isLens(l)).toBe(true);
    }
  });

  it("rejects an unrecognised string, null and undefined", () => {
    expect(isLens("nonsense")).toBe(false);
    expect(isLens("")).toBe(false);
    expect(isLens(null)).toBe(false);
    expect(isLens(undefined)).toBe(false);
  });
});

describe("availableLensesForLatestRun", () => {
  it("collects the distinct lenses published on the newest run_date only", () => {
    const rows = [
      { run_date: "2026-07-30", lens: "credit" },
      { run_date: "2026-07-30", lens: "multi_asset" },
      // An older date carrying a THIRD lens must not leak into today's offer —
      // that lens has no book today, whatever it had yesterday.
      { run_date: "2026-07-29", lens: "rates" },
      { run_date: "2026-07-29", lens: "multi_asset" },
    ];
    const { runDate, lenses } = availableLensesForLatestRun(rows);
    expect(runDate).toBe("2026-07-30");
    expect(lenses.sort()).toEqual(["credit", "multi_asset"]);
  });

  it("treats a NULL lens as multi_asset (pre-migration-062 rows)", () => {
    const { lenses } = availableLensesForLatestRun([
      { run_date: "2026-07-22", lens: null },
    ]);
    expect(lenses).toEqual(["multi_asset"]);
  });

  it("returns no run date and no lenses when there are no rows at all", () => {
    expect(availableLensesForLatestRun([])).toEqual({ runDate: null, lenses: [] });
  });

  it("does not assume rows are sorted — it trusts the caller's ORDER BY for 'latest'", () => {
    // The FIRST row with a run_date is "latest" here, by contract: the caller is
    // expected to have queried `.order("run_date", { ascending: false })`. This
    // pins that contract rather than re-sorting defensively, which would hide a
    // caller that forgot the ORDER BY instead of surfacing it as a wrong answer.
    const rows = [
      { run_date: "2026-07-25", lens: "multi_asset" },
      { run_date: "2026-07-30", lens: "credit" },
    ];
    expect(availableLensesForLatestRun(rows).runDate).toBe("2026-07-25");
  });
});

describe("resolveLens", () => {
  const bothLenses = ["multi_asset", "credit"] as const;

  it("honours a requested lens that has a published book today", () => {
    expect(resolveLens("credit", [...bothLenses])).toBe("credit");
  });

  it("falls back to multi_asset when nothing was requested", () => {
    expect(resolveLens(null, [...bothLenses])).toBe(DEFAULT_LENS);
    expect(resolveLens(undefined, [...bothLenses])).toBe(DEFAULT_LENS);
  });

  it("falls back to multi_asset for an unrecognised value — never errors, never an empty book", () => {
    expect(resolveLens("nonsense", [...bothLenses])).toBe(DEFAULT_LENS);
  });

  it("falls back to multi_asset for a REAL lens with no book published today", () => {
    // "rates" is a real value in the Lens union (ADR-0015's asset-class set) but
    // has no published book today — the same failure mode as an unrecognised
    // string, and it must resolve identically rather than requesting a lens
    // whose query will come back empty with no explanation.
    expect(resolveLens("rates", [...bothLenses])).toBe(DEFAULT_LENS);
  });

  it("still resolves to multi_asset if it is somehow the only lens NOT offered", () => {
    // Defensive: if multi_asset itself were ever absent from `available` (should
    // not happen — every run publishes it), the fallback must still be a value
    // callers can query, not `available[0]` or a crash.
    expect(resolveLens("credit", ["credit"])).toBe("credit");
    expect(resolveLens(null, ["credit"])).toBe(DEFAULT_LENS);
  });
});
