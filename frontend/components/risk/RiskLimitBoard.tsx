// frontend/components/risk/RiskLimitBoard.tsx
//
// The board a PM scans first: every governing limit, how much of it the book is
// consuming, and how much headroom remains — breached-first. Limits are read
// from scoring_config where a row exists, else a documented house default; the
// source is shown so a limit is never mistaken for a hard rule when it is a
// convention. A row with no measurable value renders "—" and status "unknown",
// never a green "ok" it did not earn.
//
// WHY THIS IS A LIST AND NOT A TABLE (2026-07-30)
// ----------------------------------------------
// It was a six-column table with `min-w-[820px]`, which was correct while this
// card owned the full canvas. The owner's mandate-row direction gives it ONE
// QUARTER of it — 1336 content − 3×24 gap, /4 = 316px, ~280px inside the card —
// so the table could only have survived as a 3× horizontal scroller inside a
// 280px window. That is the trade RiskBody's own pairing notes call goal 7's
// failure rather than a fix for it.
//
// So the row is stacked instead: label + status, then `value / limit` and the
// headroom on one line, then the utilisation bar, then where the value was read
// from and where the limit came from. One rendering, at every width: the same
// list serves the quarter column here and a phone, where the 820px table was
// already scrolling.
//
// WHY THE PROSE NOTE IS NOT IN THE ROW (ADR-0180)
// -----------------------------------------------
// The first stacked draft kept `row.note` and came out 2250px tall — taller than
// the mandate panel beside it, of which the notes were 33–66px per row. That
// prose is the "what it means" line, and `MandatePanel` — 24px to the left, in
// the card whose entire job is meaning — already carries one for every limit on
// this board. So it moved to the row's `title` and the card's intro points at
// the panel. What did NOT move is the SOURCE: the mandate panel says where a
// LIMIT came from, never where the value measured against it came from, so
// `LimitDef.source` became its own field and renders under every row (goal 1).
// The `value / limit` pair reads as a pair because the intro says so — the same
// idiom, and the same justification, as the CapUtilisation bars beside it.
//
// WHY THE ROWS CARRY THEIR OWN LENS TAG
// -------------------------------------
// Under a non-default lens this board is `scope: "mixed"` (lib/risk/lensScope.ts):
// five of eleven rows are valued from the lens-less tables and six from the
// lens-following analytics row, in one list, under one heading, with one
// OK/BREACH column. `LensScopeBanner` says so at the top of the page and points
// the reader here — "Which rows are which is in each panel's own marker" — and
// until now the panel's marker was a chip that named the panel's TABLES and left
// the reader to work the rows out.
//
// They could, but only by knowing something that is not on screen: that
// `portfolio_risk` has no lens column and `book_metrics` is a JSONB field of one
// that does. `row.source` was already printed under every row (goal 1); what was
// missing was the translation from a table name to whose book it is. So the tag
// renders beside the source it qualifies, at the same size and in the same ink —
// the reader arriving from the banner is already LOOKING for it, so it does not
// need to shout, and five loud chips down a quarter-width column is the noise
// design goal 7 warns about.

"use client";
import {
  type LimitRow,
  countByStatus,
  NEAR_LIMIT_FRACTION,
} from "@/lib/risk/riskBoard";
import { LIMIT_STATUS_CHIPS } from "@/lib/risk/riskChips";
import { isNum } from "@/lib/risk/analytics";
import { DEFAULT_LENS } from "@/lib/book/lensView";
import { lensLabel } from "@/components/LensSelector";
import { showSourceScopeNote, sourceProvenance } from "@/lib/risk/lensScope";
import { Ident } from "./SectionGap";

function fmtByUnit(v: number | null, unit: LimitRow["unit"]): string {
  if (!isNum(v)) return "—";
  switch (unit) {
    case "pct_of_capital":
    case "pct_weight":
      return `${(v * 100).toFixed(1)}%`;
    case "ratio":
      return v.toFixed(2);
    case "score":
      // HHI on the 0–10 000 scale is naturally integer-ish; 3 decimals ("2500.000")
      // read as spurious precision. Whole number with a thousands separator.
      return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  }
}

function fmtHeadroom(v: number | null, unit: LimitRow["unit"]): string {
  if (!isNum(v)) return "—";
  const sign = v >= 0 ? "+" : "−";
  const mag = fmtByUnit(Math.abs(v), unit);
  return `${sign}${mag}`;
}

function UtilBar({ row }: { row: LimitRow }) {
  const util = row.utilisation;
  const meta = LIMIT_STATUS_CHIPS[row.status];
  const fillPct = util === null ? 0 : Math.min(Math.max(util, 0), 1) * 100;
  const overflow = util !== null && util > 1;
  return (
    <div
      className="relative h-2 w-full min-w-[90px] rounded-sm bg-bg-elevated border border-border overflow-hidden"
      role="img"
      aria-label={
        util === null
          ? `${row.label}: utilisation unavailable`
          : `${row.label}: ${(util * 100).toFixed(0)}% of the limit consumed${
              overflow ? " — breached" : ""
            }`
      }
    >
      <div
        className="absolute top-0 bottom-0 w-px bg-border-strong"
        style={{ left: `${NEAR_LIMIT_FRACTION * 100}%` }}
        aria-hidden="true"
      />
      <div
        className="absolute left-0 top-0 bottom-0 rounded-sm"
        style={{ width: `${fillPct}%`, background: meta.fill }}
      />
    </div>
  );
}

/**
 * "This row's value is the multi-asset book's" — beside the source it qualifies.
 *
 * Gates on the LENS itself rather than trusting the call site, the same
 * invariant `LensScopeChip` holds: `showSourceScopeNote` is false for every
 * source at the default lens, so no tag can reach the page a live submission is
 * shown from, whatever a caller passes.
 *
 * Neutral ink, not `--warning`. Nothing here is broken — a limit measured on the
 * multi-asset book is working exactly as ADR-0194 designed it and saying so — and
 * design goal 3 fences the attention register for the day something really is
 * wrong. `text-text-secondary` is one step out of the source line's tertiary,
 * which separates the claim from the table name without borrowing a semantic.
 * It also lands in prose type beside the mono source, so the two do not read as
 * one string.
 */
function RowScopeTag({ lens, source }: { lens: string; source: string }) {
  if (!showSourceScopeNote(lens, source)) return null;
  const unclassified = sourceProvenance(source) === "unclassified";
  return (
    <span
      role="note"
      data-testid="limit-row-scope-tag"
      className="text-text-secondary"
      title={
        unclassified
          ? `${source} is not classified in lib/risk/lensScope.ts, so this row is treated as the multi-asset published book until it is. Assume this value is not the ${lensLabel(lens)} book's.`
          : `${source} has no lens column (ADR-0194 — a second book must not write into the first book's record), so this value is the multi-asset published book's, not the ${lensLabel(lens)} book's. The limit beside it still governs; the measurement is another book's.`
      }
    >
      {" · multi-asset"}
    </span>
  );
}

export function RiskLimitBoard({
  loading,
  rows,
  coverageNote,
  lens = DEFAULT_LENS,
}: {
  loading: boolean;
  rows: LimitRow[];
  /** One-line note on which inputs were unavailable, if any. */
  coverageNote?: string | null;
  /**
   * The lens the page resolved to. Defaults to `multi_asset`, so a call site
   * that has not been taught about lenses renders exactly as it did before —
   * which is also the only correct behaviour for a page pinned to the default.
   */
  lens?: string;
}) {
  const counts = countByStatus(rows);
  const anyConfig = rows.some((r) => r.limitSource === "scoring_config");
  // The rows whose VALUE is the multi-asset book's. Empty at the default lens
  // by contract, so every branch below collapses to the pre-lens rendering.
  const scoped = rows.filter((r) => showSourceScopeNote(lens, r.source));

  return (
    // h-full + flex column: the mandate row aligns its three cards top and
    // bottom (ADR-0181), so this card fills the cell it is given, and the
    // closing note is pinned to the BOTTOM of it rather than floating wherever
    // the eleven rows happen to end. Outside that row the cell is content-height
    // and both are no-ops.
    <section
      className="card mb-6 h-full flex flex-col"
      aria-labelledby="risk-limits-heading"
    >
      <div className="card-header">
        <h2 id="risk-limits-heading" className="card-title m-0">
          Risk-limit board
        </h2>
        <span className="text-[11px] text-text-tertiary num">
          {loading
            ? "…"
            : `${counts.breached} breached · ${counts.near} near · ${counts.ok} ok${
                counts.unknown ? ` · ${counts.unknown} no-data` : ""
              }`}
        </span>
      </div>

      {loading ? (
        <div className="skeleton m-[18px] h-[260px]" aria-hidden="true" />
      ) : (
        <>
          <p className="m-0 px-[18px] pt-3 text-[12px] text-text-secondary leading-[1.55] max-w-[92ch]">
            Every governing limit, breached-first. Each row reads{" "}
            <span className="num">value / limit</span>, the headroom left, and the
            fraction consumed — the {(NEAR_LIMIT_FRACTION * 100).toFixed(0)}% tick is
            where a limit starts to bind. What each limit MEANS is in{" "}
            <a href="#mandate" className="text-accent hover:underline">
              The mandate
            </a>
            ; the line under each row is where its value was read from.
            {/* The split, stated as a count before the reader meets the tags.
                "Some of these rows are another book's" is the sentence the page
                banner already refuses to stop at, and a per-row tag with no
                total leaves a reader unable to tell a board they have finished
                checking from one they have only partly read. */}
            {scoped.length > 0 && (
              <>
                {" "}
                <span className="text-text-primary">
                  {scoped.length} of these {rows.length} rows
                </span>{" "}
                are valued from tables with no lens column, so they are the
                multi-asset published book&rsquo;s whatever lens is selected —
                each is tagged <span className="num">· multi-asset</span> under
                the row. The other {rows.length - scoped.length} are the{" "}
                {lensLabel(lens)} book&rsquo;s own. Every LIMIT applies to both.
              </>
            )}
          </p>

          <ul
            className="m-0 mt-2.5 list-none p-0 border-t border-border-strong"
            aria-label="Risk limits with current value, limit, utilisation, headroom and status, sorted with breaches first."
          >
            {rows.map((row) => {
              const meta = LIMIT_STATUS_CHIPS[row.status];
              return (
                <li
                  key={row.key}
                  className="px-[18px] py-2.5 border-b border-border hover:bg-bg-elevated"
                  // The prose that used to render here. It is on the mandate panel
                  // beside this card, so it is not lost — but a reader hovering one
                  // row should not have to go looking. See ADR-0180.
                  title={row.note}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[13px] text-text-primary font-medium leading-tight">
                      {row.label}
                    </span>
                    <span className={`badge ${meta.cls} shrink-0`}>{meta.label}</span>
                  </div>

                  {/* `value / limit` then the headroom, on one line. The pair reads
                      as a pair because the card's own intro says so — the same
                      idiom, and the same justification, as CapUtilisation's
                      `15.92% / 20.00% (80%)` bars directly beside it. */}
                  <div className="mt-1.5 flex items-baseline justify-between gap-2">
                    <span className="num text-[12.5px]">
                      <span
                        className={
                          row.status === "breached"
                            ? "text-warning-deep"
                            : row.status === "near"
                              ? "text-warning"
                              : row.value === null
                                ? "text-text-tertiary"
                                : "text-text-primary"
                        }
                      >
                        {fmtByUnit(row.value, row.unit)}
                      </span>
                      <span className="text-text-tertiary">
                        {" / "}
                        {fmtByUnit(row.limit, row.unit)}
                      </span>
                    </span>
                    <span className="text-[10.5px] text-text-tertiary whitespace-nowrap">
                      headroom{" "}
                      <span
                        className={`num ${
                          // Not the signed-value exemption: headroom < 0 IS the
                          // breach, restated as a negative number, so it must match
                          // the value beside it. Leaving it crimson would put two
                          // different hues on one breached row.
                          row.headroom === null
                            ? "text-text-tertiary"
                            : row.headroom < 0
                              ? "text-warning-deep"
                              : "text-text-secondary"
                        }`}
                      >
                        {fmtHeadroom(row.headroom, row.unit)}
                      </span>
                    </span>
                  </div>

                  <div className="mt-1.5 flex items-center gap-2">
                    <UtilBar row={row} />
                    <span className="num text-[11px] text-text-tertiary whitespace-nowrap w-[42px] text-right">
                      {row.utilisation === null
                        ? "—"
                        : `${(row.utilisation * 100).toFixed(0)}%`}
                    </span>
                  </div>

                  {/* Why the limit does not govern this book, when it does not.
                      In the row, not a tooltip: a reader seeing an N/A chip on a
                      published risk limit will ask why, and an answer they have to
                      hover for is invisible on touch and absent from Ctrl+F (goal 1).
                      Rendered ABOVE the source line so the scope statement precedes
                      the provenance, since the provenance is still true either way. */}
                  {row.status === "not_applicable" && row.inapplicableReason && (
                    <p className="mt-1.5 mb-0 text-[10px] leading-[1.45] text-text-secondary [overflow-wrap:anywhere]">
                      {row.inapplicableReason}
                    </p>
                  )}

                  {/* Where the VALUE came from, WHOSE BOOK that makes it, then
                      where the LIMIT came from — three different facts, which is
                      why all three are here and none stands in for the others.
                      The scope tag sits between them because it qualifies the
                      source on its left, not the limit on its right: the limit
                      governs this book either way. */}
                  <div className="mt-1.5 text-[10px] leading-[1.4] text-text-tertiary [overflow-wrap:anywhere]">
                    <span className="num">{row.source}</span>
                    <RowScopeTag lens={lens} source={row.source} />
                    <span
                      title={
                        row.limitSource === "scoring_config"
                          ? "Limit read live from scoring_config"
                          : "No scoring_config row — house default"
                      }
                    >
                      {" · limit "}
                      {row.limitSource === "scoring_config"
                        ? "scoring_config"
                        : "house default"}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>

          <p className="m-0 mt-auto px-[18px] py-3 text-[11px] text-text-tertiary leading-[1.6] max-w-[92ch]">
            {coverageNote ? <>{coverageNote} </> : null}
            {anyConfig ? (
              <>
                Cap limits are read from <Ident>scoring_config</Ident>; risk-metric
                limits are house defaults documented in{" "}
                <Ident>lib/risk/riskBoard.ts → DEFAULT_LIMITS</Ident>.
              </>
            ) : (
              <>
                No limit rows found in <Ident>scoring_config</Ident>, so every limit
                shown is a house default from{" "}
                <Ident>lib/risk/riskBoard.ts → DEFAULT_LIMITS</Ident>. Seed{" "}
                <Ident>limit_*</Ident> / <Ident>max_*_weight</Ident> rows to govern
                these from the database.
              </>
            )}
          </p>
        </>
      )}
    </section>
  );
}
