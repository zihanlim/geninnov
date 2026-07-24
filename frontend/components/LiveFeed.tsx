"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { assessStaleness } from "@/lib/freshness";

/**
 * Always-visible pipeline status bar.
 *
 * This previously hardcoded "Pipeline healthy" with a pulsing green dot and a
 * literal "Next refresh: 2026-07-22 16:30 ET" — a status claim no code checked
 * and a date that silently went stale. It sat on every page while the pipeline
 * was in fact recording `partial` stages with no finish time and only two of six
 * stages running.
 *
 * It now reads `pipeline_runs` and reports what actually happened.
 */

interface PipelineRun {
  run_date: string;
  stage: string;
  status: string;
  finished_at: string | null;
  duration_s: number | null;
}

// The stages daily_refresh.py records. A stage absent from the latest run_date
// did not run — which is information, not an error in this component.
//
// This list held only L0/L2/L3/L5 because L1 and L4 never called
// record_pipeline_run(). The bar therefore read "All stages complete · 4/4
// succeeded" while /method, on the same screen, said of both missing stages
// "Last success: never" — 4/4 was counting the stages that report, not the stages
// that exist. Both are instrumented now, so the denominator is the real one.
const EXPECTED_STAGES = ["L0", "L1", "L2", "L3", "L4", "L5"];

type Health = "healthy" | "degraded" | "failed" | "unknown";

function assess(runs: PipelineRun[]): {
  health: Health;
  label: string;
  detail: string;
} {
  if (runs.length === 0) {
    return {
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

  if (failed.length > 0) {
    return {
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
      health: "degraded",
      label: `${ran.length}/${EXPECTED_STAGES.length} stages recorded`,
      detail: bits.join(" · "),
    };
  }
  return {
    health: "healthy",
    label: "All stages complete",
    detail: `${ran.length}/${EXPECTED_STAGES.length} succeeded`,
  };
}

const DOT: Record<Health, string> = {
  healthy: "var(--long)",
  degraded: "var(--warning)",
  failed: "var(--short)",
  unknown: "var(--text-tertiary)",
};

export default function LiveFeed() {
  const [runs, setRuns] = useState<PipelineRun[] | null>(null);
  const [themes, setThemes] = useState<number | null>(null);
  const [tickers, setTickers] = useState<number | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    Promise.all([
      supabase
        .from("pipeline_runs")
        .select("run_date, stage, status, finished_at, duration_s")
        .order("run_date", { ascending: false })
        .limit(40),
      supabase.from("themes").select("id", { count: "exact", head: true }),
      supabase.from("portfolio_positions").select("asset"),
    ]).then(([runRes, themeRes, posRes]) => {
      if (runRes.error) setUnavailable(true);
      else setRuns((runRes.data as PipelineRun[]) ?? []);
      setThemes(themeRes.count ?? null);
      setTickers(
        posRes.error
          ? null
          : new Set((posRes.data ?? []).map((r: { asset: string }) => r.asset))
              .size
      );
    });
  }, []);

  const fmtAgo = (iso: string | null) => {
    if (!iso) return "—";
    const diff = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(diff)) return "—";
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  const state =
    runs === null
      ? { health: "unknown" as Health, label: "Loading…", detail: "" }
      : assess(runs);
  const latest = runs?.[0];
  const lastFinish = runs?.find((r) => r.finished_at)?.finished_at ?? null;
  const staleness = assessStaleness(latest?.run_date);

  return (
    <div className="fixed bottom-0 inset-x-0 bg-bg-surface border-t border-border px-5 py-1.5 flex items-center gap-4 text-[11px] text-text-secondary z-40 overflow-x-auto scrollbar-none whitespace-nowrap">
      <span className="inline-flex items-center gap-1.5" title={state.detail}>
        <span
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{
            background: DOT[state.health],
            boxShadow: `0 0 6px ${DOT[state.health]}`,
          }}
        />
        {unavailable ? "Pipeline status unavailable" : state.label}
      </span>
      {state.detail && (
        <>
          <span className="text-text-tertiary">|</span>
          <span className="text-text-tertiary">{state.detail}</span>
        </>
      )}
      <span className="text-text-tertiary">|</span>
      <span>
        Last run{" "}
        {/* An age rendered in the same grey as "5 min ago" is not a warning. Once
            weekday runs have actually been missed, the date has to look wrong. */}
        <span
          className="num"
          style={staleness.stale ? { color: "var(--warning)", fontWeight: 600 } : undefined}
          title={staleness.message ?? undefined}
        >
          {latest?.run_date ?? "—"}
        </span>
        {lastFinish && (
          <span className="text-text-tertiary"> ({fmtAgo(lastFinish)})</span>
        )}
        {staleness.stale && (
          <span style={{ color: "var(--warning)" }}>
            {" "}· {staleness.businessDays} weekday runs missed
          </span>
        )}
      </span>
      <span className="text-text-tertiary">|</span>
      <span>
        Themes <span className="num">{themes ?? "—"}</span>
      </span>
      <span className="text-text-tertiary">|</span>
      <span>
        Held tickers <span className="num">{tickers ?? "—"}</span>
      </span>
      <Link
        href="/method"
        className="ml-auto text-text-tertiary hover:text-text-primary shrink-0"
      >
        Pipeline detail →
      </Link>
    </div>
  );
}
