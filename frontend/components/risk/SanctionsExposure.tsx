"use client";
import {
  explainGap,
  fmtSignedPct,
  isNum,
  type AnalyticsState,
  type SanctionsExposureRow,
} from "@/lib/risk/analytics";
import { Ident, SectionGap, SectionSkeleton } from "./SectionGap";

// Sanctions exposure, and which way it cuts (ADR-0096).
//
// The 2026-07-25 book held short BABA 8.7% + short PDD 9.25% — 30.2% of GROSS in US-listed
// Chinese ADRs. Held short, escalation is a TAILWIND, which is the opposite of what a
// China-heavy position list suggests at a glance. Neither the size nor the direction was
// stated anywhere before this panel existed.
//
// Renders the PERSISTED assessment rather than recomputing it. The jurisdiction map it rests
// on is a documented judgement, and two copies of a judgement drift into a confidently wrong
// classification with no visible symptom — unlike a formula, which shows a wrong number.

/**
 * The side pill, using the `dir-pill-*` primitive.
 *
 * Written this way because the goal-3 sweep in `chip-contrast.test.ts` flagged the first
 * draft: it used `badge-long` / `badge-short` inline, and that sweep has no allowlist by
 * design — a legitimate direction chip is expected to use `.dir-pill-long` / `.dir-pill-short`
 * (ADR-0085). Same shape as `AttentionCrowding.dirLabel`, so there is one way to render a
 * side on /risk rather than two. Glyph AND wordmark, so hue is never the carrier.
 */
function dirLabel(d: string): { text: string; cls: string } {
  if (d === "long") return { text: "▲ LONG", cls: "dir-pill-long" };
  if (d === "short") return { text: "▼ SHORT", cls: "dir-pill-short" };
  return { text: "—", cls: "bg-bg-elevated text-text-tertiary border border-border" };
}

/** Warning tone only when the book is net LONG sanctions risk — that is the headwind case. */
function toneFor(direction: string): { label: string; warn: boolean } {
  switch (direction) {
    case "short":
      return { label: "NET SHORT sanctions risk", warn: false };
    case "long":
      return { label: "NET LONG sanctions risk", warn: true };
    case "flat":
      return { label: "Flat on net", warn: false };
    default:
      return { label: "No identified exposure", warn: false };
  }
}

export function SanctionsExposure({ state }: { state: AnalyticsState<SanctionsExposureRow> }) {
  const gap = explainGap(state, {
    column: "sanctions_exposure",
    emptyMeaning:
      "The column is null — this run predates the assessment (migration 045), or it could " +
      "not be computed. That is NOT the same as 'no sanctions exposure': it means the " +
      "book's exposure has not been judged. Re-run the pipeline to populate it.",
  });

  const x = state.status === "ok" ? state.value : null;
  const tone = toneFor(x?.direction ?? "none");

  return (
    <section className="card mb-6" aria-labelledby="risk-sanctions-heading">
      <div className="card-header">
        <h2 id="risk-sanctions-heading" className="card-title m-0">
          Sanctions exposure
        </h2>
        <span className="text-[11px] text-text-tertiary">
          {x
            ? `${x.positions.length} position${x.positions.length === 1 ? "" : "s"}`
            : "jurisdiction and side"}
        </span>
      </div>

      {state.status === "loading" ? (
        <SectionSkeleton height={150} />
      ) : gap ? (
        <SectionGap copy={gap} tone={state.status === "query_error" ? "error" : "empty"} />
      ) : !x ? null : (
        <>
          <div className="px-[18px] py-3 border-b border-border text-[13px]">
            <span
              className="font-semibold"
              style={tone.warn ? { color: "var(--warning)" } : undefined}
            >
              {tone.label}
            </span>
            {isNum(x.share_of_gross) ? (
              <>
                <span className="text-text-tertiary mx-1.5">·</span>
                <span className="num font-semibold">
                  {(x.share_of_gross * 100).toFixed(1)}%
                </span>
                <span className="text-text-secondary"> of gross</span>
              </>
            ) : null}
            <span className="text-text-tertiary mx-1.5">·</span>
            <span className="num text-text-secondary">net {fmtSignedPct(x.net_weight)}</span>
          </div>

          {/* The persisted sentence, verbatim. The page must not restate the direction in
              different words from the module that decided it. */}
          <p className="m-0 px-[18px] py-3 text-[12.5px] text-text-secondary leading-[1.6] max-w-[86ch] border-b border-border">
            {x.summary}
          </p>

          {x.positions.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[12.5px] min-w-[640px]">
                <caption className="sr-only">
                  Positions in sanctions-exposed jurisdictions, with the side held and the
                  named channel of exposure.
                </caption>
                <thead>
                  <tr>
                    {["Name", "Side", "Weight", "Jurisdiction", "Channel"].map((h, i) => (
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
                  {x.positions.map((p) => (
                    <tr key={`${p.asset}-${p.direction}`} className="align-top">
                      <td className="px-[14px] py-2 border-b border-border num text-text-primary">
                        {p.asset}
                      </td>
                      {/* Glyph AND wordmark, never hue alone (ADR-0085). */}
                      <td className="px-[14px] py-2 border-b border-border">
                        <span className={`dir-pill ${dirLabel(p.direction).cls}`}>
                          {dirLabel(p.direction).text}
                        </span>
                      </td>
                      <td className="px-[14px] py-2 border-b border-border text-right num text-text-secondary">
                        {(p.weight * 100).toFixed(2)}%
                      </td>
                      <td className="px-[14px] py-2 border-b border-border num text-text-secondary">
                        {p.jurisdiction}
                      </td>
                      <td className="px-[14px] py-2 border-b border-border text-text-tertiary text-[11.5px] leading-[1.5] max-w-[46ch]">
                        {p.mechanism}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <p className="m-0 px-[18px] py-3 text-[11px] text-text-tertiary leading-[1.6] max-w-[92ch]">
            Exposure is classified by <em>jurisdiction</em>, so a name added to the universe
            is covered the day it appears, and the channel is named rather than scored so a
            reader can disagree with something specific.
            {x.unclassified.length > 0 ? (
              <span style={{ color: "var(--warning)" }}>
                {" "}
                {x.unclassified.length} position(s) could not be classified (
                {x.unclassified.join(", ")}) — their exposure is unknown, not absent.
              </span>
            ) : null}{" "}
            This says what the book would do <em>if</em> pressure rose, not whether it is
            rising — that needs a data source we do not have. Source:{" "}
            <Ident>research_recommendations.sanctions_exposure</Ident>.
          </p>
        </>
      )}
    </section>
  );
}
