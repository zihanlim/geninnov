"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  buildSourceBoard,
  observabilitySummary,
  type SourceObservation,
  type SourceRow,
  type SourceVerdict,
} from "@/lib/method/sourceBoard";

// Every source the book rests on, and what each can honestly say about its own age (ADR-0105).
//
// The finding it exists to state: most of our tables record only RETRIEVAL.
// `macro_indicators` has `fetch_date` and `fetched_at` and no observation column, so "how old
// is this FRED reading" has no answer in our schema. Printing "updated 2026-07-25" would hide
// that behind a fresh-looking timestamp, which is the conflation ADR-0098 named.
//
// Five verdicts, deliberately distinct: current / stale / silent (asked, got nothing) /
// unconfigured (never asked) / age-unknowable (rows, but no observation date). Each asks
// something different of a reader.

const VERDICT_COPY: Record<SourceVerdict, { label: string; cls: string }> = {
  current: { label: "CURRENT", cls: "text-text-secondary" },
  stale: { label: "STALE", cls: "text-warning font-semibold" },
  silent: { label: "SILENT", cls: "text-warning font-semibold" },
  unconfigured: { label: "NOT CONFIGURED", cls: "text-text-tertiary" },
  "age-unknowable": { label: "AGE UNKNOWABLE", cls: "text-warning font-semibold" },
};

/** Latest date per role, read from the tables each source lands in. */
async function fetchObservations(): Promise<{
  observations: SourceObservation[];
  error: string | null;
}> {
  try {
    const [news, macro, hist, factors, book] = await Promise.all([
      supabase.from("theme_news").select("source, published_date, created_at")
        .order("published_date", { ascending: false }).limit(2000),
      supabase.from("macro_indicators").select("fetched_at")
        .order("fetched_at", { ascending: false }).limit(1),
      supabase.from("macro_daily_history").select("trading_date, created_at")
        .order("trading_date", { ascending: false }).limit(1),
      supabase.from("factor_exposures").select("created_at")
        .order("created_at", { ascending: false }).limit(1),
      supabase.from("research_recommendations").select("positioning_crowding")
        .order("run_date", { ascending: false }).limit(1),
    ]);

    const firstError = [news, macro, hist, factors, book].find((r) => r.error)?.error;
    if (firstError) return { observations: [], error: firstError.message };

    const newsRows = (news.data ?? []) as Array<{
      source: string | null; published_date: string | null; created_at: string | null;
    }>;
    const bySource = (name: string) => newsRows.filter((r) => (r.source ?? "") === name);
    const latest = (rows: Array<{ published_date: string | null; created_at: string | null }>) => ({
      published: rows.map((r) => r.published_date).filter(Boolean).sort().pop() ?? null,
      retrieved: rows.map((r) => r.created_at).filter(Boolean).sort().pop()?.slice(0, 10) ?? null,
    });

    const brave = bySource("brave");
    const reddit = bySource("reddit");
    const pc = (book.data?.[0] as { positioning_crowding?: { as_of?: string } } | undefined)
      ?.positioning_crowding;

    return {
      error: null,
      observations: [
        { key: "brave", rows: brave.length, ...latest(brave) },
        // Zero Reddit rows AND no credential in the deployment: reported as never asked
        // rather than as empty, because those are different facts (ADR-0094).
        { key: "reddit", rows: reddit.length, unconfigured: reddit.length === 0, ...latest(reddit) },
        {
          key: "fred",
          rows: (macro.data ?? []).length,
          retrieved: (macro.data?.[0] as { fetched_at?: string })?.fetched_at?.slice(0, 10) ?? null,
        },
        {
          key: "yfinance",
          rows: (hist.data ?? []).length,
          observed: (hist.data?.[0] as { trading_date?: string })?.trading_date ?? null,
          retrieved: (hist.data?.[0] as { created_at?: string })?.created_at?.slice(0, 10) ?? null,
        },
        {
          key: "kenfrench",
          rows: (factors.data ?? []).length,
          retrieved: (factors.data?.[0] as { created_at?: string })?.created_at?.slice(0, 10) ?? null,
        },
        {
          key: "cftc",
          rows: pc ? 1 : 0,
          observed: pc?.as_of ?? null,
        },
      ],
    };
  } catch (e) {
    return { observations: [], error: e instanceof Error ? e.message : String(e) };
  }
}

export default function SourceBoard() {
  const [board, setBoard] = useState<SourceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchObservations().then((r) => {
      if (r.error) setError(r.error);
      // `new Date()` is read once here rather than inside the pure builder, so the
      // judgement stays a function of its inputs and is testable without a clock.
      else setBoard(buildSourceBoard(r.observations, new Date()));
    });
  }, []);

  const summary = board ? observabilitySummary(board) : null;

  return (
    <div className="card mt-3" id="source-board">
      <div className="card-header flex-wrap gap-2">
        <span className="card-title">What the book rests on</span>
        <span className="text-[11px] text-text-tertiary num">
          {summary ? `${summary.contributing} of ${summary.total} contributing` : ""}
        </span>
      </div>

      {error ? (
        <p className="m-0 px-[18px] py-3 text-[12.5px] text-warning leading-[1.6]">
          The source tables could not be read ({error}), so this board cannot say what the
          book rests on. That is a failure to check, not a clean bill of health.
        </p>
      ) : !board || !summary ? (
        <p className="m-0 px-[18px] py-3 text-[12.5px] text-text-tertiary">Reading sources…</p>
      ) : (
        <>
          <p className="m-0 px-[18px] py-3 text-[12.5px] text-text-secondary leading-[1.6] max-w-[86ch] border-b border-border">
            {summary.sentence}
          </p>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12.5px] min-w-[560px]">
              <caption className="sr-only">
                Every external source the book depends on, what it feeds, the most meaningful
                date its table records, and whether that age can be known at all.
              </caption>
              <thead>
                <tr>
                  {["Source", "Feeds", "Age", "State"].map((h, i) => (
                    <th
                      key={h}
                      scope="col"
                      className={`px-[14px] py-2 text-[10.5px] uppercase tracking-[0.09em] text-text-tertiary font-medium border-b border-border-strong bg-bg-elevated ${
                        i === 2 ? "text-right" : "text-left"
                      }`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {board.map((r) => (
                  <tr key={r.key} className="align-top">
                    <td className="px-[14px] py-2 border-b border-border">
                      <span className="num text-text-primary">{r.label}</span>
                      <span className="block text-[10.5px] text-text-tertiary num mt-0.5">
                        {r.table}
                      </span>
                    </td>
                    <td className="px-[14px] py-2 border-b border-border text-text-secondary text-[11.5px] leading-[1.5] max-w-[40ch]">
                      {r.feeds}
                    </td>
                    <td className="px-[14px] py-2 border-b border-border text-right">
                      {/* The age ALWAYS names the role it was measured from. An age with no
                          stated basis is what let a five-day-old reading read as one day. */}
                      {r.ageDays === null ? (
                        <span className="text-text-tertiary">—</span>
                      ) : (
                        <>
                          <span className="num text-text-primary">{r.ageDays}d</span>
                          <span className="block text-[10.5px] text-text-tertiary mt-0.5">
                            from {r.ageMeasuredFrom}
                          </span>
                        </>
                      )}
                    </td>
                    <td className="px-[14px] py-2 border-b border-border max-w-[46ch]">
                      <span
                        className={`text-[10.5px] uppercase tracking-[0.09em] ${VERDICT_COPY[r.verdict].cls}`}
                      >
                        {VERDICT_COPY[r.verdict].label}
                      </span>
                      <span className="block text-[11.5px] text-text-tertiary leading-[1.5] mt-0.5">
                        {r.note}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="m-0 px-[18px] py-3 text-[11px] text-text-tertiary leading-[1.6] max-w-[92ch] border-t border-border">
            Age is measured from the most meaningful date each table records — observation
            where it exists, then publication, then retrieval — and the column says which,
            because the three answer different questions (ADR-0098). A source whose table
            records only retrieval cannot tell you how old the reading is, only how old our
            copy is, and is marked accordingly rather than shown as fresh.
          </p>
        </>
      )}
    </div>
  );
}
