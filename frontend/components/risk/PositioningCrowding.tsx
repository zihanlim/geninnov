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
        <span className="text-[11px] text-text-tertiary">
          {x ? `${x.rows.length} of ${total} positions observable` : "speculator crowding"}
        </span>
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
          {/* Coverage first, deliberately. */}
          <div className="px-[18px] py-3 border-b border-border text-[13px]">
            <span className="font-semibold">COT can see</span>
            {isNum(x.coverage_share) ? (
              <>
                {" "}
                <span className="num font-semibold">
                  {(x.coverage_share * 100).toFixed(0)}%
                </span>
                <span className="text-text-secondary"> of this book&rsquo;s gross</span>
              </>
            ) : (
              <span className="text-text-secondary"> an unmeasurable share of gross</span>
            )}
            <span className="text-text-tertiary mx-1.5">·</span>
            <span className="text-text-secondary">
              {x.rows.length} of {total} positions map to a futures contract
            </span>
            {isNum(x.crowded_share) && x.crowded_share > 0 ? (
              <>
                <span className="text-text-tertiary mx-1.5">·</span>
                <span className="num font-semibold" style={{ color: "var(--warning)" }}>
                  {(x.crowded_share * 100).toFixed(1)}%
                </span>
                <span className="text-text-secondary"> agrees with a crowded consensus</span>
              </>
            ) : null}
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
                        <span className="block mt-1 text-[10.5px] text-text-tertiary">
                          {r.crowded_side
                            ? `specs crowded ${r.crowded_side}`
                            : `mid-range (crowded outside ${x.crowded_low}–${x.crowded_high})`}
                        </span>
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
                {x.unobservable.length} position(s) COT cannot see — and why
              </summary>
              <ul className="m-0 list-none px-[18px] pb-3 pt-1">
                {x.unobservable.map((u) => (
                  <li
                    key={`${u.asset}-${u.direction}`}
                    className="py-1.5 border-b border-border last:border-b-0"
                  >
                    <span className="num text-text-primary text-[12.5px]">{u.asset}</span>
                    <span className="text-text-tertiary mx-1.5">·</span>
                    <span className="num text-text-secondary text-[11.5px]">
                      {u.direction} {(u.weight * 100).toFixed(2)}%
                    </span>
                    <span className="block mt-0.5 text-[11.5px] text-text-tertiary leading-[1.55] max-w-[92ch]">
                      {u.reason}
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
            unwinding — and never a reason to hold a position.{" "}
            {x.as_of ? (
              <>
                Positions are as of <span className="num">{x.as_of}</span>, the CFTC
                observation date; the report publishes the following Friday, so this reading
                is days old by construction.{" "}
              </>
            ) : null}
            Source: <Ident>research_recommendations.positioning_crowding</Ident>.
          </p>
        </>
      )}
    </section>
  );
}
