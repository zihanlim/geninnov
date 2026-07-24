import { describe, it, expect } from "vitest";
import { resolveRunDates, ageSeconds } from "@/lib/homeFreshness";

describe("landing-page run date", () => {
  it("displays the canonical run_date, not the write timestamp", () => {
    // The live 2026-07-25 shape: themes.updated_at lagged a day behind the run_date
    // its own hype scores belong to.
    const r = resolveRunDates({
      pipeRunDate: "2026-07-25",
      pipeFinishedAt: "2026-07-24T20:13:45Z",
      themeUpdatedAt: "2026-07-24T20:13:41Z",
    });
    expect(r.display).toBe("2026-07-25"); // not 2026-07-24
  });

  it("falls back to the theme timestamp only when pipeline_runs is unread", () => {
    expect(resolveRunDates({ themeUpdatedAt: "2026-07-24T20:13:41Z" }).display).toBe(
      "2026-07-24T20:13:41Z",
    );
    expect(resolveRunDates({}).display).toBeNull();
  });

  it("measures freshness from the finish timestamp, never the run_date", () => {
    const r = resolveRunDates({
      pipeRunDate: "2026-07-25",
      pipeFinishedAt: "2026-07-24T20:13:45Z",
    });
    expect(r.freshnessTs).toBe("2026-07-24T20:13:45Z");
  });

  it("does not clamp age to zero on a forward-dated run_date", () => {
    // The pitfall: measuring age from the run_date "2026-07-25" while the wall clock
    // reads 20:13Z on 07-24 yields a future timestamp -> negative -> clamped to 0
    // ("just now") over data hours old. Freshness must come from finished_at.
    const now = Date.parse("2026-07-24T20:21:45Z"); // 8 min after finish
    const r = resolveRunDates({
      pipeRunDate: "2026-07-25",
      pipeFinishedAt: "2026-07-24T20:13:45Z",
    });
    expect(ageSeconds(r.freshnessTs, now)).toBe(480); // 8 minutes, not 0
    // And the trap it avoids: age off the run_date would clamp to 0.
    expect(ageSeconds("2026-07-25", now)).toBe(0);
  });

  it("reports Infinity age when there is no timestamp", () => {
    expect(ageSeconds(null, Date.now())).toBe(Number.POSITIVE_INFINITY);
  });
});
