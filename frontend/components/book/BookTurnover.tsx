"use client";

import { comparabilityCaveat, turnover } from "@/lib/turnover";
import { SegmentedBar } from "@/components/book/MiniPlot";

/**
 * How much of the book changed since the last run?
 *
 * "Would you get the same answer tomorrow?" is the first thing anyone asks of a
 * systematic book, and nothing here answered it. The data was always present —
 * research_recommendations keeps one row per run_date — but no code compared two of
 * them, so the question could only be answered by manually diffing two days.
 *
 * It reports names, not weights. A position that survives at a different size is the
 * same idea; a position that appears or disappears is a different book. Weight drift
 * is real but it is a second-order question, and conflating the two would hide the
 * one that matters.
 *
 * Deliberately no verdict attached. A high reading is not automatically bad — a
 * regime turn SHOULD churn a book — and a low one is not automatically good. The
 * number is stated with the names behind it so a reader can judge; inventing a
 * "stable/unstable" label would be the confident narration this codebase keeps
 * removing.
 */

export interface TurnoverInput {
  /** Today's held names. */
  current: string[];
  /** The previous run's held names, and its date. */
  previous: string[] | null;
  previousDate: string | null;
}

export default function BookTurnover({
  current,
  previous,
  previousDate,
}: TurnoverInput) {
  if (!previous || previous.length === 0 || !previousDate) {
    return null;
  }
  const { kept, opened, closed, pct } = turnover(current, previous);
  const caveat = comparabilityCaveat(current.length, previous.length);

  return (
    <div className="card mb-6">
      <div className="card-header">
        <span className="card-title">Turnover vs previous run</span>
        <span className="num text-[11px] text-text-tertiary">
          {previousDate} → today
        </span>
      </div>
      <div className="px-[18px] py-3.5">
        <div className="flex items-baseline gap-3 flex-wrap mb-2">
          <span className="num text-[22px] font-semibold leading-[1.1]">
            {(pct * 100).toFixed(0)}%
          </span>
          <span className="text-[12.5px] text-text-secondary">
            of the combined name set changed —{" "}
            <span className="num">{kept.length}</span> held through,{" "}
            <span className="num">{opened.length}</span> opened,{" "}
            <span className="num">{closed.length}</span> closed
          </span>
        </div>
        <div className="mb-3">
          <SegmentedBar
            total={kept.length + opened.length + closed.length}
            label={`${kept.length} held through, ${opened.length} opened, ${closed.length} closed`}
            segments={[
              { label: "Held through", value: kept.length, color: "var(--text-tertiary)" },
              { label: "Opened", value: opened.length, color: "var(--long)" },
              { label: "Closed", value: closed.length, color: "var(--short)" },
            ]}
          />
        </div>
        <div className="text-[12px] text-text-secondary leading-[1.6] space-y-0.5">
          {kept.length > 0 && (
            <div>
              <span className="text-text-tertiary">Held through — </span>
              <span className="num">{kept.join(", ")}</span>
            </div>
          )}
          {opened.length > 0 && (
            <div>
              <span className="text-text-tertiary">Opened — </span>
              <span className="num" style={{ color: "var(--long)" }}>
                {opened.join(", ")}
              </span>
            </div>
          )}
          {closed.length > 0 && (
            <div>
              <span className="text-text-tertiary">Closed — </span>
              <span className="num" style={{ color: "var(--short)" }}>
                {closed.join(", ")}
              </span>
            </div>
          )}
        </div>
        {caveat && (
          <p
            className="m-0 mt-2.5 text-[12px] leading-[1.55] max-w-[92ch]"
            style={{ color: "var(--warning)" }}
          >
            {caveat}
          </p>
        )}
        <p className="m-0 mt-2.5 text-[11px] text-text-tertiary leading-[1.5] max-w-[92ch]">
          Names, not weights: a position that survives at a different size is the same
          idea. No verdict is attached — a regime turn <em>should</em> churn a book,
          so a high reading is not automatically bad, and the names are shown so the
          change can be judged rather than scored.
        </p>
      </div>
    </div>
  );
}
