"use client";

// /portfolio — what is HELD, as opposed to what is recommended.
//
// THIS ROUTE WAS A REDIRECT, AND UN-RETIRING IT IS A REVERSAL
// -----------------------------------------------------------
// ADR-0025 retired `/portfolio` because it was one of three pages
// (`/trades`, `/portfolio`, `/research`) rendering *the same ten positions* from
// three tables with no cross-links, and ADR-0054 removed the nav entries once the
// consolidation onto `/book` was complete. That reasoning was correct, and it no
// longer applies: there is now a book that is HELD, carried across runs and charged
// for its own trading (ADR-0150), and it is a different object from the book that is
// published. Different positions, different returns, its own tables.
//
// The distinction the old `/portfolio` lacked is exactly the one this page exists to
// draw. See ADR-0151.
//
// WHAT MAKES IT DIFFERENT FROM /book
// ----------------------------------
//   /book       what the research recommends today — a fresh answer each run
//   /portfolio  what a portfolio following that research actually owns, having
//               paid to get there
//
// On the live history those disagree by more than the return: the published series
// reads +0.76% and the held book −0.72%.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { EmptyState, QueryErrorState } from "@/components/status/EmptyState";
import { CostDrag, type HoldingsPerformanceRow } from "@/components/risk/CostDrag";
import { ProvenanceStrip } from "@/components/status/ProvenanceStrip";
import { ENFORCED } from "@/lib/mandate";
import { fmtPct, fmtUSD } from "@/lib/book/format";
import type { Pick } from "@/lib/book/types";

interface HoldingRow {
  run_date: string;
  asset: string;
  signed_weight: number;
  target_weight: number | null;
}

const CAPITAL = ENFORCED.total_capital.value;

/**
 * Below this, a held weight and its target are the same number.
 *
 * `book_holdings.signed_weight` is `REAL` — float32, ~7 significant digits — so a
 * target of 0.05740866 stores and reads back as 0.0574087. Differencing that against
 * the float64 value in `picks` leaves ~4e-8 of pure representation error on EVERY
 * row, which at a 1e-9 threshold made a fully-rebalanced portfolio report that it had
 * drifted from the book on all nine names.
 *
 * That is ADR-0068's lesson in a second place: a breach — or here a divergence — must
 * not be decided by floating-point storage. 1e-6 matches `optimizer.WEIGHT_DUST`,
 * which the sizer already justifies as the point below which a position is not a
 * trade: on $100M it is $100. Two orders above the observed error, four below a
 * basis point.
 */
const DRIFT_EPSILON = 1e-6;

export default function PortfolioPage() {
  const [holdings, setHoldings] = useState<HoldingRow[]>([]);
  const [perf, setPerf] = useState<HoldingsPerformanceRow[]>([]);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [publishedCum, setPublishedCum] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [holdRes, perfRes, bookRes, cumRes] = await Promise.all([
        supabase
          .from("book_holdings")
          .select("run_date, asset, signed_weight, target_weight")
          .order("run_date", { ascending: false })
          .limit(200),
        supabase
          .from("book_holdings_performance")
          .select(
            "run_date, turnover, cost_pct, cost_usd, gross_return, net_return, nav, tracking_error",
          )
          .order("run_date")
          .limit(2000),
        supabase
          .from("research_recommendations")
          .select("run_date, picks")
          .order("run_date", { ascending: false })
          .limit(1),
        supabase
          .from("portfolio_cumulative_return")
          .select("as_of, cumulative_value")
          .order("as_of", { ascending: false })
          .limit(1),
      ]);

      if (holdRes.error) {
        setError(holdRes.error.message);
        setLoading(false);
        return;
      }

      // Latest vintage only. Mixing run dates would show a portfolio that was never
      // held on any single day.
      const rows = (holdRes.data as HoldingRow[] | null) ?? [];
      const latest = rows[0]?.run_date ?? null;
      setHoldings(rows.filter((r) => r.run_date === latest));
      setPerf((perfRes.data as HoldingsPerformanceRow[] | null) ?? []);

      const book = bookRes.data?.[0] as { picks: Pick[] | string } | undefined;
      setPicks(
        Array.isArray(book?.picks)
          ? (book!.picks as Pick[])
          : typeof book?.picks === "string"
            ? (JSON.parse(book.picks) as Pick[])
            : [],
      );

      const cum = cumRes.data?.[0] as { cumulative_value: number } | undefined;
      setPublishedCum(cum?.cumulative_value != null ? cum.cumulative_value - 1 : null);
      setLoading(false);
    }
    load();
  }, []);

  const latestPerf = perf.length ? perf[perf.length - 1] : null;
  const nav = latestPerf?.nav ?? null;
  const netCumulative = nav !== null ? nav / CAPITAL - 1 : null;

  const gross = useMemo(
    () => holdings.reduce((s, h) => s + Math.abs(h.signed_weight), 0),
    [holdings],
  );
  const net = useMemo(
    () => holdings.reduce((s, h) => s + h.signed_weight, 0),
    [holdings],
  );

  // Where the held book differs from what the book recommends today. Zero while it
  // fully rebalances, and shown anyway — the column has to exist before there is a
  // turnover budget to make it non-zero (ADR-0150).
  const drift = useMemo(() => {
    const held = new Map(holdings.map((h) => [h.asset, h.signed_weight]));
    const target = new Map(
      picks.map((p) => [
        p.asset,
        (p.direction === "short" ? -1 : 1) * Math.abs(p.weight ?? 0),
      ]),
    );
    const names = new Set<string>();
    held.forEach((_v, k) => names.add(k));
    target.forEach((_v, k) => names.add(k));
    const rows: { asset: string; held: number; target: number; delta: number }[] = [];
    names.forEach((asset) => {
      const h = held.get(asset) ?? 0;
      const t = target.get(asset) ?? 0;
      if (h !== 0 || t !== 0) rows.push({ asset, held: h, target: t, delta: h - t });
    });
    return rows.sort((a, b) => Math.abs(b.held) - Math.abs(a.held));
  }, [holdings, picks]);

  const anyDrift = drift.some((r) => Math.abs(r.delta) > DRIFT_EPSILON);

  return (
    <main className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 wide:px-5 pt-7 pb-20">
      <div className="mb-6">
        <h1 className="text-[22px] font-semibold tracking-[-0.01em] m-0 mb-1">
          The Portfolio
        </h1>
        <p className="m-0 text-text-primary text-[14.5px] leading-[1.55] max-w-[80ch]">
          What a portfolio following this research actually owns, having paid to get
          there. Distinct from{" "}
          <Link href="/book" className="text-accent hover:underline">
            the book
          </Link>
          , which is what the research <em>recommends</em> today — a fresh answer each
          run, and one nobody has yet paid to put on.
        </p>
        {netCumulative !== null && publishedCum !== null && (
          <p className="m-0 mt-2 text-text-tertiary text-[12px] leading-[1.5] max-w-[80ch]">
            Since inception the recommendation reads{" "}
            <span className="num">{fmtPct(publishedCum, 2)}</span> and this portfolio{" "}
            <span className="num">{fmtPct(netCumulative, 2)}</span>. The difference is
            what the trading cost.
          </p>
        )}
      </div>

      {loading ? (
        <div className="space-y-4">
          <div className="skeleton h-[110px]" />
          <div className="skeleton h-[300px]" />
        </div>
      ) : error ? (
        <div className="card">
          <QueryErrorState what="The portfolio" message={error} source="book_holdings" />
        </div>
      ) : holdings.length === 0 ? (
        <div className="card">
          <EmptyState
            title="Nothing is held yet"
            cause="book_holdings has no rows. The held book is written by the nightly run from migration 056 onward, and reconstructed by scripts/rebuild_held_book.py."
            remedy="Run scripts/rebuild_held_book.py --apply to rebuild it from the published history."
            source="book_holdings"
          />
        </div>
      ) : (
        <>
          {/* ── The balance sheet ─────────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 bg-bg-surface border border-border rounded-[8px] mb-6 overflow-hidden divide-y md:divide-y-0 md:divide-x divide-border">
            <Stat
              label="NAV"
              value={nav === null ? "—" : fmtUSD(nav)}
              hint={`from ${fmtUSD(CAPITAL)} at inception`}
            />
            <Stat
              label="Since inception"
              value={netCumulative === null ? "—" : fmtPct(netCumulative, 2)}
              hint="net of transaction costs"
              color={
                netCumulative !== null && netCumulative < 0 ? "var(--warning)" : undefined
              }
            />
            <Stat label="Positions" value={String(holdings.length)} hint="names held" />
            <Stat label="Gross" value={fmtPct(gross)} hint="long + short" />
            <Stat
              label="Net"
              value={`${net >= 0 ? "+" : ""}${fmtPct(net)}`}
              hint="long − short"
            />
            <Stat
              label="Last turnover"
              value={latestPerf?.turnover == null ? "—" : fmtPct(latestPerf.turnover, 1)}
              hint={
                latestPerf?.cost_usd == null
                  ? "one-way"
                  : `cost ${fmtUSD(latestPerf.cost_usd)}`
              }
            />
          </div>

          {/* ── Held vs recommended ───────────────────────────────────────── */}
          <div className="card mb-6">
            <div className="card-header">
              <span className="card-title">Held against recommended</span>
              <span className="text-[11px] text-text-tertiary">
                {anyDrift
                  ? "the portfolio has drifted from the book"
                  : "fully rebalanced — no drift"}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <caption className="sr-only">
                  Each held position beside the weight today&rsquo;s published book
                  recommends for it.
                </caption>
                <thead>
                  <tr>
                    {["Name", "Held", "Recommended", "Difference", "Notional"].map(
                      (h, i) => (
                        <th
                          key={h}
                          className={`px-3 py-2 text-[10px] uppercase tracking-[0.1em] text-text-tertiary font-medium border-b border-border bg-bg-elevated ${
                            i === 0 ? "text-left" : "text-right"
                          }`}
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {drift.map((r) => (
                    <tr key={r.asset}>
                      <td className="px-3 py-2 border-b border-border">
                        <span className="num font-medium text-text-primary">
                          {r.asset}
                        </span>{" "}
                        {/* Glyph + wordmark, never hue alone (design goal 3). */}
                        <span
                          className="text-[11px] ml-1.5"
                          style={{ color: r.held < 0 ? "var(--short)" : "var(--long)" }}
                        >
                          {r.held < 0 ? "▼ SHORT" : "▲ LONG"}
                        </span>
                      </td>
                      <td className="px-3 py-2 border-b border-border text-right num">
                        {fmtPct(Math.abs(r.held))}
                      </td>
                      <td className="px-3 py-2 border-b border-border text-right num text-text-secondary">
                        {r.target === 0 ? "—" : fmtPct(Math.abs(r.target))}
                      </td>
                      <td
                        className="px-3 py-2 border-b border-border text-right num"
                        style={
                          Math.abs(r.delta) > DRIFT_EPSILON
                            ? { color: "var(--warning)" }
                            : { color: "var(--text-tertiary)" }
                        }
                      >
                        {Math.abs(r.delta) < DRIFT_EPSILON ? "—" : fmtPct(r.delta)}
                      </td>
                      <td className="px-3 py-2 border-b border-border text-right num text-text-secondary">
                        {fmtUSD(r.held * CAPITAL)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="m-0 px-4 py-3 text-[11.5px] text-text-tertiary leading-[1.6] border-t border-border max-w-[92ch]">
              {anyDrift ? (
                <>
                  The gap between held and recommended is tracking error, and it is what
                  a turnover budget buys: less trading, at the cost of holding something
                  other than today&rsquo;s answer.
                </>
              ) : (
                <>
                  The portfolio rebalances fully to each published book, so there is no
                  tracking error to show. That is a choice, not a measurement — a
                  turnover budget would create one, and none is applied because{" "}
                  <span className="num">max_turnover</span> has never been set to
                  anything, and picking a number to make this column non-zero would be
                  fitting a parameter to a preferred answer.
                </>
              )}
            </p>
          </div>

          {/* ── The cost, in full. The SAME component /risk mounts, never a copy. ── */}
          <CostDrag rows={perf} publishedCumulative={publishedCum} capital={CAPITAL} />

          <ProvenanceStrip
            className="px-0"
            cadence="Extended once per run, 21:30 UTC weekdays"
            source="book_holdings + book_holdings_performance"
            note="net of transaction costs · ADR-0150"
          />

          <div className="mt-6 text-[12px] text-text-secondary">
            The recommendation this tracks is on{" "}
            <Link href="/book" className="text-accent hover:underline">
              the book
            </Link>
            . To size these names under a different mandate, or to test dropping one,
            use the{" "}
            <Link href="/workbench" className="text-accent hover:underline">
              workbench
            </Link>
            . The limits the book is built under are on{" "}
            <Link href="/risk#mandate" className="text-accent hover:underline">
              risk
            </Link>
            .
          </div>
        </>
      )}
    </main>
  );
}

function Stat({
  label,
  value,
  hint,
  color,
}: {
  label: string;
  value: string;
  hint?: string;
  color?: string;
}) {
  return (
    <div className="px-4 py-3">
      <div className="text-[10px] uppercase tracking-[0.1em] text-text-tertiary font-semibold leading-none mb-1">
        {label}
      </div>
      <div className="num text-[16px] font-semibold leading-[1.1]" style={{ color }}>
        {value}
      </div>
      {hint && (
        <div className="text-[10.5px] text-text-secondary mt-1 leading-[1.35]">{hint}</div>
      )}
    </div>
  );
}
