// components/risk/BookFactorTilt.tsx — how much of the book the tilt describes.
//
// `compute_book_metrics` skips any holding whose regression fails r² >= 0.10, so its
// six tilts are weighted over the COVERED sleeve. The panel said "sized book" in its
// header, "value-weighted over the sized positions" in its footnote, and "6 of 6
// factors measured" in its summary — three statements that add up to complete
// coverage, while the tilt could be describing a fraction of the book. Factors
// measured and POSITIONS covered are different counts and only one was on screen.
//
// ADR-0212 persisted the denominator; this is what reads it.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BookFactorTilt } from "@/components/risk/BookFactorTilt";
import type { BookMetrics } from "@/lib/risk/analytics";

const TILTS = {
  beta_mkt: 0.24,
  beta_smb: 0.02,
  beta_hml: -0.04,
  beta_rmw: 0.01,
  beta_cma: 0.08,
  beta_umd: 0.0,
};

const bm = (extra: Partial<BookMetrics> = {}): BookMetrics => ({
  computed: true,
  factor_tilts: TILTS,
  gross_exposure: 1.0,
  net_exposure: 0.1,
  long_weight: 0.55,
  short_weight: 0.45,
  ...extra,
});

const render = (value: BookMetrics) =>
  renderToStaticMarkup(
    <BookFactorTilt state={{ status: "ok", value, runDate: "2026-07-30" }} />,
  );

describe("position coverage", () => {
  it("names the share of gross the betas describe when it is partial", () => {
    // Half the book has no usable regression: the tilts are real and they are about
    // the other half.
    const html = render(bm({ gross_exposure: 1.0, factor_covered_gross: 0.5 }));
    expect(html).toContain('data-testid="tilt-coverage"');
    expect(html).toContain("50%");
  });

  it("says the uncovered part is ABSENT, not neutral", () => {
    // The distinction that matters. A reader who assumes the uncovered half is
    // factor-neutral concludes the book is half as tilted as these numbers say; in
    // fact those positions contributed nothing to either the numerator or the
    // denominator, so the betas are the covered sleeve's own, undiluted.
    const html = render(bm({ gross_exposure: 1.0, factor_covered_gross: 0.5 }));
    expect(html).toContain("not neutral in them");
  });

  it("confirms full coverage rather than staying silent about it", () => {
    // Silence would be indistinguishable from the pre-ADR-0212 run below, where
    // coverage is genuinely unknown.
    const html = render(bm({ gross_exposure: 1.0, factor_covered_gross: 1.0 }));
    expect(html).toContain('data-testid="tilt-coverage"');
    expect(html).toContain("cover the whole book");
    expect(html).not.toContain("of gross —");
  });

  it("does not report a rounding artefact as a coverage gap", () => {
    // Two persisted decimals divide to 0.9999…, which would print "covers 100% of
    // gross" as if it were a shortfall — a gap invented by float division.
    const html = render(
      bm({ gross_exposure: 0.9999999, factor_covered_gross: 0.9999998 }),
    );
    expect(html).toContain("cover the whole book");
  });

  it("claims nothing on a run that predates the denominator", () => {
    // Degrades to exactly the old panel, plus an explicit statement that the share
    // is unknown — "no coverage line" must not read as "full coverage".
    const html = render(bm());
    expect(html).not.toContain('data-testid="tilt-coverage"');
    expect(html).toContain("does not record how much of the book cleared");
  });

  it("does not divide by a zero or missing gross", () => {
    for (const gross of [0, null, undefined]) {
      const html = render(
        bm({ gross_exposure: gross as number, factor_covered_gross: 0.5 }),
      );
      expect(html, `gross ${gross}`).not.toContain('data-testid="tilt-coverage"');
      expect(html, `gross ${gross}`).not.toContain("Infinity");
      expect(html, `gross ${gross}`).not.toContain("NaN");
    }
  });
});

describe("the footnote no longer overclaims", () => {
  it("names the r² bar the weighting actually applies", () => {
    // It said "value-weighted over the sized positions" — the subset was never named.
    const html = render(bm({ gross_exposure: 1.0, factor_covered_gross: 1.0 }));
    expect(html).toContain("r² ≥ 0.10");
  });
});
