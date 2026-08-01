// frontend/lib/risk/whatIfPresets.ts
//
// Preset shock paths for the What-if scenario builder.
//
// A preset is a named set of values for the five macro sliders the builder
// exposes (MKT / 10y rates / USD / HY credit / VIX). Picking one is shorthand
// for a documented macro story; the sliders stay live underneath, so a preset
// is a starting point, not a cage. The numbers are judgement calls about how
// each story would first hit the five drivers the builder can express - they
// are not forecasts, and toFactorShocks (WhatIfScenario.tsx) maps them onto
// the factor space the book is actually exposed to.

export type WhatIfShockState = Record<
  "mkt" | "rates" | "usd" | "credit" | "vix",
  number
>;

export interface WhatIfPreset {
  id: string;
  label: string;
  /** One line on what the story is, shown under the dropdown when selected. */
  description: string;
  shocks: WhatIfShockState;
}

export const CUSTOM_PRESET_ID = "custom";

export const WHAT_IF_PRESETS: WhatIfPreset[] = [
  {
    id: CUSTOM_PRESET_ID,
    label: "Custom",
    description: "Set the five shocks by hand, or pick a named story below.",
    shocks: { mkt: 0, rates: 0, usd: 0, credit: 0, vix: 0 },
  },
  {
    id: "risk-off",
    label: "Broad risk-off",
    description:
      "Equities down, bonds bid, dollar bid, credit wider, volatility up.",
    shocks: { mkt: -12, rates: -40, usd: 3, credit: 80, vix: 15 },
  },
  {
    id: "taiwan-war",
    label: "Taiwan hot war",
    description:
      "A conflict over Taiwan shocks the semiconductor chain: equities down hard, yields down (flight to safety), USD bid, credit much wider, volatility spiked.",
    shocks: { mkt: -20, rates: -60, usd: 4, credit: 150, vix: 28 },
  },
  {
    id: "ai-bubble",
    label: "AI bubble collapse",
    description:
      "The mega-cap AI complex de-rates: equities down hard, yields down, USD soft, credit wider, volatility up.",
    shocks: { mkt: -25, rates: -50, usd: -2, credit: 120, vix: 30 },
  },
  {
    id: "china-ai",
    label: "China AI beats US AI",
    description:
      "The US loses AI leadership to China: US equities and USD down, yields down, credit wider, volatility up.",
    shocks: { mkt: -15, rates: -30, usd: -4, credit: 70, vix: 15 },
  },
  {
    id: "rate-shock",
    label: "Hawkish rate shock",
    description:
      "A hawkish repricing: 10y yields up, USD bid, equities down, credit wider, volatility up.",
    shocks: { mkt: -8, rates: 90, usd: 3, credit: 50, vix: 10 },
  },
  {
    id: "credit-crisis",
    label: "Credit selloff",
    description:
      "Financial stress: spreads blow out, equities down, yields down, USD bid, volatility up.",
    shocks: { mkt: -10, rates: -20, usd: 2, credit: 200, vix: 20 },
  },
  {
    id: "melt-up",
    label: "Melt-up (risk-on)",
    description:
      "Risk-on: equities up, yields up, USD soft, credit tighter, volatility lower.",
    shocks: { mkt: 15, rates: 25, usd: -2, credit: -40, vix: -8 },
  },
];

export function presetById(id: string): WhatIfPreset | undefined {
  return WHAT_IF_PRESETS.find((p) => p.id === id);
}
