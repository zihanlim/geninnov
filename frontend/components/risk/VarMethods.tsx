// Four VaRs, side by side, each saying what makes it different.
//
// The alternative is what the repo has now: one on a tile and three in the database. The
// first person to surface a second one puts two numbers called "VaR" on a page where they
// differ by an order of magnitude, which is the regression PROGRESS records twice
// (ADR-0082).
//
// The layout leads with HORIZON rather than value, because horizon is where a reader goes
// wrong. Most of the spread between these numbers is √t, not disagreement about method.

"use client";

import type {
  MonteCarloVarRow,
  RiskDecompositionRow,
  RiskRow,
  VarForecastRow,
} from "@/lib/risk/analytics";
import { fanRows, reconcileExAnte, varMethods } from "@/lib/risk/varMethods";
import {
  MonteCarloDistributionChart,
  VarHorizonChart,
} from "@/components/risk/RiskCharts";

function Pct({ value }: { value: number | null }) {
  if (value === null) return <span className="num text-text-tertiary">—</span>;
  return <span className="num">{(value * 100).toFixed(2)}%</span>;
}

export default function VarMethods({
  risk,
  decomposition,
  monteCarlo,
  forecast,
  sessions,
}: {
  risk: RiskRow | null;
  decomposition?: RiskDecompositionRow | null;
  monteCarlo?: MonteCarloVarRow | null;
  forecast?: VarForecastRow | null;
  sessions: number | null;
}) {
  const rows = varMethods(
    risk, decomposition, monteCarlo, forecast, sessions, risk?.total_capital ?? null,
  );
  const reconciliation = reconcileExAnte(decomposition, forecast);
  const fan = fanRows(forecast);
  const anyValue = rows.some((r) => r.value !== null);

  return (
    <section className="card p-4" aria-label="Value at risk by method" data-testid="var-methods">
      <h3 className="text-[13px] font-semibold mb-1">Value at risk, by method</h3>
      <p className="text-[11.5px] text-text-tertiary leading-[1.55] mb-3">
        Four figures, all called VaR, none interchangeable. They differ by{" "}
        <strong>method</strong>, by <strong>horizon</strong> — most of the spread below is
        √t, not disagreement — and by <strong>basis</strong>: realised figures come from the
        book&rsquo;s own return series and are as old as the book; ex-ante figures come from
        the constituents&rsquo; covariance and exist on day one.
      </p>

      <div className="border border-border rounded-md overflow-x-auto">
        <table className="w-full text-[12px] border-collapse">
          <thead>
            <tr className="text-[10.5px] uppercase tracking-wide text-text-tertiary">
              <th className="text-left font-normal px-3 py-1.5">Method</th>
              <th className="text-left font-normal px-3 py-1.5">Basis</th>
              <th className="text-left font-normal px-3 py-1.5">Horizon</th>
              <th className="text-right font-normal px-3 py-1.5">95% loss</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-border align-top">
                <td className="px-3 py-2">
                  <div className="text-text-primary">{r.label}</div>
                  <div className="text-[10.5px] text-text-tertiary leading-[1.5] mt-0.5">
                    {r.note}
                  </div>
                  <div className="text-[10px] text-text-tertiary mt-0.5 num">{r.methodId}</div>
                </td>
                <td className="px-3 py-2 text-text-secondary whitespace-nowrap">
                  {r.basis === "realised" ? "realised" : "ex-ante"}
                </td>
                <td className="px-3 py-2 text-text-secondary whitespace-nowrap">
                  {r.horizonLabel}
                </td>
                <td className="px-3 py-2 text-right">
                  {r.withheld ? (
                    // Withheld is not missing. The number exists in portfolio_risk and is
                    // deliberately not asserted here (ADR-0100).
                    <span className="text-[10.5px] text-text-tertiary leading-[1.4] block max-w-[16rem] ml-auto">
                      {r.withheld}
                    </span>
                  ) : r.absent ? (
                    <span className="text-[10.5px] text-text-tertiary leading-[1.4] block max-w-[16rem] ml-auto">
                      {r.absent}
                    </span>
                  ) : (
                    <Pct value={r.value} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {reconciliation && (
        <p
          className="text-[11px] leading-[1.55] mt-2.5"
          style={{ color: reconciliation.ok ? "var(--text-tertiary)" : "var(--warning)" }}
          data-testid="var-reconciliation"
        >
          {reconciliation.text}
        </p>
      )}

      {fan.length > 0 && (
        <div className="mt-3">
          <div className="text-[11px] text-text-secondary mb-1.5">
            The same ex-ante loss across horizons (95%), by square-root-of-time:
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px]">
            {fan.map((f) => (
              <span key={f.horizonDays} className="text-text-tertiary">
                {f.label} <Pct value={f.p95} />
              </span>
            ))}
          </div>
          <p className="text-[10.5px] text-text-tertiary leading-[1.5] mt-1.5">
            Square-root-of-time assumes IID returns and a stationary covariance. Neither
            holds — volatility clusters — so the longer horizons are a projection under a
            stated assumption, not a forecast. The <strong>1-month</strong> figure is the one
            to read: it is the horizon a published pick is actually scored over.
          </p>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-x-6">
        <MonteCarloDistributionChart data={monteCarlo} />
        <VarHorizonChart data={forecast} />
      </div>

      {!anyValue && (
        <p className="text-[11px] text-text-tertiary leading-[1.55] mt-2.5">
          No method has a publishable figure for this run. That is a statement about the
          sample and the pipeline, not about the book&rsquo;s risk being low.
        </p>
      )}
    </section>
  );
}
