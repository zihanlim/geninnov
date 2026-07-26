// The collapsed summary must carry the FINDING, not a count.
//
// ClearedNotTaken is ~29% of /book and collapses by default, so whatever the
// <summary> says is all most readers will ever see of it. Its own docstring
// argues the panel answers the sharpest question a reviewer asks, and a summary
// reading "27 held back" would hide exactly the part that makes it worth
// answering — the name that was genuinely INDEPENDENT of everything held and
// was passed over anyway.
//
// Safari and Firefox do not auto-expand a closed <details> for find-in-page, so
// the ticker must appear in the summary or it is unsearchable.
//
// Asserted against the source rather than a render: the summary is assembled
// from live Supabase rows, so there is no fixture that would exercise the real
// string without inventing data.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const SRC = readFileSync(
  path.resolve(__dirname, "../../components/book/ClearedNotTaken.tsx"),
  "utf8",
);

describe("ClearedNotTaken collapsed summary", () => {
  it("collapses behind CollapsibleSection rather than rendering a bare card", () => {
    expect(SRC).toContain("<CollapsibleSection");
    expect(SRC).toMatch(/summary=\{summary\}/);
  });

  it("names the most independent candidate, not just a count", () => {
    // The ticker and its signed rho are what make the summary a finding.
    expect(SRC).toContain("mostIndependent");
    expect(SRC).toMatch(/most independent: \$\{mostIndependent\.asset\}/);
    expect(SRC).toMatch(/mostIndependent\.aligned as number\)\.toFixed\(2\)/);
  });

  it("selects independence by the SIGNED overlap, not raw correlation", () => {
    // classifyOverlap signs the correlation by both directions before
    // thresholding; ranking on raw corr would call a candidate that NETS
    // against a held position "independent". Three rows flipped when this was
    // fixed on 2026-07-24 — see the component docstring.
    expect(SRC).toContain("classifyOverlap");
    expect(SRC).toMatch(/kind === "independent"/);
    expect(SRC).toMatch(/Math\.abs\(a\.aligned as number\) - Math\.abs\(b\.aligned as number\)/);
  });

  it("states absence rather than implying none exist", () => {
    // "no independent candidate" and "we could not measure one" are different
    // claims; the fallback must not read as the former.
    expect(SRC).toContain("none measurably independent of the book");
  });
});
