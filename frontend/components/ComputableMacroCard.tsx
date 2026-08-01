// frontend/components/ComputableMacroCard.tsx
//
// The three computable-from-existing-data macro analytics, rendered
// as a small card on the homepage (ADR-0217, ADR-0222). The card
// surfaces the same JSONB column the L5 reasoning agent cites, so
// a reader of the L5 thesis can land on the homepage and see the
// metric the L5 was citing.
//
// Three rows, one per metric. Each row reports status, the primary
// value (or N/A), and a one-line context. Status follows ADR-0098:
// `measured` is a real number; `unknown` is rendered as N/A, not as
// zero. A reader who lands on an empty JSONB sees an honest "no data
// published yet", not a fake "0.00".

export interface ComputableMetric {
  status?: string | null;
  as_of?: string | null;
  reason?: string | null;
  // erp
  erp_pct?: number | null;
  earnings_yield_pct?: number | null;
  spx_pe?: number | null;
  ust10_pct?: number | null;
  eps_as_of?: string | null;
  // equity_bond_corr
  corr?: number | null;
  n_pairs?: number | null;
  lookback_days?: number | null;
  socgen_flip_active?: boolean | null;
  // ndx_seasonality
  n_observations?: number | null;
  per_month?: unknown[] | null;
  midterm?: Record<string, unknown> | null;
  window?: { start_year?: number; end_year?: number } | null;
  [k: string]: unknown;
}

export interface ComputableMacro {
  erp?: ComputableMetric | null;
  equity_bond_corr?: ComputableMetric | null;
  ndx_seasonality?: ComputableMetric | null;
}

interface Props {
  cm: ComputableMacro | null | undefined;
}

function statusLabel(s: string | null | undefined): string {
  if (!s || s === "unknown") return "unknown";
  if (s === "measured") return "measured";
  if (s === "insufficient_history") return "partial";
  return s;
}

function statusInk(s: string | null | undefined): string {
  if (s === "measured") return "text-emerald-400";
  if (s === "insufficient_history") return "text-amber-400";
  return "text-text-tertiary";
}

export default function ComputableMacroCard({ cm }: Props) {
  if (!cm || typeof cm !== "object") {
    return (
      <div className="card p-4">
        <div className="text-xs uppercase tracking-wide text-text-tertiary">
          Computable Macro (L3a)
        </div>
        <div className="mt-2 text-sm text-text-secondary">
          No data published yet. The L3a runner writes here after each
          daily refresh; an empty value is itself a state, not an error.
        </div>
      </div>
    );
  }

  const erp = cm.erp;
  const eqb = cm.equity_bond_corr;
  const ndx = cm.ndx_seasonality;

  return (
    <div className="card p-4">
      <div className="flex items-baseline justify-between">
        <div className="text-xs uppercase tracking-wide text-text-tertiary">
          Computable Macro (L3a)
        </div>
        <a
          href="/facts"
          className="text-[11px] text-text-tertiary hover:text-text-primary underline decoration-zinc-700"
        >
          full structured facts →
        </a>
      </div>

      <div className="mt-3 divide-y divide-border">
        {/* ERP */}
        <div className="py-2 first:pt-0 flex items-baseline justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-medium text-text-primary">
              ERP (earnings yield − 10y)
            </div>
            <div className="text-[11px] text-text-tertiary">
              {erp?.as_of
                ? `as of ${String(erp.as_of).slice(0, 10)}`
                : "no run date"}
              {typeof erp?.spx_pe === "number" && (
                <> · P/E {erp.spx_pe.toFixed(2)}</>
              )}
              {typeof erp?.ust10_pct === "number" && (
                <> · ust10 {erp.ust10_pct.toFixed(2)}%</>
              )}
            </div>
          </div>
          <div className="text-right">
            <div className="font-mono text-base text-text-primary">
              {erp?.erp_pct !== null && erp?.erp_pct !== undefined
                ? `${erp.erp_pct.toFixed(2)}%`
                : "N/A"}
            </div>
            <div
              className={`text-[11px] ${statusInk(erp?.status)}`}
            >
              {statusLabel(erp?.status)}
            </div>
          </div>
        </div>

        {/* Equity-bond correlation */}
        <div className="py-2 flex items-baseline justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-medium text-text-primary">
              Equity-bond correlation
            </div>
            <div className="text-[11px] text-text-tertiary">
              {eqb?.as_of
                ? `as of ${String(eqb.as_of).slice(0, 10)}`
                : "no run date"}
              {typeof eqb?.n_pairs === "number" && (
                <> · {eqb.n_pairs} pairs · {eqb?.lookback_days ?? 60}d</>
              )}
              {typeof eqb?.socgen_flip_active === "boolean" && (
                <>
                  {" "}· SocGen flip:{" "}
                  <span
                    className={
                      eqb.socgen_flip_active
                        ? "text-amber-300"
                        : "text-text-tertiary"
                    }
                  >
                    {eqb.socgen_flip_active ? "ACTIVE" : "inactive"}
                  </span>
                </>
              )}
            </div>
          </div>
          <div className="text-right">
            <div className="font-mono text-base text-text-primary">
              {typeof eqb?.corr === "number"
                ? eqb.corr.toFixed(2)
                : "N/A"}
            </div>
            <div
              className={`text-[11px] ${statusInk(eqb?.status)}`}
            >
              {statusLabel(eqb?.status)}
            </div>
          </div>
        </div>

        {/* NDX seasonality */}
        <div className="py-2 last:pb-0 flex items-baseline justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-medium text-text-primary">
              NDX seasonality
            </div>
            <div className="text-[11px] text-text-tertiary">
              {ndx?.as_of
                ? `as of ${String(ndx.as_of).slice(0, 10)}`
                : "no run date"}
              {typeof ndx?.n_observations === "number" && (
                <> · {ndx.n_observations} monthly bars</>
              )}
              {ndx?.window && (
                <>
                  {" "}·{" "}
                  {ndx.window.start_year}–{ndx.window.end_year}
                </>
              )}
            </div>
          </div>
          <div className="text-right">
            <div className="font-mono text-base text-text-primary">
              {ndx?.n_observations
                ? `${ndx.n_observations}`
                : "—"}
            </div>
            <div
              className={`text-[11px] ${statusInk(ndx?.status)}`}
            >
              {statusLabel(ndx?.status)}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3 text-[11px] text-text-tertiary">
        Status follows ADR-0098 — measured/unknown, never zero.{" "}
        <a
          href="/facts"
          className="underline decoration-zinc-700 hover:text-text-primary"
        >
          View the full structured_facts table
        </a>
        .
      </div>
    </div>
  );
}
