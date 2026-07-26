// frontend/lib/pipelineHealth.ts
//
// "Did the pipeline actually run?" — one implementation, two readers.
//
// This logic lived inside LiveFeed.tsx, which was fine while the status ribbon
// was the only thing that asked. /ask now asks the same question on a reader's
// behalf, and two copies of it is how the ribbon comes to say "6/6 succeeded"
// while the chat says a stage is missing. That exact class of contradiction is
// already recorded in this repo: the bar counted 4/4 while /method said "last
// success: never" for two stages, because two surfaces disagreed about the
// denominator.
//
// So the denominator, the health ladder, and the wording all live here.

export interface PipelineRun {
  run_date: string;
  stage: string;
  status: string;
  finished_at: string | null;
  duration_s: number | null;
}

// The stages daily_refresh.py records. A stage absent from the latest run_date
// did not run — which is information, not an error.
//
// This list held only L0/L2/L3/L5 because L1 and L4 never called
// record_pipeline_run(). The bar therefore read "All stages complete · 4/4
// succeeded" while /method, on the same screen, said of both missing stages
// "Last success: never" — 4/4 was counting the stages that report, not the
// stages that exist. Both are instrumented now, so the denominator is real.
export const EXPECTED_STAGES = ["L0", "L1", "L2", "L3", "L4", "L5"];

export type Health = "healthy" | "degraded" | "failed" | "unknown";

export interface PipelineAssessment {
  health: Health;
  label: string;
  detail: string;
  /** Stages that recorded a row on the latest run_date. */
  ran: string[];
  /** Expected stages with no row on the latest run_date. */
  missing: string[];
  /** Stages that recorded `failure`. */
  failed: string[];
  /** Stages that recorded `partial`. */
  partial: string[];
  /** The run_date everything above is measured on. */
  latestDate: string | null;
}

export function assessPipeline(runs: PipelineRun[]): PipelineAssessment {
  const empty = { ran: [], missing: [], failed: [], partial: [], latestDate: null };
  if (!runs || runs.length === 0) {
    return {
      ...empty,
      health: "unknown",
      label: "No pipeline runs recorded",
      detail: "pipeline_runs is empty",
    };
  }
  const latestDate = runs[0].run_date;
  const today = runs.filter((r) => r.run_date === latestDate);
  const byStage = new Map(today.map((r) => [r.stage, r]));

  const ran = EXPECTED_STAGES.filter((s) => byStage.has(s));
  const missing = EXPECTED_STAGES.filter((s) => !byStage.has(s));
  const failed = ran.filter((s) => byStage.get(s)!.status === "failure");
  const partial = ran.filter((s) => byStage.get(s)!.status === "partial");
  const base = { ran, missing, failed, partial, latestDate };

  if (failed.length > 0) {
    return {
      ...base,
      health: "failed",
      label: `${failed.length} stage${failed.length === 1 ? "" : "s"} failed`,
      detail: `Failed: ${failed.join(", ")}`,
    };
  }
  if (missing.length > 0 || partial.length > 0) {
    const bits: string[] = [];
    if (missing.length) bits.push(`${missing.join(", ")} did not run`);
    if (partial.length) bits.push(`${partial.join(", ")} incomplete`);
    return {
      ...base,
      health: "degraded",
      label: `${ran.length}/${EXPECTED_STAGES.length} stages recorded`,
      detail: bits.join(" · "),
    };
  }
  return {
    ...base,
    health: "healthy",
    label: "All stages complete",
    detail: `${ran.length}/${EXPECTED_STAGES.length} succeeded`,
  };
}
