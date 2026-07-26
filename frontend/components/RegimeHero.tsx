import RegimeInputsPanel from "./RegimeInputsPanel";

interface Factor { name: string; beta: number }
interface RegimeHeroProps {
  cycle: "early" | "mid" | "late" | "recession" | string;
  sentiment: "risk-on" | "neutral" | "risk-off" | string;
  headline: string;
  narrative: string;
  cycleSubtext?: string;
  volSubtext?: string;
  factors?: Factor[];
  cycleLabel?: string;
  volLabel?: string;
  /** Optional date to scope the regime inputs panel to a specific run. */
  runDate?: string;
  /**
   * Share of the book's gross weight covered by a usable factor regression
   * (R² ≥ 0.10), from `portfolio_factor_exposure.coverage`. A tilt computed over
   * half the book is not the same claim as one computed over all of it, so it is
   * labelled rather than presented bare.
   */
  factorCoverage?: number | null;
  /** Why the factor tilt is absent. Shown instead of a bare "awaiting" string. */
  factorUnavailableReason?: string;
}

const CYCLE_BADGE: Record<string, string> = {
  early: "badge-warning",
  mid: "badge-tier-anchor",
  late: "badge-warning",
  recession: "badge-warning",
};

const CYCLE_LABEL: Record<string, string> = {
  early: "EARLY",
  mid: "MID",
  late: "LATE",
  recession: "RECESSION",
};

const SENTIMENT_LABEL: Record<string, string> = {
  "risk-on": "RISK-ON",
  neutral: "NEUTRAL",
  "risk-off": "RISK-OFF",
};

function FactorBar({ name, beta }: Factor) {
  const widthPct = Math.min(Math.abs(beta) / 2, 1) * 25; // half-track each side, 50% max
  return (
    <div className="grid grid-cols-[60px_1fr_60px] items-center gap-3 text-[12px] mb-1.5">
      <span className="num text-[12px]">{name}</span>
      <div className="h-1.5 bg-border rounded-sm relative overflow-hidden">
        <div className="absolute left-1/2 top-[-2px] bottom-[-2px] w-px bg-text-tertiary" />
        <div
          className={`absolute top-0 bottom-0 h-full rounded-r-sm ${
            beta < 0 ? "bg-short rounded-l-sm right-1/2" : "bg-long left-1/2"
          }`}
          style={{ width: `${widthPct}%` }}
        />
      </div>
      <span
        className={`num text-right ${beta < 0 ? "text-short" : "text-long"}`}
      >
        {beta >= 0 ? "+" : ""}
        {beta.toFixed(2)}
      </span>
    </div>
  );
}

export default function RegimeHero({
  cycle,
  sentiment,
  headline,
  narrative,
  cycleSubtext,
  volSubtext,
  factors = [],
  cycleLabel,
  volLabel,
  runDate,
  factorCoverage,
  factorUnavailableReason,
}: RegimeHeroProps) {
  return (
    <div
      // ADR-0103: at lg the page is a locked terminal, where this block was taking
      // 263px of an 814px shell -- a third of the viewport for orientation. The lg:
      // overrides tighten padding, gap and headline ONLY inside the lock; below the
      // breakpoint the page still scrolls and the original spacing is correct there.
      className="rounded-[12px] p-7 lg:p-4 mb-6 lg:mb-0 grid gap-8 lg:gap-5 border border-border grid-cols-1 md:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr]"
      style={{
        // Ledger light theme: a pale crimson wash into paper gives the hero
        // presence without a dark slab (which left every token-coloured ink
        // string inside it invisible).
        background: "linear-gradient(180deg, rgba(159,23,42,0.06) 0%, #ffffff 100%)",
      }}
    >
      <div>
        <div className="flex items-center gap-2.5 mb-2">
          <span className="text-[11px] uppercase tracking-[0.15em] text-text-secondary">Macro Regime</span>
          <span className={`badge ${CYCLE_BADGE[cycle] ?? "badge-neutral"}`}>
            {CYCLE_LABEL[cycle] ?? cycle.toUpperCase()}
          </span>
          <span className={`badge ${sentiment === "risk-on" ? "badge-neutral" : sentiment === "risk-off" ? "badge-warning" : "badge-neutral"}`}>
            {SENTIMENT_LABEL[sentiment] ?? sentiment.toUpperCase()}
          </span>
        </div>
        <div className="text-[20px] lg:text-[16px] font-semibold leading-[1.3] mb-1.5">{headline}</div>
        <div className="text-text-secondary text-[13px] lg:text-[12px] leading-[1.6]">{narrative}</div>
        <RegimeInputsPanel runDate={runDate} />
      </div>

      <div>
        <div className="text-[11px] uppercase tracking-[0.1em] text-text-tertiary mb-2">Cycle indicator</div>
        <div className="text-[18px] font-semibold mb-0.5">{cycleLabel ?? CYCLE_LABEL[cycle] ?? cycle}</div>
        <div className="text-[12px] text-text-secondary">{cycleSubtext ?? "—"}</div>
        <div className="mt-3.5">
          <div className="text-[11px] uppercase tracking-[0.1em] text-text-tertiary mb-2">Vol regime</div>
          <div className="text-[18px] font-semibold mb-0.5">{volLabel ?? "—"}</div>
          <div className="text-[12px] text-text-secondary">{volSubtext ?? "—"}</div>
        </div>
      </div>

      <div>
        <div className="text-[11px] uppercase tracking-[0.1em] text-text-tertiary mb-2.5">
          Factor tilt of book
        </div>
        {factors.length > 0 ? (
          <>
            {factors.map((f) => (
              <FactorBar key={f.name} {...f} />
            ))}
            {typeof factorCoverage === "number" && (
              <div
                className="text-[10.5px] text-text-tertiary mt-2"
                title="Share of gross book weight with a usable FF5+UMD regression (R² ≥ 0.10)"
              >
                Coverage {(factorCoverage * 100).toFixed(0)}% of gross
                {factorCoverage < 0.999 && (
                  <span className="text-warning ml-1">
                    · tilt describes the covered sleeve only
                  </span>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="text-text-tertiary text-[12px] py-2 leading-[1.55]">
            {factorUnavailableReason ??
              "No book-level factor tilt for the latest run."}
          </div>
        )}
      </div>
    </div>
  );
}
