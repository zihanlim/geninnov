// frontend/tests/unit/next-run.test.ts
//
// The next fire of the daily-refresh cron, as shown in the TopBar's
// run-state chip. The point of `nextRunUtc` is that "next run" is a DATE,
// not a time of day: the pipeline is `30 21 * * 1-5` UTC, and a viewer in a
// DST zone needs the actual weekday because 21:30 UTC is 17:30 ET in summer
// but 16:30 in winter. The tests pin the weekday selection and the
// 21:30-UTC wall-clock, so the local anchor the chip shows cannot silently
// drift into a different day or hour.

import { describe, expect, it } from "vitest";
import { nextRunUtc } from "@/components/TopBar";

describe("nextRunUtc", () => {
  it("returns the same weekday's 21:30 UTC when later today (weekday)", () => {
    // 2026-07-30 is a Thursday, 13:00 UTC. The cron fires today at 21:30 UTC.
    const r = nextRunUtc(new Date("2026-07-30T13:00:00Z"));
    expect(r.toISOString()).toBe("2026-07-30T21:30:00.000Z");
  });

  it("skips a same-day fire that has already passed", () => {
    // 2026-07-30 Thursday, 23:00 UTC — 21:30 has passed, so the next fire is
    // Friday 2026-07-31 at 21:30 UTC.
    const r = nextRunUtc(new Date("2026-07-30T23:00:00Z"));
    expect(r.toISOString()).toBe("2026-07-31T21:30:00.000Z");
  });

  it("fires today's weekday slot when the day has not passed", () => {
    // 2026-07-31 is Friday, 09:00 UTC — today's fire is still ahead, so the
    // next fire is TODAY 21:30 UTC, not the weekend or Monday.
    const r = nextRunUtc(new Date("2026-07-31T09:00:00Z"));
    expect(r.toISOString()).toBe("2026-07-31T21:30:00.000Z");
  });

  it("skips the weekend when run ON a weekend (Sat/Sun → Monday)", () => {
    // 2026-08-01 is Saturday. The next fire is Monday 2026-08-03.
    expect(nextRunUtc(new Date("2026-08-01T00:30:00Z")).toISOString()).toBe(
      "2026-08-03T21:30:00.000Z",
    );
    // 2026-08-02 is Sunday.
    expect(nextRunUtc(new Date("2026-08-02T12:00:00Z")).toISOString()).toBe(
      "2026-08-03T21:30:00.000Z",
    );
  });

  it("prefers a weekday fire to the weekend for a run late Friday", () => {
    // Friday 2026-07-31, 23:00 UTC — today's fire has passed, weekend is
    // skipped, so Monday 2026-08-03 21:30 UTC.
    const r = nextRunUtc(new Date("2026-07-31T23:00:00Z"));
    expect(r.toISOString()).toBe("2026-08-03T21:30:00.000Z");
  });

  it("fires at exactly 21:30:00 UTC on the target day", () => {
    // The wall-clock the chip anchors on — must stay 21:30, not drift to
    // midnight or local noon.
    const r = nextRunUtc(new Date("2026-07-27T08:00:00Z")); // Monday
    expect(r.getUTCHours()).toBe(21);
    expect(r.getUTCMinutes()).toBe(30);
    expect(r.getUTCSeconds()).toBe(0);
    expect(r.getUTCDay()).not.toBe(0);
    expect(r.getUTCDay()).not.toBe(6);
  });
});
