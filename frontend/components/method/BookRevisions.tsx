"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// Corrections to already-published books (ADR-0093).
//
// `research_recommendations` is upserted on `run_date`, so a second run for the same date
// replaces the published book in place. On 2026-07-26 `research_agent_runs` held 17 runs
// for run_date 2026-07-25 and 25 for 2026-07-24 — every one that reached persist
// overwrote a published book, and nothing said so. A reader who quoted yesterday's gross
// exposure had no way to learn the figure had moved.
//
// An EMPTY table is a real state and says so, rather than rendering nothing: "no
// corrections recorded" and "we do not track corrections" look identical to a reader, and
// only one of them is true here.

interface RevisionRow {
  run_date: string;
  field: string;
  previous_value: string | null;
  new_value: string | null;
  trigger_type: string;
  reason: string;
  evidence: string | null;
  actor: string | null;
  revised_at: string;
}

/**
 * Exported so a test can assert the vocabulary matches migration 044's CHECK constraint.
 * A trigger the DB accepts but the UI cannot label would render as a raw enum.
 */
export const TRIGGER_LABEL: Record<string, string> = {
  pipeline_rerun: "pipeline re-run",
  manual_correction: "manual correction",
  backfill: "backfill",
};

/**
 * A revision cell, or an em dash.
 *
 * Exported and separate because it carries the one rule that matters in this table and is
 * easy to lose in JSX: a null previous value means the field was ABSENT before, not that
 * it was zero (ADR-0066). Rendering it as `0` would assert the book previously held a
 * value it never had — on the one surface whose job is to be trusted about what changed.
 */
export function revisionCell(v: string | null | undefined): string {
  return v ?? "—";
}

export default function BookRevisions() {
  const [rows, setRows] = useState<RevisionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("book_revisions")
      .select("run_date, field, previous_value, new_value, trigger_type, reason, evidence, actor, revised_at")
      .order("revised_at", { ascending: false })
      .limit(100)
      .then(({ data, error }) => {
        if (error) {
          setError(error.message);
          return;
        }
        setRows((data ?? []) as RevisionRow[]);
      });
  }, []);

  return (
    <section className="mb-7" id="corrections">
      <h2 className="text-[18px] font-semibold m-0 mb-1.5">
        Has a published book been changed?
      </h2>
      <p className="m-0 mb-4 text-[13.5px] text-text-secondary leading-[1.65] max-w-[76ch]">
        The book is written with an upsert keyed on{" "}
        <span className="num">run_date</span>, so a second run for the same date{" "}
        <strong>replaces</strong> the published book rather than adding a new one. That is
        the right behaviour — one book per day — but it means a figure you quoted can move
        under you with nothing to mark it. Every field that changes on an
        already-published book is recorded below with what it was, what it became, and
        why. A revision cannot be saved without a stated reason.
      </p>

      <div className="card">
        <div className="card-header flex-wrap gap-2">
          <span className="card-title">Corrections to published books</span>
          <span className="text-[11px] text-text-tertiary num">
            {rows ? `${rows.length} recorded` : ""}
          </span>
        </div>

        {rows === null ? (
          <div className="px-4 py-4">
            <div className="skeleton h-[20px]" />
          </div>
        ) : error ? (
          <p className="m-0 px-4 py-4 text-[12.5px] text-text-tertiary leading-[1.6]">
            Could not read <code className="num">book_revisions</code>: {error}. If the
            table does not exist yet, migration <code className="num">044</code> has not
            been applied.
          </p>
        ) : rows.length === 0 ? (
          <p className="m-0 px-4 py-4 text-[12.5px] text-text-secondary leading-[1.6] max-w-[80ch]">
            <span className="font-semibold text-text-primary">
              No corrections recorded.
            </span>{" "}
            Note what this does and does not say: the log is live and empty, meaning no
            published book has been changed <em>since the log started</em>. Books
            published before then were overwritten without a record — the log cannot
            reconstruct what it was not running for.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12.5px] min-w-[760px]">
              <caption className="sr-only">
                Corrections to already-published books: the run date affected, the field,
                its previous and new value, the trigger, and the stated reason.
              </caption>
              <thead>
                <tr>
                  {["Run date", "Field", "Was", "Became", "Trigger", "Reason"].map((h) => (
                    <th
                      key={h}
                      scope="col"
                      className="px-[14px] py-2.5 text-left text-[10.5px] uppercase tracking-[0.09em] text-text-tertiary font-medium border-b border-border-strong bg-bg-elevated"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.run_date}-${r.field}-${i}`} className="align-top">
                    <td className="px-[14px] py-2.5 border-b border-border num whitespace-nowrap">
                      {r.run_date}
                    </td>
                    <td className="px-[14px] py-2.5 border-b border-border num text-text-secondary">
                      {r.field}
                    </td>
                    {/* A null previous value means the field was absent, not zero — so it
                        renders as an em dash, never as 0 (ADR-0066). */}
                    <td className="px-[14px] py-2.5 border-b border-border num text-text-secondary">
                      {revisionCell(r.previous_value)}
                    </td>
                    <td className="px-[14px] py-2.5 border-b border-border num text-text-primary">
                      {revisionCell(r.new_value)}
                    </td>
                    <td className="px-[14px] py-2.5 border-b border-border">
                      <span className="badge badge-neutral">
                        {TRIGGER_LABEL[r.trigger_type] ?? r.trigger_type}
                      </span>
                    </td>
                    <td className="px-[14px] py-2.5 border-b border-border text-text-secondary leading-[1.5] max-w-[42ch]">
                      {r.reason}
                      {r.evidence && (
                        <span className="block mt-1 text-[11px] text-text-tertiary num">
                          {r.evidence}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="m-0 px-4 py-3 border-t border-border text-[11px] text-text-tertiary leading-[1.6] max-w-[90ch]">
          This records the <em>fact</em> of a change per field, not a snapshot of the
          whole prior book — storing every superseded book keyed by a date that can be
          overwritten many times in a day is a different decision. A float that moves by
          less than a basis point is not logged; a value that appears or disappears always
          is, because &ldquo;not computable&rdquo; and &ldquo;zero&rdquo; are different
          claims. Source: <code className="num">book_revisions</code>.
        </p>
      </div>
    </section>
  );
}
