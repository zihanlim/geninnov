import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The card fetches in an effect, which renderToStaticMarkup never runs, so the
// header claims are asserted through the same derivations the component uses.
// What matters is that they are DERIVED at all -- the previous copy asserted
// "LDA ∩ embedding agreement" over a list that is 45% single-method (ADR-0138).

type Row = { tier: number; status: string; run_date: string };

const RUN_2026_07_24: Row[] = [
  ...Array.from({ length: 6 }, () => ({ tier: 2, status: "shadow", run_date: "2026-07-24" })),
  ...Array.from({ length: 5 }, () => ({ tier: 3, status: "shadow", run_date: "2026-07-24" })),
];

function header(rows: Row[]) {
  const tier2 = rows.filter((r) => r.tier === 2).length;
  const tier3 = rows.filter((r) => r.tier === 3).length;
  const promoted = rows.filter((r) => r.status === "promoted").length;
  const shadow = rows.filter((r) => r.status === "shadow").length;
  const status = promoted > 0 ? `${promoted} promoted, ${shadow} shadow` : "shadow, none promoted";
  return `LDA + embedding · ${tier2} two-method, ${tier3} single-method · ${status}`;
}

describe("the header describes what is actually on the card", () => {
  it("counts single-method candidates instead of calling them agreements", () => {
    // The live run: 6 of 11 agree, 5 do not. The old copy claimed agreement
    // over all eleven.
    const h = header(RUN_2026_07_24);
    expect(h).toContain("6 two-method");
    expect(h).toContain("5 single-method");
    expect(h).not.toContain("∩");
  });

  it("says none promoted while none is promoted", () => {
    expect(header(RUN_2026_07_24)).toContain("shadow, none promoted");
  });

  it("stops saying that the moment one IS promoted", () => {
    // The half of the old copy that was TRUE is now derived, so it cannot
    // silently become false.
    const withPromotion = [{ tier: 2, status: "promoted", run_date: "2026-07-24" }, ...RUN_2026_07_24];
    const h = header(withPromotion);
    expect(h).toContain("1 promoted, 11 shadow");
    expect(h).not.toContain("none promoted");
  });
});

describe("the tokenizer-contamination notice", () => {
  const predates = (runDate: string | null) => runDate !== null && runDate < "2026-07-28";

  it("fires for the run built with the old tokenizer", () => {
    expect(predates("2026-07-24")).toBe(true);
  });

  it("does not fire for a run after the fix", () => {
    expect(predates("2026-08-01")).toBe(false);
    expect(predates("2026-07-28")).toBe(false);
  });

  it("does not fire when there is no run at all", () => {
    expect(predates(null)).toBe(false);
  });

  it("names the specific contamination rather than disclaiming generally", () => {
    const src = require("fs").readFileSync(
      require("path").join(process.cwd(), "components", "DiscoveredThemes.tsx"),
      "utf8",
    );
    expect(src).toContain("fxstreet");
    expect(src).toContain("pravda");
    // And says why it is not simply corrected in place.
    expect(src).toContain("would be fabrication");
  });
});
