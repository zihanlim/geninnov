import { describe, it, expect } from "vitest";
import { assessStaleness, businessDaysBetween } from "@/lib/freshness";

const d = (s: string) => new Date(`${s}T12:00:00Z`);

describe("book staleness", () => {
  it("does not cry wolf on a normal weekday morning", () => {
    // The pipeline runs AFTER the close, so the newest book on any weekday morning
    // is legitimately yesterday's. Flagging at 1 business day would fire daily, and
    // a warning that is always on is a warning nobody reads.
    // Thu 2026-07-23 book, read Fri 2026-07-24.
    expect(assessStaleness("2026-07-23", d("2026-07-24")).stale).toBe(false);
  });

  it("does not cry wolf over a weekend", () => {
    // Friday's book read on Sunday is TWO CALENDAR days old and perfectly current —
    // which is exactly why calendar days are the wrong unit.
    expect(assessStaleness("2026-07-24", d("2026-07-26")).stale).toBe(false); // Fri -> Sun
    expect(businessDaysBetween(d("2026-07-24"), d("2026-07-26"))).toBe(0);
  });

  it("flags a book once runs have genuinely been missed", () => {
    // Wed book read Friday: two weekday runs should have happened and did not.
    const s = assessStaleness("2026-07-22", d("2026-07-24"));
    expect(s.stale).toBe(true);
    expect(s.businessDays).toBe(2);
    expect(s.message).toContain("not today's positions");
    expect(s.message).toContain("2026-07-22");
  });

  it("counts across a weekend without inflating", () => {
    // Fri 07-24 -> Tue 07-28 is 2 business days (Mon, Tue), not 4 calendar days.
    expect(businessDaysBetween(d("2026-07-24"), d("2026-07-28"))).toBe(2);
  });

  it("says nothing when there is no run date to judge", () => {
    // A missing date is a different problem, surfaced elsewhere. Inventing a
    // staleness warning from it would be a fabricated claim.
    expect(assessStaleness(null, d("2026-07-24")).stale).toBe(false);
    expect(assessStaleness("not-a-date", d("2026-07-24")).stale).toBe(false);
  });

  it("is current for today's run", () => {
    expect(assessStaleness("2026-07-24", d("2026-07-24"))).toEqual({
      businessDays: 0,
      stale: false,
      message: null,
    });
  });
});
