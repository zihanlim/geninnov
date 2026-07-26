// The pipeline health ladder, now that two surfaces read it.
//
// It moved out of LiveFeed.tsx when /ask started asking the same question. The
// reason it needs a test at the moment it becomes shared is the failure this
// repo has already had once: the status ribbon reported "4/4 succeeded" while
// /method said "last success: never" for two stages, because the denominator
// lived in one component and the truth lived in another. A shared module with no
// test is the same bug with a longer fuse.

import { describe, expect, it } from "vitest";
import { assessPipeline, EXPECTED_STAGES } from "@/lib/pipelineHealth";

const run = (stage: string, status = "success", run_date = "2026-07-25") => ({
  run_date,
  stage,
  status,
  finished_at: null,
  duration_s: 1,
});

const all = (status = "success") => EXPECTED_STAGES.map((s) => run(s, status));

describe("assessPipeline", () => {
  it("counts against every stage that EXISTS, not every stage that reports", () => {
    expect(EXPECTED_STAGES).toEqual(["L0", "L1", "L2", "L3", "L4", "L5"]);
    const a = assessPipeline(all());
    expect(a.health).toBe("healthy");
    expect(a.detail).toBe("6/6 succeeded");
  });

  it("calls a missing stage degraded and names it", () => {
    const a = assessPipeline(all().filter((r) => r.stage !== "L4"));
    expect(a.health).toBe("degraded");
    expect(a.missing).toEqual(["L4"]);
    expect(a.detail).toContain("L4 did not run");
  });

  it("ranks a failure above a gap", () => {
    // A stage that ran and failed is a louder fact than one that never started,
    // so a run with both reports as failed.
    const runs = all().filter((r) => r.stage !== "L4");
    runs[0] = run("L0", "failure");
    const a = assessPipeline(runs);
    expect(a.health).toBe("failed");
    expect(a.failed).toEqual(["L0"]);
  });

  it("treats partial as degraded, not as success", () => {
    const runs = all();
    runs[5] = run("L5", "partial");
    const a = assessPipeline(runs);
    expect(a.health).toBe("degraded");
    expect(a.detail).toContain("L5 incomplete");
  });

  it("measures only the latest run_date", () => {
    // Yesterday's complete run must not paper over today's partial one.
    const a = assessPipeline([run("L0", "success", "2026-07-25"), ...all("success").map((r) => ({ ...r, run_date: "2026-07-24" }))]);
    expect(a.latestDate).toBe("2026-07-25");
    expect(a.missing).toEqual(["L1", "L2", "L3", "L4", "L5"]);
  });

  it("separates 'nothing recorded' from 'nothing succeeded'", () => {
    const a = assessPipeline([]);
    expect(a.health).toBe("unknown");
    expect(a.label).toMatch(/No pipeline runs recorded/);
  });
});
