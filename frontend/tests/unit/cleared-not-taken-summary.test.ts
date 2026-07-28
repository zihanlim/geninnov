// The panel opens by default, but its summary must still carry the FINDING.
//
// A reader can collapse ClearedNotTaken after scanning the candidate table, so
// the summary cannot degrade to bookkeeping. It names the most independent
// candidate that cleared every screen and was passed over.
//
// Safari and Firefox do not auto-expand a closed <details> for find-in-page, so
// the ticker must remain in the summary even though the initial state is open.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const SRC = readFileSync(
  path.resolve(__dirname, "../../components/book/ClearedNotTaken.tsx"),
  "utf8",
);

describe("ClearedNotTaken disclosure summary", () => {
  it("opens inside CollapsibleSection rather than rendering a bare card", () => {
    expect(SRC).toContain("<CollapsibleSection");
    expect(SRC).toMatch(/summary=\{summary\}/);
    expect(SRC).toContain("defaultOpen");
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
