"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  THIN_RECORD_THRESHOLD,
  buildTrackRecord,
  fmtPct,
  fmtSignedPct,
  trackRecordStatus,
  type PickOutcomeRow,
  type TrackRecord as Record_,
} from "@/lib/method/trackRecord";

// The forward track record (ADR-0090). Every other validation surface on this site looks
// BACKWARD at signals — the IC backtests, the replication test, the eval battery. This is
// the only one that scores the books we actually published.
//
// It is deliberately shipped while it has nothing to report. The spec was fixed on
// 2026-07-26, when the earliest book was four days old and the first 21-trading-day
// resolution was still ~2026-08-20, so every row read `pending`. Publishing the empty
// instrument is the point: a scorecard that appears once there are results to show is a
// scorecard whose test was chosen after the fact.

const HORIZON = 21;

/**
 * `rows` supplied => this component does NOT fetch.
 *
 * ADR-0172 moved this panel to /attribution, where `RiskBody` already reads the run in
 * ONE effect and the answer row needs the same numbers. Letting it fetch again there
 * would put two reads of `pick_outcomes` on one page, which is the "two vintages of the
 * same run" failure ADR-0084 refuses — and the card and the panel could then disagree
 * about the hit count while sitting 400px apart.
 *
 * Self-contained remains the default so nothing else that mounts it has to change.
 */
export default function TrackRecord({ rows: given }: { rows?: PickOutcomeRow[] | null }) {
  const [fetched, setFetched] = useState<PickOutcomeRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rows = given !== undefined ? given : fetched;

  useEffect(() => {
    if (given !== undefined) return;   // caller owns the read
    supabase
      .from("pick_outcomes")
      // One string literal, not a concatenation: supabase-js infers the row type from the
      // select text, and a `+`-joined string degrades it to GenericStringError[].
      .select("run_date, asset, direction, horizon_days, verdict, void_reason, signed_return, entry_date, exit_date, expected_exit_date, spec_version")
      .eq("horizon_days", HORIZON)
      .order("run_date", { ascending: false })
      .limit(1000)
      .then(({ data, error }) => {
        if (error) {
          setError(error.message);
          return;
        }
        setFetched((data ?? []) as PickOutcomeRow[]);
      });
  }, [given]);

  const tr: Record_ | null = rows === null ? null : buildTrackRecord(rows, HORIZON);
  const status = tr ? trackRecordStatus(tr) : null;

  return (
    <section className="mb-7" id="track-record">
      <h2 className="text-[18px] font-semibold m-0 mb-1.5">
        Were the published books right?
      </h2>
      <p className="m-0 mb-4 text-[13.5px] text-text-secondary leading-[1.65] max-w-[76ch]">
        Everything else on this page checks whether a <em>signal</em> predicted returns in
        history. This checks the only claim that matters to a reader: the{" "}
        <strong>books we actually published</strong>. Each pick is resolved against a spec
        the pipeline assigns — never the model, which would let it choose its own exam:
        entry is the close on <span className="num">run_date</span> (the book publishes
        after the close, so that is the last price it could have acted on), exit is the
        close <span className="num">{HORIZON}</span> trading days later, and a{" "}
        <em>hit</em> is a signed return above zero. {HORIZON} trading days because{" "}
        <code className="num">scripts/backtest_edge.py</code> already measures IC against
        forward one-month returns; a different window would leave this table and the IC
        table disagreeing about what &ldquo;works&rdquo; means. Harness:{" "}
        <code className="num">scripts/resolve_outcomes.py</code>.
      </p>

      <div className="card">
        <div className="card-header flex-wrap gap-2">
          <span className="card-title">
            Published picks · {HORIZON}-trading-day resolution
          </span>
          <span className="text-[11px] text-text-tertiary num">
            {tr ? `${tr.total} claims · ${tr.books} book${tr.books === 1 ? "" : "s"}` : ""}
          </span>
        </div>

        {rows === null ? (
          <div className="px-4 py-4">
            <div className="skeleton h-[20px]" />
          </div>
        ) : error ? (
          <p className="m-0 px-4 py-4 text-[12.5px] text-text-tertiary leading-[1.6]">
            Could not read <code className="num">pick_outcomes</code>: {error}. The table
            is written by <code className="num">scripts/resolve_outcomes.py</code> in the
            nightly workflow; if it does not exist yet, migration{" "}
            <code className="num">043</code> has not been applied.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto min-w-0">
              <table className="w-full border-collapse text-[12.5px]">
                <caption className="sr-only">
                  Forward track record of published picks at the {HORIZON}-trading-day
                  horizon: hit rate, mean signed return, void rate and how many picks have
                  not yet matured.
                </caption>
                <tbody>
                  <Row
                    label="Hit rate"
                    value={fmtPct(tr!.hitRate)}
                    note={
                      tr!.resolved === 0
                        ? "not yet answerable — nothing has matured"
                        : `${tr!.hits} of ${tr!.resolved} resolved`
                    }
                    emphasis
                  />
                  <Row
                    label="Mean signed return"
                    value={fmtSignedPct(tr!.meanSignedReturn)}
                    note="direction-adjusted; a short that fell counts positive"
                  />
                  <Row
                    label="Void rate"
                    value={fmtPct(tr!.voidRate)}
                    note={
                      tr!.void === 0 && tr!.resolved === 0
                        ? "no picks have matured, so nothing could be voided"
                        : `${tr!.void} of ${tr!.resolved + tr!.void} matured — a void is NOT a miss`
                    }
                  />
                  <Row
                    label="Awaiting resolution"
                    value={String(tr!.pending)}
                    note={
                      tr!.firstExpectedMaturity
                        ? `first matures ${tr!.firstExpectedMaturity} (business-day estimate, ignores holidays)`
                        : "none pending"
                    }
                  />
                  {(["long", "short"] as const).map((side) => {
                    const d = tr!.byDirection[side];
                    return (
                      <Row
                        key={side}
                        label={`Hit rate · ${side === "long" ? "longs" : "shorts"}`}
                        value={d ? fmtPct(d.hitRate) : "—"}
                        note={
                          d
                            ? `${d.resolved} resolved`
                            : "no resolved picks on this side yet"
                        }
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="px-4 py-3 border-t border-border">
              {status === "no-record-yet" ? (
                <p className="m-0 text-[12.5px] text-text-secondary leading-[1.6]">
                  <span className="text-warning font-semibold">
                    No track record yet — and this table shipped before there was one.
                  </span>{" "}
                  All {tr!.total} published picks are still inside their {HORIZON}-day
                  window, so every figure above that depends on an outcome reads{" "}
                  <span className="num">—</span> rather than{" "}
                  <span className="num">0%</span>: a zero hit rate would assert every call
                  was wrong, which is a different claim from &ldquo;not answerable
                  yet&rdquo;. The commitment is already recorded — one row per pick, written
                  when its book published — so the denominator was fixed before any outcome
                  was knowable and no call can quietly drop out of it later.
                </p>
              ) : status === "too-thin" ? (
                <p className="m-0 text-[12.5px] text-text-secondary leading-[1.6]">
                  <span className="text-warning font-semibold">
                    Measured, but too thin to read as a track record.
                  </span>{" "}
                  {tr!.resolved} pick{tr!.resolved === 1 ? "" : "s"} have resolved, against
                  a bar of {THIN_RECORD_THRESHOLD}. A hit rate over a handful of names is
                  noise with a percentage sign — the same trap the IC panel above
                  documents, where a single-date correlation was nearly read as validation.
                  The number is shown for what it is and no more.
                </p>
              ) : (
                <p className="m-0 text-[12.5px] text-text-secondary leading-[1.6]">
                  Read the hit rate and the mean signed return <em>together</em>: a book
                  can be right more often than not and still lose money, and neither number
                  substitutes for the other. The void rate is the share of matured picks
                  the spec could not score at all — it belongs beside the hit rate, because
                  excluding voids silently is how a record flatters itself.
                </p>
              )}
              <p className="m-0 mt-2 text-[11px] text-text-tertiary leading-[1.6]">
                No Brier score, deliberately: it needs a calibrated probability, and{" "}
                <span className="num">conviction</span> is a sizing input (edge ÷ vol), not
                a probability the call is right. Source:{" "}
                <code className="num">pick_outcomes</code>, spec{" "}
                <span className="num">{rows[0]?.spec_version ?? "v1"}</span>.
              </p>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function Row({
  label,
  value,
  note,
  emphasis = false,
}: {
  label: string;
  value: string;
  note: string;
  emphasis?: boolean;
}) {
  return (
    <tr>
      <th
        scope="row"
        className="px-[14px] py-2.5 border-b border-border text-left font-medium text-text-primary"
      >
        {label}
      </th>
      <td
        className={`px-[14px] py-2.5 border-b border-border text-right num whitespace-nowrap ${
          emphasis ? "font-semibold text-[13.5px]" : "text-text-secondary"
        }`}
      >
        {value}
      </td>
      <td className="px-[14px] py-2.5 border-b border-border text-text-tertiary text-[11.5px] leading-[1.5]">
        {note}
      </td>
    </tr>
  );
}
