"use client";
import {
  explainGap,
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

type Position = SanctionsExposureRow["positions"][number];

/** One entry per jurisdiction, carrying its mechanism and the names held in it. */
function channels(
  positions: Position[],
): Array<{ jurisdiction: string; mechanism: string; assets: string[] }> {
  const out: Array<{ jurisdiction: string; mechanism: string; assets: string[] }> = [];
  for (const p of positions) {
    const hit = out.find((c) => c.jurisdiction === p.jurisdiction);
    if (hit) hit.assets.push(p.asset);
    else out.push({ jurisdiction: p.jurisdiction, mechanism: p.mechanism, assets: [p.asset] });
  }
  return out;
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
          {/* Figures, not a sentence — matching PositioningCrowding. The strip previously
              opened "NET SHORT sanctions risk · 30.2% of gross" directly above a persisted
              summary opening "The book is NET SHORT sanctions risk: 30.2% of gross…", so the
              card said the same thing twice before a reader reached anything new. The
              summary renders verbatim by design, so the strip is what changes. */}
          <div className="flex flex-wrap gap-x-8 gap-y-3 px-[18px] py-3 border-b border-border">
            <div>
              <div
                className="num text-[20px] font-semibold leading-[1.1]"
                style={tone.warn ? { color: "var(--warning)" } : undefined}
              >
                {isNum(x.share_of_gross) ? `${(x.share_of_gross * 100).toFixed(1)}%` : "—"}
              </div>
              <div className="text-[10.5px] uppercase tracking-[0.09em] text-text-tertiary mt-0.5">
                of gross exposed
              </div>
            </div>
            <div>
              {/* Direction word, pp, 1dp — the summary's own convention. It read
                  "net -17.94%" beside prose saying "held net short by 17.9pp": one figure
                  with a different sign convention, unit and precision in each place. */}
              <div className="num text-[20px] font-semibold leading-[1.1]">
                {x.net_weight < 0 ? "short" : "long"}{" "}
                {Math.abs(x.net_weight * 100).toFixed(1)}pp
              </div>
              <div className="text-[10.5px] uppercase tracking-[0.09em] text-text-tertiary mt-0.5">
                net exposure
              </div>
            </div>
            <div>
              <div
                className="text-[13px] font-semibold leading-[1.1] pt-1"
                style={tone.warn ? { color: "var(--warning)" } : undefined}
              >
                {tone.label}
              </div>
              {/* Keyed on DIRECTION, not on the warning tone. `warn` is true only for the
                  net-long case, so using it here would have told a flat or unexposed book
                  that escalation is a tailwind — a claim about the side, asserted from a
                  flag that does not carry the side. */}
              <div className="text-[10.5px] uppercase tracking-[0.09em] text-text-tertiary mt-1">
                {x.direction === "short"
                  ? "escalation is a tailwind"
                  : x.direction === "long"
                    ? "escalation is a headwind"
                    : "escalation is roughly neutral"}
              </div>
            </div>
          </div>

          {/* The persisted sentence, verbatim. The page must not restate the direction in
              different words from the module that decided it. */}
          <p className="m-0 px-[18px] py-3 text-[12.5px] text-text-secondary leading-[1.6] max-w-[86ch] border-b border-border">
            {x.summary}
          </p>

          {x.positions.length > 0 ? (
            <div className="overflow-x-auto">
              {/* 420, not the 640 this carried when it had a fifth CHANNEL column: the old
                  width forced a 4-column table into an inner scroller on mobile, showing
                  only NAME and SIDE while the reader scrolled for WEIGHT. Wide content may
                  scroll in its own container (goal 7), but it should not be made wide. */}
              <table className="w-full border-collapse text-[12.5px] min-w-[420px]">
                <caption className="sr-only">
                  Positions in sanctions-exposed jurisdictions, with the side held and the
                  named channel of exposure.
                </caption>
                <thead>
                  <tr>
                    {["Name", "Side", "Weight", "Jurisdiction"].map((h, i) => (
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {/* The channel, once per JURISDICTION rather than once per row. It was a table
              column, which printed the identical two-line China paragraph against both PDD
              and BABA — roughly 40% of the card spent saying one thing twice, and degrading
              linearly with each China name added. The mechanism is a property of the
              jurisdiction, so it belongs where the jurisdiction is named. */}
          {channels(x.positions).length > 0 ? (
            <dl className="m-0 px-[18px] py-3 border-t border-border">
              {channels(x.positions).map((c) => (
                <div key={c.jurisdiction} className="mb-2 last:mb-0">
                  <dt className="num text-[12px] text-text-primary">
                    {c.jurisdiction}
                    <span className="text-text-tertiary font-normal">
                      {" "}
                      · {c.assets.join(", ")}
                    </span>
                  </dt>
                  <dd className="m-0 mt-0.5 text-[11.5px] text-text-tertiary leading-[1.55] max-w-[92ch]">
                    {c.mechanism}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}

          <p className="m-0 px-[18px] py-3 text-[11px] text-text-tertiary leading-[1.6] max-w-[92ch]">
            Exposure is classified by <em>jurisdiction</em>, so a name added to the universe
            is covered the day it appears, and the channel is named rather than scored so a
            reader can disagree with something specific.
            {x.unclassified.length > 0 ? (
              <span style={{ color: "var(--warning)" }}>
                {" "}
                {x.unclassified.length}{" "}
                {x.unclassified.length === 1 ? "position" : "positions"} could not be
                classified (
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
