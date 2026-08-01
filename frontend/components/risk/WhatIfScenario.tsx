// frontend/components/risk/WhatIfScenario.tsx
//
// An interactive companion to the persisted stress scenarios: the PM sets shocks
// on MKT / rates / USD / credit / VIX and the estimated book return recomputes
// live from Σ(signed_weight × factor beta × shock) over the sized positions and
// their factor_exposures betas. This is a BEST-EFFORT model estimate — the same
// factor-path arithmetic the backend uses, run in the browser against live
// sliders — and is labelled as such. Positions with no regression are excluded
// and named, never zero-filled.
//
// Rates / USD / credit / VIX are not FF5 factors, so they are mapped onto the
// factor space through documented, adjustable proxies (see PROXY_NOTE): they
// nudge the market and value/momentum betas the way those macro moves
// historically do. The mapping is transparent so a PM can discount it.

"use client";
import { useMemo, useState } from "react";
import {
  type PositionRow,
  type FactorExposureRow,
  type FactorShocks,
  estimateWhatIf,
} from "@/lib/risk/riskBoard";
import { isNum } from "@/lib/risk/analytics";
import {
  CUSTOM_PRESET_ID,
  WHAT_IF_PRESETS,
  type WhatIfShockState,
} from "@/lib/risk/whatIfPresets";
import { Ident, SectionSkeleton } from "./SectionGap";

interface ShockControl {
  key: "mkt" | "rates" | "usd" | "credit" | "vix";
  label: string;
  hint: string;
  /** Slider bounds in percentage points. */
  min: number;
  max: number;
  step: number;
}

const CONTROLS: ShockControl[] = [
  { key: "mkt", label: "Equity (MKT)", hint: "SPX total return shock", min: -30, max: 30, step: 1 },
  { key: "rates", label: "Rates (10y)", hint: "+ = yields up / bonds down", min: -100, max: 100, step: 5 },
  { key: "usd", label: "USD (DXY)", hint: "+ = dollar stronger", min: -10, max: 10, step: 0.5 },
  { key: "credit", label: "Credit (HY OAS)", hint: "+ = spreads wider / credit sells off", min: -100, max: 300, step: 10 },
  { key: "vix", label: "Volatility (VIX)", hint: "+ = vol spike", min: -20, max: 40, step: 1 },
];

/** The five macro drivers, keyed the same as `WhatIfShockState`. */
type ShockState = WhatIfShockState;

const ZERO_STATE: ShockState = { mkt: 0, rates: 0, usd: 0, credit: 0, vix: 0 };

/**
 * Map the five macro sliders onto FF5 + UMD factor-return shocks. MKT is a direct
 * market-return shock. The macro sliders are translated into factor space through
 * documented proxies: a rates/credit/USD/VIX move co-moves the market and the
 * value/momentum factors with a historically-motivated sign and a small gain, so
 * the estimate reflects the second-order factor path, not just a naive beta hit.
 * These gains are intentionally conservative and adjustable in one place.
 */
function toFactorShocks(s: ShockState): FactorShocks {
  const mkt = s.mkt / 100;
  const ratesBp = s.rates; // basis points
  const usdPct = s.usd / 100;
  const creditBp = s.credit; // basis points of OAS
  const vixPts = s.vix; // absolute VIX points

  // Proxy translations (decimals). Small, transparent, historically-signed.
  // Rising yields: mild market drag, value up / momentum down (rotation).
  const ratesMkt = (-ratesBp / 100) * 0.03;
  const ratesHml = (ratesBp / 100) * 0.04;
  const ratesUmd = (-ratesBp / 100) * 0.02;
  // Stronger USD: market drag, headwind for cyclicals (SMB down).
  const usdMkt = -usdPct * 0.4;
  const usdSmb = -usdPct * 0.3;
  // Wider credit spreads: market and small-cap selloff, quality bid.
  const creditMkt = (-creditBp / 100) * 0.05;
  const creditSmb = (-creditBp / 100) * 0.04;
  const creditRmw = (creditBp / 100) * 0.02;
  // VIX spike: direct market drawdown proxy, momentum reversal.
  const vixMkt = -(vixPts / 100) * 0.6;
  const vixUmd = -(vixPts / 100) * 0.3;

  return {
    mkt: mkt + ratesMkt + usdMkt + creditMkt + vixMkt,
    smb: usdSmb + creditSmb,
    hml: ratesHml,
    rmw: creditRmw,
    cma: 0,
    umd: ratesUmd + vixUmd,
  };
}

const fmtSignedPct = (v: number, dp = 2): string =>
  `${v >= 0 ? "+" : "−"}${(Math.abs(v) * 100).toFixed(dp)}%`;
const fmtSignedM = (v: number): string =>
  `${v >= 0 ? "+" : "−"}$${Math.abs(v).toFixed(1)}M`;

export function WhatIfScenario({
  loading,
  positions,
  factors,
  totalCapital,
  dataFailure,
  compact = false,
}: {
  loading: boolean;
  positions: PositionRow[];
  factors: Record<string, FactorExposureRow>;
  totalCapital: number | null;
  /** Set when positions or factor_exposures failed to load. */
  dataFailure?: string | null;
  /**
   * Renders the sliders and the live result stacked vertically, for a card in a
   * narrow (1/4) column. The normal layout is a two-column grid whose right
   * track is a fixed 320px live-result panel — at ~318px of card that would be
   * one track at 0px, so `compact` switches the whole body to a single column.
   */
  compact?: boolean;
}) {
  const [shocks, setShocks] = useState<ShockState>(ZERO_STATE);
  // Which named story the sliders currently describe. "custom" means the reader
  // has moved a slider (or cleared the board), so the preset is no longer what
  // the five values say. The dropdown reflects that honestly instead of
  // pretending a story still holds after its shocks were hand-edited.
  const [presetId, setPresetId] = useState<string>(CUSTOM_PRESET_ID);

  /** Load a named story into the sliders. Custom keeps the current values. */
  const applyPreset = (id: string) => {
    const p = WHAT_IF_PRESETS.find((x) => x.id === id);
    setPresetId(id);
    if (p) setShocks(p.shocks);
  };

  const factorShocks = useMemo(() => toFactorShocks(shocks), [shocks]);
  const result = useMemo(
    () => estimateWhatIf(positions, factors, factorShocks),
    [positions, factors, factorShocks],
  );

  const capital = isNum(totalCapital) && totalCapital > 0 ? totalCapital : null;
  const dollarPnl =
    capital !== null ? (result.bookReturn * capital) / 1_000_000 : null;
  const anyShock = Object.values(shocks).some((v) => v !== 0);
  const covered = result.contributions.length;
  const excluded = result.missingFactorAssets.length + result.missingWeightAssets.length;

  return (
    <section className="card mb-6" aria-labelledby="risk-whatif-heading">
      <div className="card-header">
        <h2 id="risk-whatif-heading" className="card-title m-0">
          What-if scenario builder
        </h2>
        <span className="text-[11px] text-text-tertiary num">estimate · live</span>
      </div>

      {loading ? (
        <SectionSkeleton height={260} />
      ) : dataFailure ? (
        <div className="px-[18px] py-6 text-[13px]" role="alert">
          <div className="pl-4 border-l-2 max-w-[80ch]" style={{ borderColor: "var(--short)" }}>
            <p className="m-0 mb-1.5 font-medium text-text-primary">
              Cannot build what-if — inputs unavailable
            </p>
            <p className="m-0 text-text-secondary leading-[1.6]">{dataFailure}</p>
          </div>
        </div>
      ) : positions.length === 0 ? (
        <div className="px-[18px] py-6 text-[13px]">
          <div className="pl-4 border-l-2 max-w-[80ch]" style={{ borderColor: "var(--border-strong)" }}>
            <p className="m-0 mb-1.5 font-medium text-text-primary">No sized book to shock</p>
            <p className="m-0 text-text-secondary leading-[1.6]">
              <Ident>portfolio_positions</Ident> is empty for the latest run, so there is
              nothing to apply a shock to. Re-run the pipeline once positions are sized.
            </p>
          </div>
        </div>
      ) : (
        <div className="card-body">
          <div
            className={`grid gap-6 ${compact ? "grid-cols-1" : "md:grid-cols-[1fr_320px]"}`}
          >
            {/* Sliders */}
            <div>
              {/* Preset stories. A named path is a starting point, not a cage:
                  the sliders underneath stay live and any manual move marks the
                  state "custom" again, because the preset label would otherwise
                  lie about what the five values say. */}
              <div className="mb-4">
                <label
                  htmlFor="whatif-preset"
                  className="block text-[11px] uppercase tracking-[0.09em] text-text-tertiary mb-1"
                >
                  Preset scenario
                </label>
                <select
                  id="whatif-preset"
                  value={presetId}
                  onChange={(e) => applyPreset(e.target.value)}
                  className="filter-btn w-full cursor-pointer"
                  aria-label="Preset what-if scenario"
                >
                  {WHAT_IF_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
                {presetId !== CUSTOM_PRESET_ID && (
                  <p className="m-0 mt-2 text-[11.5px] text-text-tertiary leading-[1.55]">
                    {WHAT_IF_PRESETS.find((p) => p.id === presetId)?.description}
                  </p>
                )}
              </div>
              <p className="m-0 mb-4 text-[12px] text-text-secondary leading-[1.6] max-w-[70ch]">
                Set a shock on each driver; the estimated book return recomputes live as
                Σ(signed weight × factor β × factor shock) over the{" "}
                <span className="num">{covered}</span> position
                {covered === 1 ? "" : "s"} with a regression. This is a model estimate
                from historical betas, not a forecast.
              </p>
              <div className="space-y-4">
                {CONTROLS.map((c) => (
                  <div key={c.key}>
                    <div className="flex items-baseline justify-between mb-1">
                      <label
                        htmlFor={`whatif-${c.key}`}
                        className="text-[12px] text-text-primary font-medium"
                      >
                        {c.label}
                        <span className="text-text-tertiary font-normal ml-2 text-[11px]">
                          {c.hint}
                        </span>
                      </label>
                      <span
                        className={`num text-[12px] w-[64px] text-right ${
                          shocks[c.key] === 0
                            ? "text-text-tertiary"
                            : shocks[c.key] > 0
                              ? "text-accent"
                              : "text-short"
                        }`}
                      >
                        {shocks[c.key] > 0 ? "+" : ""}
                        {shocks[c.key]}
                        {c.key === "mkt" || c.key === "usd"
                          ? "%"
                          : c.key === "vix"
                            ? "pt"
                            : "bp"}
                      </span>
                    </div>
                    <input
                      id={`whatif-${c.key}`}
                      type="range"
                      min={c.min}
                      max={c.max}
                      step={c.step}
                      value={shocks[c.key]}
                      onChange={(e) => {
                        // Hand-editing a shock invalidates the preset label.
                        if (presetId !== CUSTOM_PRESET_ID) setPresetId(CUSTOM_PRESET_ID);
                        setShocks((prev) => ({ ...prev, [c.key]: Number(e.target.value) }));
                      }}
                      className="w-full accent-[var(--accent)] cursor-pointer"
                      aria-label={`${c.label} shock`}
                    />
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="filter-btn mt-4"
                onClick={() => {
                  setShocks(ZERO_STATE);
                  setPresetId(CUSTOM_PRESET_ID);
                }}
                disabled={!anyShock}
              >
                Reset shocks
              </button>
            </div>

            {/* Live result */}
            <div className="bg-bg-elevated border border-border rounded-lg p-4 self-start">
              <div className="text-[11px] uppercase tracking-[0.1em] text-text-tertiary mb-1">
                Estimated book return
              </div>
              <div
                className={`num text-[30px] font-semibold leading-[1.05] ${
                  !anyShock
                    ? "text-text-tertiary"
                    : result.bookReturn < 0
                      ? "text-short"
                      : result.bookReturn > 0
                        ? "text-long"
                        : "text-text-secondary"
                }`}
              >
                {anyShock ? fmtSignedPct(result.bookReturn) : "0.00%"}
              </div>
              <div className="num text-[14px] text-text-secondary mt-1">
                {dollarPnl === null ? (
                  <span className="text-text-tertiary">$ P&amp;L — no total_capital</span>
                ) : (
                  <span
                    className={
                      dollarPnl < 0 ? "text-short" : dollarPnl > 0 ? "text-long" : "text-text-secondary"
                    }
                  >
                    {fmtSignedM(dollarPnl)}
                  </span>
                )}
              </div>

              <div className="mt-4 pt-3 border-t border-border text-[11px] text-text-tertiary leading-[1.6]">
                <div>
                  Covered <span className="num text-text-secondary">{covered}</span> of{" "}
                  <span className="num text-text-secondary">{positions.length}</span>{" "}
                  positions.
                </div>
                {excluded > 0 && (
                  <div className="mt-1">
                    Excluded (no regression):{" "}
                    <span className="num">
                      {[...result.missingFactorAssets, ...result.missingWeightAssets]
                        .slice(0, 8)
                        .join(", ")}
                      {excluded > 8 ? " …" : ""}
                    </span>
                  </div>
                )}
              </div>

              {anyShock && result.contributions.length > 0 && (
                <div className="mt-3 pt-3 border-t border-border">
                  <div className="text-[10px] uppercase tracking-[0.1em] text-text-tertiary mb-1.5">
                    Top movers
                  </div>
                  <ul className="m-0 p-0 list-none space-y-1">
                    {result.contributions.slice(0, 4).map((c) => (
                      <li key={c.asset} className="flex justify-between text-[11px]">
                        <span className="num text-text-secondary">
                          {c.asset}
                          <span
                            className={c.direction === "long" ? "text-long" : "text-short"}
                          >
                            {" "}
                            {c.direction === "long" ? "L" : "S"}
                          </span>
                        </span>
                        <span
                          className={`num ${
                            c.contribution < 0 ? "text-short" : "text-long"
                          }`}
                        >
                          {fmtSignedPct(c.contribution)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>

          <p className="m-0 mt-4 pt-3.5 border-t border-border text-[11px] text-text-tertiary leading-[1.6] max-w-[94ch]">
            <strong className="text-text-secondary">Estimate, not a forecast.</strong>{" "}
            MKT is a direct market-return shock. Rates, USD, credit and VIX are not FF5
            factors, so they are translated into factor-return space through documented,
            conservative proxies in{" "}
            <Ident>WhatIfScenario.tsx → toFactorShocks</Ident> (e.g. wider credit spreads
            → market and small-cap drag, quality bid). Book return ={" "}
            <span className="num">Σ signed_weight × β × shock</span> over{" "}
            <Ident>portfolio_positions</Ident> × <Ident>factor_exposures</Ident>. Discount
            it accordingly.
          </p>
        </div>
      )}
    </section>
  );
}
