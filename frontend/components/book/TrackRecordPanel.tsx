"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import {
  THIN_RECORD_THRESHOLD,
  buildTrackRecord,
  fmtPct,
  fmtSignedPct,
  trackRecordStatus,
  type PickOutcomeRow,
  type TrackRecord,
} from "@/lib/method/trackRecord";

/**
 * Did the books we published turn out to be right?
 *
 * WHY THIS EXISTS HERE. The instrument already existed — `pick_outcomes` (ADR-0090),
 * `buildTrackRecord`, and a full resolution table — but it rendered only on `/method`,
 * two clicks from the claims it grades. A reader looking at ten positions on `/book` had
 * no way to see that those positions are on the record and will be scored on a spec the
 * pipeline fixed in advance. That is the repo's recurring failure mode: working machinery
 * that is never surfaced. This panel is the summary at the point of the claim; `/method`
 * keeps the full table.
 *
 * NO SECOND AGGREGATION. It calls `buildTrackRecord` — the same function `/method` calls
 * and the same one `tests/unit/track-record.test.ts` pins against the backend's
 * `build_scorecard`. A panel that recomputed a hit rate from raw rows would be the second
 * copy ADR-0064 refuses, and the two would eventually disagree on the one number whose
 * whole value is being trustworthy.
 *
 * WHAT IT MAY NOT DO. Show a percentage while nothing has resolved. On 2026-07-27 all 23
 * published claims across 4 books are `pending`, first maturing 2026-08-20 — so the
 * honest headline is the size of the outstanding bet, not a rate. `fmtPct(null)` already
 * renders an em dash rather than 0%, and `panelClaim` never reaches for a rate the record
 * cannot support. See `panelClaim` for the thin-record rule, which is stricter here than
 * on `/method` and says why.
 */

const HORIZON = 21;

export interface PanelClaim {
  /** The large figure. A count until the record is thick enough to carry a rate. */
  headline: string;
  /** What the headline counts — always rendered directly beneath it. */
  label: string;
  /** The qualification. Never optional: every state here needs one. */
  note: string;
}

/**
 * What this panel is allowed to say, as data so it can be tested without a DOM.
 *
 * THE HEADLINE IS A COUNT UNTIL THE RECORD IS `measured`. `/method` shows the hit rate
 * with a caveat beside it, which is right for a page a reader arrives at to study method.
 * This panel sits beside the positions, where the number is scanned and the caveat is
 * not — and a "67%" over three resolved picks scanned that way is exactly the failure
 * ADR-0059 caught on the IC panel, where a verdict keyed on "is there a number" painted a
 * single observation as validation. So below THIN_RECORD_THRESHOLD the headline stays a
 * count of what has actually matured, and the rate appears in the note where it is read
 * with its denominator or not at all.
 */
export function panelClaim(tr: TrackRecord): PanelClaim {
  const status = trackRecordStatus(tr);
  const books = `${tr.books} book${tr.books === 1 ? "" : "s"}`;

  if (status === "no-record-yet") {
    return {
      headline: String(tr.pending),
      label: `claims live, none resolved yet · ${books}`,
      note: tr.firstExpectedMaturity
        ? `The first verdict lands ${tr.firstExpectedMaturity}, ${HORIZON} trading days ` +
          `after the book that made the call. Nothing has matured, so there is no hit ` +
          `rate — which is not the same as a hit rate of zero.`
        : `Nothing has matured, so there is no hit rate — which is not the same as a hit ` +
          `rate of zero. No pending pick carries an expected resolution date.`,
    };
  }

  if (status === "too-thin") {
    return {
      headline: `${tr.hits}/${tr.resolved}`,
      label: `resolved calls correct · ${tr.pending} still live`,
      note:
        `That is ${fmtPct(tr.hitRate)} over ${tr.resolved} resolved ` +
        `pick${tr.resolved === 1 ? "" : "s"}, below the ${THIN_RECORD_THRESHOLD} this ` +
        `panel treats as the point a rate becomes readable. It is a running count, not ` +
        `a track record, and it should not be used to judge the book yet.`,
    };
  }

  return {
    headline: fmtPct(tr.hitRate),
    label: `hit rate · ${tr.resolved} resolved across ${books}`,
    note:
      `Mean signed return ${fmtSignedPct(tr.meanSignedReturn)} per resolved pick, ` +
      `direction-adjusted so a short that fell counts positive. ` +
      `${tr.pending} pick${tr.pending === 1 ? "" : "s"} still live.`,
  };
}

export default function TrackRecordPanel() {
  const [rows, setRows] = useState<PickOutcomeRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("pick_outcomes")
      // One string literal, not a concatenation — supabase-js infers the row type from
      // the select text and a `+`-joined string degrades it to GenericStringError[].
      .select("run_date, asset, direction, horizon_days, verdict, void_reason, signed_return, entry_date, exit_date, expected_exit_date, spec_version")
      .eq("horizon_days", HORIZON)
      .order("run_date", { ascending: false })
      .limit(1000)
      .then(({ data, error: e }) => {
        if (e) setError(e.message);
        else setRows((data ?? []) as PickOutcomeRow[]);
      });
  }, []);

  if (error) {
    return (
      <div className="card mb-6 p-[18px] text-[12.5px] text-text-secondary">
        Could not read <code className="num">pick_outcomes</code>: {error}
      </div>
    );
  }

  // Absent is not zero, and it is also not a finding worth a card: an empty table means
  // `resolve_outcomes.py` has not run or migration 043 is unapplied, which is a pipeline
  // fact, not a fact about the book. `/method` renders that case in full, with the
  // diagnosis. Same rule as Replication.
  if (rows === null || rows.length === 0) return null;

  const tr = buildTrackRecord(rows, HORIZON);
  const claim = panelClaim(tr);

  return (
    <div className="card mb-6">
      <div className="card-header flex-wrap gap-2">
        <span className="card-title">Were the published books right?</span>
        <span className="num text-[11px] text-text-tertiary">
          {tr.total} claims · {HORIZON}d
        </span>
      </div>

      <div className="px-[18px] py-3.5">
        <div className="num text-[19px] font-semibold leading-[1.15]">
          {claim.headline}
        </div>
        <div className="text-[11px] text-text-tertiary leading-[1.4] mb-3">
          {claim.label}
        </div>

        <p className="m-0 text-[12px] text-text-secondary leading-[1.6]">{claim.note}</p>

        <p className="m-0 mt-3 text-[11px] text-text-tertiary leading-[1.55]">
          Entry is the close on the book&rsquo;s own run date, exit the close {HORIZON}{" "}
          trading days later — a spec the pipeline assigns, never the model, so it cannot
          choose its own exam.{" "}
          <Link href="/method#track-record" className="text-accent hover:underline">
            Full resolution table
          </Link>
        </p>
      </div>
    </div>
  );
}
