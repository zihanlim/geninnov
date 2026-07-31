// components/LensSelector.tsx — a "pure UI" segmented control, so its rendered
// markup is checked directly via SSR (renderToString), the same pattern
// track-record-panel.test.tsx uses for its own static-props checks. No click
// simulation: onChange is exercised by BookBody's own wiring, not here.

import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import LensSelector, { LENS_OPTIONS, lensToAssetClasses } from "@/components/LensSelector";

describe("LensSelector", () => {
  it("renders the full six-lens set when `lenses` is omitted", () => {
    const html = renderToString(
      <LensSelector value="multi_asset" onChange={() => {}} />,
    );
    for (const opt of LENS_OPTIONS) {
      expect(html).toContain(opt.label);
    }
  });

  it("renders ONLY the lenses it is given — the /book toggle's contract", () => {
    // The live shape as of 2026-07-30: only multi_asset and credit have a
    // published book. A control offering "Rates Only" with no book behind it is
    // worse than no control at all, so restricting the option list must
    // actually remove the button, not just skip highlighting it.
    const html = renderToString(
      <LensSelector value="multi_asset" onChange={() => {}} lenses={["multi_asset", "credit"]} />,
    );
    expect(html).toContain("Multi-Asset");
    expect(html).toContain("Credit Lens");
    expect(html).not.toContain("Rates Only");
    expect(html).not.toContain("Equity");
    expect(html).not.toContain("FX");
    expect(html).not.toContain("Commodity");
  });

  it("names the active lens for assistive tech even when it is not in the restricted set", () => {
    // Defensive: should never happen (the active value is always resolved from
    // the same `available` list), but the sr-only label falls back to the raw
    // value rather than throwing if it ever does.
    const html = renderToString(
      <LensSelector value="rates" onChange={() => {}} lenses={["multi_asset", "credit"]} />,
    );
    expect(html).toContain("rates");
  });

  it("marks the active button with aria-pressed, not colour alone", () => {
    const html = renderToString(
      <LensSelector value="credit" onChange={() => {}} lenses={["multi_asset", "credit"]} />,
    );
    expect(html).toMatch(/aria-pressed="true"[^]*Credit Lens/);
  });
});

describe("lensToAssetClasses", () => {
  it("returns null (no filter) for multi_asset", () => {
    expect(lensToAssetClasses("multi_asset")).toBeNull();
  });

  it("maps credit to both credit and rates asset classes", () => {
    expect(lensToAssetClasses("credit")).toEqual(["credit", "rates"]);
  });
});
