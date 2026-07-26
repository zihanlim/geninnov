"use client";
import {
  explainGap,
  isNum,
  type AnalyticsState,
  type PositioningCrowdingRow,
} from "@/lib/risk/analytics";
import { Ident, SectionGap, SectionSkeleton } from "./SectionGap";

// Is the book leaning the way speculators already are? (ADR-0097)
//
// COVERAGE LEADS. On the 2026-07-25 book, COT can see 2 of 10 positions — 22% of gross.
// A panel that opened with a crowding verdict would let a reader believe the book had been
// checked when four fifths of it had not been, so the first thing rendered is the share COT
// can speak to, and the eight positions it cannot see are listed with their reasons rather
// than omitted (design goal 2: absence is stated, never filled).
//
// Renders the PERSISTED assessment. The contract mapping is a judgement, and a second copy
// of a judgement drifts into a confidently wrong classification with no visible symptom.

type Unobservable = PositioningCrowdingRow["unobservable"][number];

/**
 * Collapse positions onto their shared reason, preserving first-seen (weight-sorted) order.
 *
 * The reasons are keyed on sector upstream, so several positions legitimately share one
 * string. Rendering per position printed that string once per name.
 */
function groupByReason(rows: Unobservable[]): Array<{ reason: string; members: Unobservable[] }> {
  const out: Array<{ reason: string; members: Unobservable[] }> = [];
  for (const r of rows) {
    const hit = out.find((g) => g.reason === r.reason);
    if (hit) hit.members.push(r);
    else out.push({ reason: r.reason, members: [r] });
  }
  return out;
}

/** The side pill, using the `dir-pill-*` primitive (ADR-0085) — glyph AND wordmark. */
function dirLabel(d: string): { text: string; cls: string } {
  if (d === "long") return { text: "▲ LONG", cls: "dir-pill-long" };
  if (d === "short") return { text: "▼ SHORT", cls: "dir-pill-short" };
  return { text: "—", cls: "bg-bg-elevated text-text-tertiary border border-border" };
}

/**
 * Where a reading sits in its own three-year range, as a labelled bar.
 *
 * The number is always printed beside the bar: the bar is a comparison aid, never the only
 * carrier of the value (design goal 1 — no naked graphics either).
 */
function IndexBar({ index, high, low }: { index: number; high: number; low: number }) {
  const extreme = index >= high || index <= low;
  return (
    <div className="flex items-center gap-2">
      <span className="num tabular-nums w-[38px] text-right font-semibold">
        {index.toFixed(0)}
      </span>
      <span
        className="relative inline-block h-[6px] w-[72px] rounded-full bg-bg-elevated border border-border"
        role="img"
        aria-label={`Speculator positioning at the ${index.toFixed(0)}th percentile of its three-year range`}
      >
        <span
          className="absolute top-[-3px] h-[10px] w-[2px] rounded-full"
          style={{
            left: `calc(${Math.max(0, Math.min(100, index))}% - 1px)`,
            background: extreme ? "var(--warning)" : "var(--text-secondary)",
          }}
        />
      </span>
    </div>
  );
}

export function PositioningCrowding({
  state,
}: {
  state: AnalyticsState<PositioningCrowdingRow>;
}) {
  const gap = explainGap(state, {
    column: "positioning_crowding",
    emptyMeaning:
      "The column is null — this run predates the assessment (migration 046), or the CFTC " +
      "portal did not answer. That is NOT the same as 'the book is not crowded': it means " +
      "external positioning was not retrieved. Re-run the pipeline to populate it.",
  });

  const x = state.status === "ok" ? state.value : null;
  const total = x ? x.rows.length + x.unobservable.length : 0;

  return (
    <section className="card mb-6" aria-labelledby="risk-positioning-heading">
      <div className="card-header">
        <h2 id="risk-positioning-heading" className="card-title m-0">
          External positioning (CFTC)
        </h2>
        {/* Deliberately NOT the coverage count: the strip below already states it, and the
            persisted summary states it again verbatim. Three restatements in three rows read
            as a stutter when this was first rendered. */}
        <span className="text-[11px] text-text-tertiary">speculator crowding</span>
      </div>

      {state.status === "loading" ? (
        <SectionSkeleton height={170} />
      ) : gap ? (
        <SectionGap copy={gap} tone={state.status === "query_error" ? "error" : "empty"} />
      ) : !x ? null : !x.fetched ? (
        <p className="m-0 px-[18px] py-3 text-[12.5px] text-text-secondary leading-[1.6] max-w-[86ch]">
          {x.summary}
        </p>
      ) : (
        <>
          {/* Coverage first, as FIGURES rather than as a sentence.
              This strip used to read "COT can see 22% of this book's gross · 2 of 10
              positions map to a futures contract", directly above a persisted summary
              opening with the same words. Two correct rules collided: the summary renders
              verbatim so the page cannot restate the finding differently, and the strip
              exists so the number is scannable. Rendering the strip as a stat block keeps
              the scannable figure without competing with the prose for the same sentence. */}
          <div className="flex flex-wrap gap-x-8 gap-y-3 px-[18px] py-3 border-b border-border">
            <div>
              <div className="num text-[20px] font-semibold leading-[1.1]">
                {isNum(x.coverage_share) ? `${(x.coverage_share * 100).toFixed(0)}%` : "—"}
              </div>
              <div className="text-[10.5px] uppercase tracking-[0.09em] text-text-tertiary mt-0.5">
                of gross observable
              </div>
            </div>
            <div>
              <div className="num text-[20px] font-semibold leading-[1.1]">
                {x.rows.length}
                <span className="text-text-tertiary">/{total}</span>
              </div>
              <div className="text-[10.5px] uppercase tracking-[0.09em] text-text-tertiary mt-0.5">
                positions mapped
              </div>
            </div>
            <div>
              <div
                className="num text-[20px] font-semibold leading-[1.1]"
                style={
                  isNum(x.crowded_share) && x.crowded_share > 0
                    ? { color: "var(--warning)" }
                    : undefined
                }
              >
                {isNum(x.crowded_share) ? `${(x.crowded_share * 100).toFixed(1)}%` : "—"}
              </div>
              <div className="text-[10.5px] uppercase tracking-[0.09em] text-text-tertiary mt-0.5">
                with the crowd
              </div>
            </div>
          </div>

          {/* The persisted sentence, verbatim — the page must not restate the finding in
              different words from the module that computed it. */}
          <p className="m-0 px-[18px] py-3 text-[12.5px] text-text-secondary leading-[1.6] max-w-[86ch] border-b border-border">
            {x.summary}
          </p>

          {x.rows.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[12.5px] min-w-[720px]">
                <caption className="sr-only">
                  Positions that map to a futures contract, with speculator positioning in
                  that contract and whether the book agrees with it.
                </caption>
                <thead>
                  <tr>
                    {["Name", "Book side", "Weight", "Contract", "In contract", "Specs (3y %ile)", "Verdict"].map(
                      (h, i) => (
                        <th
                          key={h}
                          scope="col"
                          className={`px-[14px] py-2 text-[10.5px] uppercase tracking-[0.09em] text-text-tertiary font-medium border-b border-border-strong bg-bg-elevated ${
                            i === 2 ? "text-right" : "text-left"
                          }`}
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {x.rows.map((r) => (
                    <tr key={`${r.asset}-${r.direction}`} className="align-top">
                      <td className="px-[14px] py-2 border-b border-border num text-text-primary">
                        {r.asset}
                      </td>
                      <td className="px-[14px] py-2 border-b border-border">
                        <span className={`dir-pill ${dirLabel(r.direction).cls}`}>
                          {dirLabel(r.direction).text}
                        </span>
                      </td>
                      <td className="px-[14px] py-2 border-b border-border text-right num text-text-secondary">
                        {(r.weight * 100).toFixed(2)}%
                      </td>
                      <td className="px-[14px] py-2 border-b border-border num text-text-secondary">
                        {r.contract}
                      </td>
                      {/* The resolved side. Shown as its own column BECAUSE it can differ
                          from the book side: SVXY is inverse, so long SVXY is short VIX.
                          Hiding the resolution would make the verdict unauditable. */}
                      <td className="px-[14px] py-2 border-b border-border">
                        <span className={`dir-pill ${dirLabel(r.effective_side).cls}`}>
                          {dirLabel(r.effective_side).text}
                        </span>
                        {r.inverse ? (
                          <span className="block mt-1 text-[10.5px] text-text-tertiary">
                            inverse product — flipped
                          </span>
                        ) : null}
                      </td>
                      <td className="px-[14px] py-2 border-b border-border text-text-secondary">
                        <IndexBar index={r.cot_index} high={x.crowded_high} low={x.crowded_low} />
                        {/* Only the CROWDED case gets a subtitle. "mid-range" here plus
                            "Not at a speculator extreme" in the verdict column said the same
                            thing twice on every row; the threshold is in the footnote. */}
                        {r.crowded_side ? (
                          <span className="block mt-1 text-[10.5px] text-text-tertiary">
                            specs crowded {r.crowded_side}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-[14px] py-2 border-b border-border text-[11.5px] leading-[1.5] max-w-[34ch]">
                        {r.agrees_with_crowd ? (
                          <span style={{ color: "var(--warning)" }}>
                            Leaning WITH the crowd — exposed to it unwinding.
                          </span>
                        ) : (
                          <span className="text-text-tertiary">
                            Not at a speculator extreme.
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {/* The part COT cannot see, stated rather than dropped. */}
          {x.unobservable.length > 0 ? (
            <details className="border-t border-border">
              <summary className="px-[18px] py-2.5 text-[11.5px] text-text-secondary cursor-pointer select-none">
                {x.unobservable.length === 1
                  ? "1 position COT cannot see — and why"
                  : `${x.unobservable.length} positions COT cannot see — and why`}
              </summary>
              {/* Grouped BY REASON, not listed per position. Reasons are keyed on sector, so
                  a per-position list printed the identical paragraph for every name sharing
                  one — PDD and BABA both got "No US futures contract…", which read as a
                  copy-paste bug rather than a shared cause. Grouping also makes the real
                  shape visible: four causes, not eight coincidences. */}
              <ul className="m-0 list-none px-[18px] pb-3 pt-1">
                {groupByReason(x.unobservable).map((g) => (
                  <li key={g.reason} className="py-2 border-b border-border last:border-b-0">
                    <span className="block text-[11.5px] text-text-tertiary leading-[1.55] max-w-[92ch]">
                      {g.reason}
                    </span>
                    <span className="block mt-1">
                      {g.members.map((u, i) => (
                        <span key={`${u.asset}-${u.direction}`}>
                          {i > 0 ? <span className="text-text-tertiary">, </span> : null}
                          <span className="num text-text-primary text-[12.5px]">{u.asset}</span>{" "}
                          <span className="num text-text-secondary text-[11.5px]">
                            {u.direction} {(u.weight * 100).toFixed(2)}%
                          </span>
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          <p className="m-0 px-[18px] py-3 text-[11px] text-text-tertiary leading-[1.6] max-w-[92ch] border-t border-border">
            Speculator positioning is the non-commercial net long minus short, as a percentile
            of its own three-year range; crowded is defined as {x.crowded_low} or below and{" "}
            {x.crowded_high} or above, the conventional threshold rather than a fitted one.
            Agreeing with a crowded consensus is <em>risk</em> — exposure to that consensus
            {/* The observation date and its publication lag are NOT repeated here — the
                persisted summary above already states them, and printing the same sentence
                twice two paragraphs apart is what the first version did. Rationale belongs
                in this comment, not in the copy a reader sees. */}
            unwinding — and never a reason to hold a position. Source:{" "}
            <Ident>research_recommendations.positioning_crowding</Ident>.
          </p>
        </>
      )}
    </section>
  );
}
