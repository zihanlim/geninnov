// frontend/components/risk/RiskLimitBoard.tsx
//
// The board a PM scans first: every governing limit, how much of it the book is
// consuming, and how much headroom remains — breached-first. Limits are read
// from scoring_config where a row exists, else a documented house default; the
// source is shown so a limit is never mistaken for a hard rule when it is a
// convention. A row with no measurable value renders "—" and status "unknown",
// never a green "ok" it did not earn.

"use client";
import {
  type LimitRow,
  type LimitStatus,
  countByStatus,
  NEAR_LIMIT_FRACTION,
} from "@/lib/risk/riskBoard";
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

const STATUS_META: Record<
  LimitStatus,
  { label: string; badge: string; dot: string }
> = {
  breached: { label: "BREACHED", badge: "bg-short-dim text-short", dot: "var(--short)" },
  near: { label: "NEAR", badge: "bg-warning-dim text-warning", dot: "var(--warning)" },
  ok: { label: "OK", badge: "bg-long-dim text-long", dot: "var(--long)" },
  unknown: {
    label: "NO DATA",
    badge: "bg-bg-elevated text-text-tertiary border border-border",
    dot: "var(--border-strong)",
  },
};

function UtilBar({ row }: { row: LimitRow }) {
  const util = row.utilisation;
  const meta = STATUS_META[row.status];
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
        style={{ width: `${fillPct}%`, background: meta.dot }}
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

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px] min-w-[820px]">
              <caption className="sr-only">
                Risk limits with current value, limit, utilisation, headroom and
                status, sorted with breaches first.
              </caption>
              <thead>
                <tr>
                  {["Limit", "Value", "Limit", "Utilisation", "Headroom", "Status"].map(
                    (h, i) => (
                      <th
                        key={h}
                        scope="col"
                        className={`px-[16px] py-[7px] text-[11px] uppercase tracking-[0.1em] text-text-tertiary font-medium border-y border-border bg-bg-elevated ${
                          i === 0 ? "text-left" : i === 3 ? "text-left" : "text-right"
                        }`}
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const meta = STATUS_META[row.status];
                  return (
                    <tr key={row.key} className="hover:bg-bg-elevated align-top">
                      <td className="px-[16px] py-3 border-b border-border">
                        <div className="text-text-primary font-medium">{row.label}</div>
                        <div className="text-[11px] text-text-tertiary leading-[1.5] mt-0.5 max-w-[42ch]">
                          {row.note}
                        </div>
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
                      </td>
                      <td
                        className={`px-[14px] py-3 border-b border-border text-right num ${
                          row.status === "breached"
                            ? "text-short"
                            : row.status === "near"
                              ? "text-warning"
                              : row.value === null
                                ? "text-text-tertiary"
                                : "text-text-primary"
                        }`}
                      >
                        {fmtByUnit(row.value, row.unit)}
                      </td>
                      <td className="px-[14px] py-3 border-b border-border text-right num text-text-secondary">
                        {fmtByUnit(row.limit, row.unit)}
                      </td>
                      <td className="px-[14px] py-3 border-b border-border">
                        <div className="flex items-center gap-2">
                          <UtilBar row={row} />
                          <span className="num text-[11px] text-text-tertiary whitespace-nowrap w-[42px] text-right">
                            {row.utilisation === null
                              ? "—"
                              : `${(row.utilisation * 100).toFixed(0)}%`}
                          </span>
                        </div>
                      </td>
                      <td
                        className={`px-[14px] py-3 border-b border-border text-right num ${
                          row.headroom === null
                            ? "text-text-tertiary"
                            : row.headroom < 0
                              ? "text-short"
                              : "text-text-secondary"
                        }`}
                      >
                        {fmtHeadroom(row.headroom, row.unit)}
                      </td>
                      <td className="px-[16px] py-3 border-b border-border text-right">
                        <span className={`badge ${meta.badge}`}>{meta.label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

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
