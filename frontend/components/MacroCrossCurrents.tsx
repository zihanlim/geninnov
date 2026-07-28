/**
 * MacroCrossCurrents — the ADR-0139/0140 readings, presented together.
 *
 * Three cards under RegimeHero: dollar-debasement pressure (0–100 composite
 * with its four components as a weighted stacked bar), Fed posture with the
 * 13-week pivot delta, and the cycle × posture readout that keeps the three
 * independent readings (cycle, posture, debasement) from being conflated.
 *
 * Provenance rules, inherited from RegimeHero:
 *  - NULL renders "—" AND names what was missing (ADR-0091 — absence is not
 *    zero, and an unnamed absence is not information).
 *  - The debasement card shows the COMPONENTS with their anchors, not raw
 *    series: the raw inputs are not persisted on the regime row, and deriving
 *    them client-side would be a second implementation of the classifier's
 *    formula (the drift ADR-0064 exists to prevent).
 *  - Posture ink reuses the directional vocabulary (dovish = --long,
 *    hawkish = --short) per ADR-0140: both are a financial-liquidity claim.
 *    The word is always printed beside the colour — colour is never the only
 *    channel (the ADR-0126 discipline).
 */

export interface CrossCurrents {
  debasement_pressure?: number | null;
  debasement_real_yield_comp?: number | null;
  debasement_dxy_decline_comp?: number | null;
  debasement_gold_rise_comp?: number | null;
  debasement_comovement_comp?: number | null;
  debasement_lookback_weeks?: number | null;
  fed_posture?: string | null;
  fed_pivot_delta?: number | null;
  fed_rate_change_13w_bps?: number | null;
  fed_curve_change_13w_bps?: number | null;
  fed_curve_steepness_bps?: number | null;
  fed_posture_evidence?: {
    inputs?: {
      dff_pct?: number | null;
      dgs2_pct?: number | null;
      dgs10_pct?: number | null;
    };
    prior_posture?: string | null;
  } | null;
}

interface MacroCrossCurrentsProps {
  cycle?: string | null;
  cc: CrossCurrents | null;
}

/** ADR-0139's weights — display only; the classifier owns the arithmetic. */
const COMPONENTS = [
  { key: "debasement_real_yield_comp", weight: 30, label: "Real yield vs −2%", cls: "bg-short" },
  { key: "debasement_dxy_decline_comp", weight: 25, label: "DXY off 26w peak vs 5%", cls: "bg-warning" },
  { key: "debasement_gold_rise_comp", weight: 25, label: "Gold 26w return vs +20%", cls: "bg-long" },
  { key: "debasement_comovement_comp", weight: 20, label: "Real-yield↔gold co-move", cls: "bg-text-tertiary" },
] as const;

/** Presentation bands only — they live here, not in the schema (ADR-0139). */
function pressureBand(p: number): string {
  if (p < 25) return "LOW";
  if (p < 50) return "MODERATE";
  if (p < 75) return "ELEVATED";
  return "EXTREME";
}

const POSTURE_STYLE: Record<string, { text: string; label: string }> = {
  dovish: { text: "text-long", label: "DOVISH" },
  neutral: { text: "text-text-secondary", label: "NEUTRAL" },
  hawkish: { text: "text-short", label: "HAWKISH" },
};

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** Which debasement input is missing, named for the card's absence line. */
function missingDebasementInputs(cc: CrossCurrents): string {
  const missing: string[] = [];
  if (cc.debasement_real_yield_comp == null) missing.push("10y real yield (DFII10)");
  if (cc.debasement_dxy_decline_comp == null) missing.push("DXY window");
  if (cc.debasement_gold_rise_comp == null) missing.push("gold 26w start value");
  if (cc.debasement_comovement_comp == null)
    missing.push("co-movement sample (< 60 paired daily observations)");
  return missing.length > 0 ? missing.join(", ") : "an input series";
}

export default function MacroCrossCurrents({ cycle, cc }: MacroCrossCurrentsProps) {
  const pressure = cc?.debasement_pressure ?? null;
  const posture = cc?.fed_posture ?? null;
  const pivot = cc?.fed_pivot_delta ?? null;
  const curveChange = cc?.fed_curve_change_13w_bps ?? null;
  const rateChange = cc?.fed_rate_change_13w_bps ?? null;
  const steep = cc?.fed_curve_steepness_bps ?? null;
  const prior = cc?.fed_posture_evidence?.prior_posture ?? null;
  const inputs = cc?.fed_posture_evidence?.inputs ?? null;
  const lookback = cc?.debasement_lookback_weeks ?? 26;

  const trajectory =
    curveChange == null ? null : curveChange > 15 ? "↑ steepening" : curveChange < -15 ? "↓ flattening" : "→ range-bound";

  return (
    <div
      data-testid="macro-crosscurrents"
      className="grid gap-4 grid-cols-1 md:grid-cols-3 rounded-[12px] p-4 border border-border bg-white"
    >
      {/* ── Card 1: debasement pressure ─────────────────────────────────── */}
      <div>
        <div className="text-[11px] uppercase tracking-[0.1em] text-text-tertiary mb-2">
          Debasement pressure
        </div>
        {pressure != null ? (
          <>
            <div className="flex items-baseline gap-2 mb-2">
              <span className="num text-[22px] font-semibold">{pressure.toFixed(1)}</span>
              <span className="text-[11px] text-text-tertiary">/ 100</span>
              <span className="badge badge-neutral">{pressureBand(pressure)}</span>
            </div>
            {/* Weighted stacked bar: each band is the component's contribution
                (weight × value) out of the 100-point scale, in its own band —
                no legend needed because each row below carries its own value. */}
            <div className="h-2 rounded-sm bg-border overflow-hidden flex mb-2" aria-hidden>
              {COMPONENTS.map((c) => {
                const v = (cc?.[c.key] as number | null) ?? 0;
                return (
                  <div key={c.key} className={c.cls} style={{ width: `${c.weight * v}%` }} />
                );
              })}
            </div>
            <div className="space-y-0.5">
              {COMPONENTS.map((c) => {
                const v = cc?.[c.key] as number | null | undefined;
                return (
                  <div key={c.key} className="flex justify-between text-[11px]">
                    <span className="text-text-secondary">{c.label}</span>
                    <span className="num">{v != null ? v.toFixed(2) : "—"}</span>
                  </div>
                );
              })}
            </div>
            <div className="text-[10.5px] text-text-tertiary mt-2">
              {lookback}-week window · weights 30/25/25/20 · a dial, not a flag
            </div>
          </>
        ) : (
          <div className="text-text-tertiary text-[12px] leading-[1.55]">
            <span className="text-[16px] font-semibold text-text-secondary block mb-1">—</span>
            Not computable this run — missing: {cc ? missingDebasementInputs(cc) : "the regime row"}.
            Absence is not zero.
          </div>
        )}
      </div>

      {/* ── Card 2: Fed posture ─────────────────────────────────────────── */}
      <div>
        <div className="text-[11px] uppercase tracking-[0.1em] text-text-tertiary mb-2">
          Fed posture
        </div>
        {posture != null ? (
          <>
            <div className="flex items-baseline gap-2 mb-1.5">
              <span className={`text-[18px] font-semibold ${POSTURE_STYLE[posture]?.text ?? ""}`}>
                {POSTURE_STYLE[posture]?.label ?? posture.toUpperCase()}
              </span>
              {trajectory && <span className="text-[12px] text-text-secondary">{trajectory}</span>}
            </div>
            <div className="text-[12px] text-text-secondary mb-1">
              {pivot != null && prior != null ? (
                <>
                  Pivot {pivot > 0 ? `+${pivot}` : pivot}: {cap(prior)} → {cap(posture)}
                  {pivot === 0 && " (net unchanged over 13 weeks)"}
                </>
              ) : (
                <>No pivot reading — no posture on record 13 weeks back (a different absence from "no pivot")</>
              )}
            </div>
            <div className="text-[11px] text-text-secondary">
              {rateChange != null && <>DFF {rateChange >= 0 ? "+" : ""}{rateChange.toFixed(0)} bp / 13w</>}
              {curveChange != null && (
                <> · 2s10s {curveChange >= 0 ? "+" : ""}{curveChange.toFixed(0)} bp / 13w</>
              )}
              {steep != null && <> · now {steep >= 0 ? "+" : ""}{steep.toFixed(0)} bp</>}
            </div>
            {inputs && (
              <div className="text-[10.5px] text-text-tertiary mt-2">
                Inputs: DFF {inputs.dff_pct != null ? `${inputs.dff_pct.toFixed(2)}%` : "—"} · 2y{" "}
                {inputs.dgs2_pct != null ? `${inputs.dgs2_pct.toFixed(2)}%` : "—"} · 10y{" "}
                {inputs.dgs10_pct != null ? `${inputs.dgs10_pct.toFixed(2)}%` : "—"}
              </div>
            )}
          </>
        ) : (
          <div className="text-text-tertiary text-[12px] leading-[1.55]">
            <span className="text-[16px] font-semibold text-text-secondary block mb-1">—</span>
            Not computable this run — DFF, DGS2, or DGS10 was missing at a window end. Never
            defaulted to neutral.
          </div>
        )}
      </div>

      {/* ── Card 3: cycle × posture ─────────────────────────────────────── */}
      <div>
        <div className="text-[11px] uppercase tracking-[0.1em] text-text-tertiary mb-2">
          Cycle × posture
        </div>
        <div className="text-[13px] font-semibold mb-2">
          {cycle ?? "—"} × {posture ?? "—"}
        </div>
        <div className="flex gap-1 mb-1.5" role="list" aria-label="Business cycle stages">
          {["early", "mid", "late", "recession"].map((c) => (
            <span
              key={c}
              role="listitem"
              className={`text-[10.5px] px-1.5 py-0.5 rounded-sm border ${
                c === cycle
                  ? "border-text-secondary font-semibold"
                  : "border-border text-text-tertiary"
              }`}
            >
              {c}
            </span>
          ))}
        </div>
        <div className="flex gap-1 mb-2" role="list" aria-label="Fed posture values">
          {["dovish", "neutral", "hawkish"].map((p) => (
            <span
              key={p}
              role="listitem"
              className={`text-[10.5px] px-1.5 py-0.5 rounded-sm border ${
                p === posture
                  ? `border-text-secondary font-semibold ${POSTURE_STYLE[p]?.text ?? ""}`
                  : "border-border text-text-tertiary"
              }`}
            >
              {p}
            </span>
          ))}
        </div>
        <div className="text-[10.5px] text-text-tertiary leading-[1.5]">
          Three independent readings — cycle, posture, debasement — presented side by side so
          "late-cycle" never stands in for "is the dollar being eroded".
        </div>
      </div>
    </div>
  );
}
