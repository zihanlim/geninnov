// What running this book actually costs.
//
// The published curve on this page sums weight x price return and subtracts
// nothing, on a book whose measured mean one-way turnover is 95.1% per run. The
// caveat beside that curve says so in prose. This panel says it in numbers, because
// a reader who is told a series is "gross of costs" still has no idea whether that
// means 20bps or the entire return.
//
// On the live history it is the entire return: the published series reads +0.76%
// and the same book net of its own trading costs reads -0.72%. The sign flips.
//
// (Read the LATEST cumulative_value, never MAX() over the series -- that returns the
// historical peak and overstates the gap. It briefly did, in an earlier draft.)
//
// WHY IT SITS BESIDE THE OLD SERIES RATHER THAN REPLACING IT
// -----------------------------------------------------------
// ADR-0093 requires that a published figure which changes says so, and ADR-0112
// refuses to write a derived series into the table a reader already quotes. So the
// two are shown together and the difference is the point. Silently swapping one for
// the other would be the quiet correction both ADRs exist to prevent.

import { fmtPct } from "@/lib/book/format";

export interface HoldingsPerformanceRow {
  run_date: string;
  turnover: number | null;
  cost_pct: number | null;
  cost_usd: number | null;
  gross_return: number | null;
  net_return: number | null;
  nav: number | null;
  tracking_error: number | null;
}

const usd = (v: number) =>
  `${v < 0 ? "-" : ""}$${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

function Ident({ children }: { children: React.ReactNode }) {
  return <span className="num text-[10.5px] text-text-tertiary">{children}</span>;
}

export function CostDrag({
  rows,
  publishedCumulative,
  capital,
}: {
  rows: HoldingsPerformanceRow[];
  /** portfolio_cumulative_return.cumulative_value − 1, the series already on this page. */
  publishedCumulative: number | null;
  capital: number;
}) {
  if (!rows.length) {
    return null;
  }

  const ordered = [...rows].sort((a, b) => a.run_date.localeCompare(b.run_date));
  const latest = ordered[ordered.length - 1];
  const netCumulative =
    latest.nav !== null && capital > 0 ? latest.nav / capital - 1 : null;

  const totalCost = ordered.reduce((s, r) => s + (r.cost_usd ?? 0), 0);
  const turnovers = ordered.map((r) => r.turnover).filter((t): t is number => t !== null);
  const meanTurnover = turnovers.length
    ? turnovers.reduce((s, t) => s + t, 0) / turnovers.length
    : null;

  const gap =
    publishedCumulative !== null && netCumulative !== null
      ? publishedCumulative - netCumulative
      : null;
  // A sign flip is a different order of error from an overstatement, and the copy
  // should not have to be rewritten by hand when it stops being true.
  const flips =
    publishedCumulative !== null &&
    netCumulative !== null &&
    publishedCumulative > 0 &&
    netCumulative < 0;

  return (
    <section className="card mb-6" id="cost-drag">
      <div className="card-header">
        <span className="card-title">What the trading costs</span>
        <span className="text-[11px] text-text-tertiary">
          the same book, net of its own turnover
        </span>
      </div>

      <div className="card-body">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          <Figure
            label="Published series"
            value={publishedCumulative === null ? "—" : fmtPct(publishedCumulative, 2)}
            hint="gross of costs"
            source="portfolio_cumulative_return"
          />
          <Figure
            label="Net of costs"
            value={netCumulative === null ? "—" : fmtPct(netCumulative, 2)}
            hint="the same positions, having paid to trade"
            source="book_holdings_performance.nav"
            tone={netCumulative !== null && netCumulative < 0 ? "warning" : "default"}
          />
          <Figure
            label="Difference"
            value={gap === null ? "—" : `${fmtPct(gap, 2)}`}
            hint={`over ${ordered.length} session${ordered.length === 1 ? "" : "s"}`}
            source="derived, browser-side"
            tone="warning"
          />
          <Figure
            label="Mean turnover"
            value={meanTurnover === null ? "—" : fmtPct(meanTurnover, 1)}
            hint={`one-way, per run · ${usd(totalCost)} paid`}
            source="book_holdings_performance.turnover"
          />
        </div>

        <p className="m-0 text-[12.5px] text-text-secondary leading-[1.6] max-w-[92ch]">
          {flips ? (
            <>
              <span className="font-semibold text-text-primary">
                The difference is larger than the return.
              </span>{" "}
              The published series is positive and the same book, having paid to put
              its own trades on, is negative. That is not a rounding adjustment — it
              is the difference between a strategy and a P&amp;L.
            </>
          ) : (
            <>
              <span className="font-semibold text-text-primary">
                Trading is not free, and the published series assumes it is.
              </span>{" "}
              The figures above are the same positions with the cost of reaching them
              deducted.
            </>
          )}{" "}
          The book reconstitutes itself every run, so the cost is charged every run.
          Priced at <Ident>cost_model.py</Ident>&rsquo;s 10bps commission plus a 5bps
          half-spread, with <span className="font-medium">no market-impact term</span>{" "}
          — which understates a large trade in a thin name, so the real drag is worse
          than this, not better.
        </p>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-[12.5px]">
            <caption className="sr-only">
              Per-run turnover, transaction cost, and gross versus net return of the
              held book.
            </caption>
            <thead>
              <tr>
                {["Run", "Turnover", "Cost", "Gross", "Net", "NAV"].map((h, i) => (
                  <th
                    key={h}
                    className={`px-3 py-2 text-[10px] uppercase tracking-[0.1em] text-text-tertiary font-medium border-b border-border bg-bg-elevated ${
                      i === 0 ? "text-left" : "text-right"
                    }`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ordered.map((r) => (
                <tr key={r.run_date}>
                  <td className="px-3 py-2 border-b border-border num">{r.run_date}</td>
                  <td className="px-3 py-2 border-b border-border text-right num">
                    {r.turnover === null ? "—" : fmtPct(r.turnover, 1)}
                  </td>
                  <td className="px-3 py-2 border-b border-border text-right num text-warning-deep">
                    {r.cost_pct === null ? "—" : `−${fmtPct(r.cost_pct, 3)}`}
                  </td>
                  <td className="px-3 py-2 border-b border-border text-right num">
                    {/* A run whose price data was incomplete shows an em dash and its
                        reason, never a 0% that would read as a flat day (ADR-0066). */}
                    {r.gross_return === null ? (
                      <span
                        className="text-text-tertiary"
                        title="A held name had no price for this session, so the return is not computable — this is not a flat day."
                      >
                        —
                      </span>
                    ) : (
                      fmtPct(r.gross_return, 3)
                    )}
                  </td>
                  <td className="px-3 py-2 border-b border-border text-right num font-medium">
                    {r.net_return === null ? (
                      <span className="text-text-tertiary">—</span>
                    ) : (
                      fmtPct(r.net_return, 3)
                    )}
                  </td>
                  <td className="px-3 py-2 border-b border-border text-right num text-text-secondary">
                    {r.nav === null ? "—" : `$${(r.nav / 1_000_000).toFixed(2)}M`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="m-0 mt-3 pt-3 border-t border-border text-[11.5px] text-text-tertiary leading-[1.6] max-w-[92ch]">
          The held book fully rebalances to each published recommendation, so its
          tracking error is zero by construction. A turnover budget would reduce this
          cost, and none is applied: <Ident>max_turnover</Ident> has existed in the
          optimizer since ADR-0107 with nothing ever setting it, and choosing a number
          to make this figure smaller would be fitting a parameter to a preferred
          answer. Source <Ident>book_holdings_performance</Ident>.
        </p>
      </div>
    </section>
  );
}

function Figure({
  label,
  value,
  hint,
  source,
  tone = "default",
}: {
  label: string;
  value: string;
  hint: string;
  source: string;
  tone?: "default" | "warning";
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.1em] text-text-tertiary font-semibold mb-1">
        {label}
      </div>
      <div
        className="num text-[20px] font-semibold leading-[1.15]"
        style={{ color: tone === "warning" ? "var(--warning)" : "var(--text-primary)" }}
      >
        {value}
      </div>
      <div className="text-[11px] text-text-secondary mt-1 leading-[1.4]">{hint}</div>
      <div className="mt-1">
        <Ident>{source}</Ident>
      </div>
    </div>
  );
}
