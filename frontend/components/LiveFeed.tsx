"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { DEFAULT_LENS, isLens } from "@/lib/book/lensView";
import { assessStaleness } from "@/lib/freshness";
import {
  assessPipeline,
  type Health,
  type PipelineRun,
} from "@/lib/pipelineHealth";
import { reconcileToBook, type Reconciliation } from "@/lib/risk/bookOfRecord";
import { bookAssetsFromPicks } from "@/lib/bookPicks";

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

// The PipelineRun shape, the expected-stage list and the health ladder now live
// in lib/pipelineHealth.ts, because /ask asks the same question on a reader's
// behalf and two copies of this logic is how the ribbon and the chat come to
// disagree about whether the pipeline ran.

const DOT: Record<Health, string> = {
  healthy: "var(--long)",
  degraded: "var(--warning)",
  failed: "var(--short)",
  unknown: "var(--text-tertiary)",
};

export default function LiveFeed() {
  // The lens the URL is asserting, when it is a real one and not the default.
  // Null on every default-lens page, which is what keeps the qualifier below off
  // the default site entirely. See the note at its render.
  const lensParam = useSearchParams().get("lens");
  const otherBook =
    isLens(lensParam) && lensParam !== DEFAULT_LENS ? lensParam : null;

  const [runs, setRuns] = useState<PipelineRun[] | null>(null);
  const [themes, setThemes] = useState<number | null>(null);
  const [recon, setRecon] = useState<Reconciliation | null>(null);
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
      // The book of record is L5's published picks (ADR-0040), the same source
      // /book renders. "Held tickers" read portfolio_positions instead, which the
      // pipeline fills with L1's full candidate pool and only later reconciles down
      // to the picks — so mid-reconcile it showed "Held tickers 40" while /book held
      // 9. Count the published book, and disclose the positions divergence the way
      // /risk does rather than hide it (bookOfRecord.ts: the check is the disagreement).
      // Migration 062 keyed this table on (run_date, lens); the reconciliation
      // strip is about the published multi-asset book, so the read is explicit
      // rather than depending on whichever row Postgres returns first for a
      // run_date that now carries two books.
      supabase
        .from("research_recommendations")
        .select("picks")
        .eq("lens", "multi_asset")
        .order("run_date", { ascending: false })
        .limit(1),
    ]).then(([runRes, themeRes, posRes, bookRes]) => {
      if (runRes.error) setUnavailable(true);
      else setRuns((runRes.data as PipelineRun[]) ?? []);
      setThemes(themeRes.count ?? null);
      const positionAssets = posRes.error
        ? []
        : (posRes.data ?? []).map((r: { asset: string }) => r.asset);
      const bookAssets = bookRes.error
        ? null
        : bookAssetsFromPicks(bookRes.data?.[0]?.picks);
      setRecon(reconcileToBook(positionAssets, bookAssets));
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
      : assessPipeline(runs);
  const latest = runs?.[0];
  const lastFinish = runs?.find((r) => r.finished_at)?.finished_at ?? null;
  const staleness = assessStaleness(latest?.run_date);

  return (
    // min-h-[var(--feed-h)] is not cosmetic: --feed-h is what SideRail reserves
    // at its bottom so its collapse button is not painted under this bar. The
    // floor makes that reservation binding — the bar cannot render shorter than
    // the space held for it, and `whitespace-nowrap` stops it rendering taller.
    <div className="fixed bottom-0 inset-x-0 min-h-[var(--feed-h)] bg-bg-surface border-t border-border px-5 py-1.5 flex items-center gap-4 text-[11px] text-text-secondary z-40 overflow-x-auto scrollbar-none whitespace-nowrap">
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
          title={staleness.message ?? staleness.unjudgeableReason ?? undefined}
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
        {/* An em dash with no note reads as "nothing to report". Say the age is
            unmeasurable instead — the tooltip carries the cause. */}
        {staleness.verdict === "unjudgeable" && (
          <span className="text-text-tertiary">{" "}· age unknown</span>
        )}
      </span>
      <span className="text-text-tertiary">|</span>
      <span>
        Themes <span className="num">{themes ?? "—"}</span>
      </span>
      <span className="text-text-tertiary">|</span>
      <span>
        Held tickers{" "}
        <span className="num">
          {recon === null
            ? "—"
            : recon.bookMissing
              ? recon.positionCount
              : recon.bookCount}
        </span>
        {/* Which book that counts, but ONLY when a second one is on screen to
            confuse it with.

            This strip is global chrome: one instance in the root layout renders
            under every route, including `/book?lens=credit`, where the body shows
            3 positions and this said "Held tickers 9". A reader reconciles that as
            "the book holds 9 and I am being shown 3", or as a stale strip. Neither
            is true — the count is right, it is just the MULTI-ASSET book's, which
            the read above pins deliberately because this strip reports the nightly
            run and ADR-0194 makes the multi-asset book the record.

            Conditional rather than always-on, for the same reason `showScopeNote`
            is false at multi_asset (ADR-0197): under the default lens there is no
            second book, "the book" is unambiguous, and a qualifier on every page of
            the default site would be noise on the one view a submission is read
            from. `isLens` gates it so `?lens=garbage` — which every page resolves
            to the default book — does not claim a lens that published nothing. */}
        {otherBook && (
          <span
            className="text-text-tertiary"
            title={`This count is the multi-asset book's, on every page. It is read from research_recommendations at lens=multi_asset because this strip reports the nightly pipeline run, whose published record is the multi-asset book (ADR-0194) — it does not follow the ?lens=${otherBook} in the URL. The ${otherBook} book's own position count is on /book.`}
          >
            {" "}
            (multi-asset)
          </span>
        )}
        {recon && !recon.reconciled && !recon.bookMissing && (
          <span
            style={{ color: "var(--warning)" }}
            title="portfolio_positions holds L1's provisional candidate pool; the pipeline reconciles it down to the published book after L5. /risk discloses that its risk numbers are computed on the pool meanwhile (ADR-0040)."
          >
            {" "}· {recon.positionCount} in positions, reconciling
          </span>
        )}
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
