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
}

const CYCLE_BADGE: Record<string, string> = {
  early: "badge-warning",
  mid: "badge-tier-anchor",
  late: "badge-warning",
  recession: "badge-short",
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
            beta < 0 ? "bg-short rounded-l-sm right-1/2" : "bg-accent left-1/2"
          }`}
          style={{ width: `${widthPct}%` }}
        />
      </div>
      <span
        className={`num text-right ${beta < 0 ? "text-short" : "text-accent"}`}
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
}: RegimeHeroProps) {
  return (
    <div
      className="rounded-[12px] p-7 mb-6 grid gap-8 border border-border"
      style={{ background: "linear-gradient(180deg, #131822 0%, #0e131c 100%)", gridTemplateColumns: "1.4fr 1fr 1fr" }}
    >
      <div>
        <div className="flex items-center gap-2.5 mb-2">
          <span className="text-[11px] uppercase tracking-[0.15em] text-text-secondary">Macro Regime</span>
          <span className={`badge ${CYCLE_BADGE[cycle] ?? "badge-neutral"}`}>
            {CYCLE_LABEL[cycle] ?? cycle.toUpperCase()}
          </span>
          <span className={`badge ${sentiment === "risk-on" ? "badge-long" : sentiment === "risk-off" ? "badge-short" : "badge-neutral"}`}>
            {SENTIMENT_LABEL[sentiment] ?? sentiment.toUpperCase()}
          </span>
        </div>
        <div className="text-[20px] font-semibold leading-[1.3] mb-1.5">{headline}</div>
        <div className="text-text-secondary text-[13px] leading-[1.6]">{narrative}</div>
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
        <div className="text-[11px] uppercase tracking-[0.1em] text-text-tertiary mb-2.5">Factor tilt of book</div>
        {factors.length > 0 ? (
          factors.map((f) => <FactorBar key={f.name} {...f} />)
        ) : (
          <div className="text-text-tertiary text-[12px] py-2">Awaiting factor run…</div>
        )}
      </div>
    </div>
  );
}
