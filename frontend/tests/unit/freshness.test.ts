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

  it("invents no staleness count when there is no run date to judge", () => {
    // Preserved from the original: a business-day count we cannot compute must not be
    // asserted, so `stale` stays false and `businessDays` stays 0.
    expect(assessStaleness(null, d("2026-07-24")).stale).toBe(false);
    expect(assessStaleness("not-a-date", d("2026-07-24")).stale).toBe(false);
    expect(assessStaleness(null, d("2026-07-24")).businessDays).toBe(0);
  });

  it("distinguishes 'we could not judge it' from 'it is current'", () => {
    // The gap this closes: `stale === false` covered both, so a record with a null
    // run_date rendered with no freshness signal at all — which reads as currency to
    // anyone scanning a $100M book. `stale: false` is itself a claim ("no run was
    // missed") and there is no basis for it either.
    const unknown = assessStaleness(null, d("2026-07-24"));
    const current = assessStaleness("2026-07-24", d("2026-07-24"));

    expect(unknown.stale).toBe(current.stale); // both false — hence the old ambiguity
    expect(unknown.verdict).toBe("unjudgeable");
    expect(current.verdict).toBe("current");
  });

  it("states a cause whenever it cannot judge, and none when it can", () => {
    // Same rule as pick_outcomes.void_reason (ADR-0090): an absence with no stated cause
    // is the shape that lets a gap pass for a pass.
    expect(assessStaleness(null, d("2026-07-24")).unjudgeableReason).toMatch(/no run date/i);
    expect(assessStaleness("not-a-date", d("2026-07-24")).unjudgeableReason).toMatch(
      /not a date/i,
    );
    expect(assessStaleness("2026-07-24", d("2026-07-24")).unjudgeableReason).toBeNull();
    expect(assessStaleness("2026-07-22", d("2026-07-24")).unjudgeableReason).toBeNull();
  });

  it("names the offending value in the reason, so it can be chased", () => {
    expect(assessStaleness("2026-13-99", d("2026-07-24")).unjudgeableReason).toContain(
      "2026-13-99",
    );
  });

  it("treats a value Date parses as judgeable, however loosely it parsed", () => {
    // `new Date("13 JulyT00:00:00Z")` yields 2001-07-13 — Date is lenient, so a malformed
    // run date can land in the distant past rather than as Invalid. That reads as
    // enormously stale, not as unjudgeable, and stale is the safer of the two readings:
    // it shows a warning either way. Pinned so nobody "fixes" it into a silent pass.
    const s = assessStaleness("13 July", d("2026-07-24"));
    expect(s.verdict).toBe("stale");
    expect(s.businessDays).toBeGreaterThan(1000);
  });

  it("is current for today's run", () => {
    expect(assessStaleness("2026-07-24", d("2026-07-24"))).toEqual({
      businessDays: 0,
      stale: false,
      message: null,
      verdict: "current",
      unjudgeableReason: null,
    });
  });

  it("marks a genuinely stale book stale, with a message", () => {
    const s = assessStaleness("2026-07-22", d("2026-07-24"));
    expect(s.verdict).toBe("stale");
    expect(s.stale).toBe(true);
    expect(s.message).toBeTruthy();
  });
});
