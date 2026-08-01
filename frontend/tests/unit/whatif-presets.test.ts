// frontend/tests/unit/whatif-presets.test.ts
//
// The preset shock paths for the What-if scenario builder
// (lib/risk/whatIfPresets.ts, consumed by components/risk/WhatIfScenario.tsx).
//
// The interesting failure modes are the ones that would not show up in a
// screenshot, and all of them live here rather than in the component:
//
//   1. a preset names a shock outside a slider's bounds — the slider would then
//      clamp the value on render, so the dropdown and the five inputs could
//      disagree about what the story actually is, with nothing on screen
//      saying so;
//   2. a preset id collides or a label/description is missing — the dropdown
//      then offers an option it cannot describe or cannot tell apart;
//   3. a preset does not set every one of the five drivers — the estimator
//      sums over all five factor shocks, so a partial preset silently reads as
//      "zero" for whatever key was forgotten.

import { describe, expect, it } from "vitest";
import {
  CUSTOM_PRESET_ID,
  WHAT_IF_PRESETS,
  presetById,
  type WhatIfShockState,
} from "@/lib/risk/whatIfPresets";

// Mirrors CONTROLS in WhatIfScenario.tsx. Duplicated deliberately: if the two
// drift, this test is exactly the alarm that was supposed to fire.
const SLIDER_BOUNDS: Record<keyof WhatIfShockState, { min: number; max: number }> = {
  mkt: { min: -30, max: 30 },
  rates: { min: -100, max: 100 },
  usd: { min: -10, max: 10 },
  credit: { min: -100, max: 300 },
  vix: { min: -20, max: 40 },
};

describe("what-if presets", () => {
  it("the Custom preset resets every shock to zero", () => {
    const custom = presetById(CUSTOM_PRESET_ID);
    expect(custom).toBeDefined();
    expect(Object.values(custom!.shocks).every((v) => v === 0)).toBe(true);
  });

  it("every preset has a unique id, a label and a description", () => {
    const ids = new Set<string>();
    for (const p of WHAT_IF_PRESETS) {
      expect(p.label.length, `label for ${p.id}`).toBeGreaterThan(0);
      expect(p.description.length, `description for ${p.id}`).toBeGreaterThan(0);
      expect(ids.has(p.id), `duplicate preset id ${p.id}`).toBe(false);
      ids.add(p.id);
    }
  });

  it("every preset's shocks stay within the slider bounds", () => {
    for (const p of WHAT_IF_PRESETS) {
      for (const key of Object.keys(SLIDER_BOUNDS) as (keyof WhatIfShockState)[]) {
        const b = SLIDER_BOUNDS[key];
        const v = p.shocks[key];
        expect(v, `${p.id}.${key}`).toBeGreaterThanOrEqual(b.min);
        expect(v, `${p.id}.${key}`).toBeLessThanOrEqual(b.max);
      }
    }
  });

  it("every preset sets all five drivers explicitly", () => {
    for (const p of WHAT_IF_PRESETS) {
      expect(Object.keys(p.shocks).sort()).toEqual(
        Object.keys(SLIDER_BOUNDS).sort(),
      );
    }
  });

  it("the requested named stories are present", () => {
    const labels = WHAT_IF_PRESETS.map((p) => p.label);
    for (const want of [
      "Taiwan hot war",
      "AI bubble collapse",
      "China AI beats US AI",
    ]) {
      expect(labels).toContain(want);
    }
  });

  it("presetById resolves ids and returns undefined for unknowns", () => {
    expect(presetById("taiwan-war")?.label).toBe("Taiwan hot war");
    expect(presetById("no-such-preset")).toBeUndefined();
  });
});
