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
// So the row is stacked instead: label + status, then value / limit / headroom
// as a three-up micro-grid, then the utilisation bar, then the note and the
// limit's source. Nothing was dropped — every column of the old table is still
// on screen, and each figure keeps a word naming what it is, because a bare
// "62.4% 100% +37.6%" with no column heading above it is three naked numbers
// (goal 1). One rendering, at every width: the same list serves the quarter
// column here and a phone, where the 820px table was already scrolling.

"use client";
import {
  type LimitRow,
  countByStatus,
  NEAR_LIMIT_FRACTION,
} from "@/lib/risk/riskBoard";
import { LIMIT_STATUS_CHIPS } from "@/lib/risk/riskChips";
import { isNum } from "@/lib/risk/analytics";
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

export function RiskLimitBoard({
  loading,
  rows,
  coverageNote,
}: {
  loading: boolean;
  rows: LimitRow[];
  /** One-line note on which inputs were unavailable, if any. */
  coverageNote?: string | null;
}) {
  const counts = countByStatus(rows);
  const anyConfig = rows.some((r) => r.limitSource === "scoring_config");

  return (
    <section className="card mb-6" aria-labelledby="risk-limits-heading">
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
          <p className="m-0 px-[18px] pt-3.5 text-[12px] text-text-secondary leading-[1.6] max-w-[92ch]">
            Every governing limit, breached-first, with the fraction consumed and the
            remaining headroom. A limit reads from{" "}
            <Ident>scoring_config</Ident> where a row exists; otherwise it is a house
            default, marked as such — a default is a convention, not a hard rule. The{" "}
            {(NEAR_LIMIT_FRACTION * 100).toFixed(0)}% tick is where a limit starts to
            bind.
          </p>

          <ul
            className="m-0 mt-3 list-none p-0 border-t border-border-strong"
            aria-label="Risk limits with current value, limit, utilisation, headroom and status, sorted with breaches first."
          >
            {rows.map((row) => {
              const meta = LIMIT_STATUS_CHIPS[row.status];
              return (
                <li
                  key={row.key}
                  className="px-[18px] py-3 border-b border-border hover:bg-bg-elevated"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[13px] text-text-primary font-medium">
                      {row.label}
                    </span>
                    <span className={`badge ${meta.cls} shrink-0`}>{meta.label}</span>
                  </div>

                  {/* Value / Limit / Headroom, each under the word that names it.
                      These were three headed columns; a heading per figure is what
                      replaces the <thead> a list does not have. */}
                  {/* max-w so the three stay a cluster below `xl`, where this card
                      is full width — at 960px an uncapped 3-col grid puts 320px
                      between a value and the word naming it. It does not bind in
                      the 280px column, which is the width it was shaped for. */}
                  <dl className="m-0 mt-2 grid grid-cols-3 gap-x-2 max-w-[520px]">
                    <div>
                      <dt className="text-[9.5px] uppercase tracking-[0.08em] text-text-tertiary">
                        Value
                      </dt>
                      <dd
                        className={`m-0 num text-[12px] ${
                          row.status === "breached"
                            ? "text-warning-deep"
                            : row.status === "near"
                              ? "text-warning"
                              : row.value === null
                                ? "text-text-tertiary"
                                : "text-text-primary"
                        }`}
                      >
                        {fmtByUnit(row.value, row.unit)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[9.5px] uppercase tracking-[0.08em] text-text-tertiary">
                        Limit
                      </dt>
                      <dd className="m-0 num text-[12px] text-text-secondary">
                        {fmtByUnit(row.limit, row.unit)}
                      </dd>
                    </div>
                    <div className="text-right">
                      <dt className="text-[9.5px] uppercase tracking-[0.08em] text-text-tertiary">
                        Headroom
                      </dt>
                      <dd
                        className={`m-0 num text-[12px] ${
                          // Not the signed-value exemption: headroom < 0 IS the
                          // breach, restated as a negative number, so it must match
                          // the value above. Leaving it crimson would put two
                          // different hues on one breached row.
                          row.headroom === null
                            ? "text-text-tertiary"
                            : row.headroom < 0
                              ? "text-warning-deep"
                              : "text-text-secondary"
                        }`}
                      >
                        {fmtHeadroom(row.headroom, row.unit)}
                      </dd>
                    </div>
                  </dl>

                  <div className="mt-2 flex items-center gap-2">
                    <UtilBar row={row} />
                    <span className="num text-[11px] text-text-tertiary whitespace-nowrap w-[42px] text-right">
                      {row.utilisation === null
                        ? "—"
                        : `${(row.utilisation * 100).toFixed(0)}%`}
                    </span>
                  </div>

                  <p className="m-0 mt-2 text-[11px] text-text-tertiary leading-[1.5] max-w-[80ch]">
                    {row.note}
                  </p>
                  <span
                    className="inline-block mt-1 text-[10px] uppercase tracking-[0.08em] text-text-tertiary"
                    title={
                      row.limitSource === "scoring_config"
                        ? "Limit read live from scoring_config"
                        : "No scoring_config row — house default"
                    }
                  >
                    {row.limitSource === "scoring_config"
                      ? "limit · scoring_config"
                      : "limit · house default"}
                  </span>
                </li>
              );
            })}
          </ul>

          <p className="m-0 px-[18px] py-3 text-[11px] text-text-tertiary leading-[1.6] max-w-[92ch]">
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
