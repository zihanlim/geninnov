// Provider independence of the attention corpus (ADR-0094).
//
// The number this measures is 1: theme_news held 1,005 rows on 2026-07-26 and every one
// carried source = 'brave'. These tests pin the four ways the disclosure could lie.

import { describe, expect, it } from "vitest";
import {
  PIPELINE_SOURCES,
  independenceSentence,
  sourceIndependence,
} from "@/lib/themeProvenance";

const rows = (spec: Record<string, number>) =>
  Object.entries(spec).flatMap(([source, n]) => Array.from({ length: n }, () => ({ source })));

describe("sourceIndependence", () => {
  it("reproduces the live 2026-07-26 state: one provider, Reddit silent", () => {
    const si = sourceIndependence(rows({ brave: 1005 }));
    expect(si.independentSources).toBe(1);
    expect(si.totalItems).toBe(1005);
    expect(si.topSourceShare).toBe(1);
    expect(si.absent).toEqual(["reddit"]);
  });

  it("separates a provider that contributed nothing from one never fetched", () => {
    // `absent` is derived against PIPELINE_SOURCES, not against whatever happens to be in
    // the corpus — otherwise a silent provider is indistinguishable from an absent one.
    expect(PIPELINE_SOURCES).toContain("reddit");
    const si = sourceIndependence(rows({ brave: 10, gdelt: 5 }));
    expect(si.absent).toEqual(["reddit"]);
    expect(si.contributing.map((c) => c.source)).toEqual(["brave", "gdelt"]);
  });

  it("reports an unmeasurable share as null, not as fully concentrated", () => {
    // A share of an empty corpus is not 1.0 — it is unknown (ADR-0066).
    const si = sourceIndependence([]);
    expect(si.totalItems).toBe(0);
    expect(si.topSourceShare).toBeNull();
    expect(si.independentSources).toBe(0);
  });

  it("ignores blank and missing source tags rather than counting them as a provider", () => {
    const si = sourceIndependence([{ source: "brave" }, { source: "" }, { source: null }, {}] as Array<{
      source?: string | null;
    }>);
    expect(si.independentSources).toBe(1);
    expect(si.totalItems).toBe(1);
  });

  it("flags a fallback provider as synthetic and still counts its base name as present", () => {
    // mock_reddit means the stub ran; the score is not a market observation, but reddit was
    // not silent either. Both facts have to survive.
    const si = sourceIndependence(rows({ brave: 8, mock_reddit: 2 }));
    expect(si.syntheticSources).toEqual(["mock_reddit"]);
    expect(si.absent).toEqual([]);
    expect(si.independentSources).toBe(2);
  });

  it("orders providers by contribution, largest first", () => {
    const si = sourceIndependence(rows({ reddit: 3, brave: 30 }));
    expect(si.contributing[0].source).toBe("brave");
    expect(si.topSourceShare).toBeCloseTo(30 / 33, 6);
  });
});

describe("independenceSentence", () => {
  it("says single-sourced, and says there is no corroboration", () => {
    const s = independenceSentence(sourceIndependence(rows({ brave: 1005 })));
    expect(s).toMatch(/single-sourced/i);
    expect(s).toMatch(/no cross-provider corroboration/i);
    expect(s).toContain("reddit");   // names what is missing, not just what is present
  });

  it("does not claim a count when nothing was collected", () => {
    const s = independenceSentence(sourceIndependence([]));
    expect(s).toMatch(/unknown/i);
    expect(s).not.toMatch(/single-sourced/i);
  });

  it("reports the real count and the top share once there are several", () => {
    const s = independenceSentence(sourceIndependence(rows({ brave: 30, reddit: 10 })));
    expect(s).toMatch(/2 providers/);
    expect(s).toMatch(/75%/);
    expect(s).not.toMatch(/single-sourced/i);
  });
});
