// frontend/tests/unit/risk-sections.test.ts
//
// /risk's section tabs, and the one that had no tab.
//
// The mandate — what this book is ALLOWED to be — rendered inside
// <section id="limits">, so the tab strip could not name it. A reader arriving
// on /risk#mandate (which is where phase 1 of the process map sends them, and
// where every cap explanation points) landed on a panel the navigation claimed
// did not exist. MandatePanel had carried id="mandate" the whole time; nothing
// tabbed to it.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PHASES } from "@/lib/method/phases";

const src = readFileSync(
  path.resolve(__dirname, "../../app/risk/page.tsx"),
  "utf8",
);
const mandatePanel = readFileSync(
  path.resolve(__dirname, "../../components/risk/MandatePanel.tsx"),
  "utf8",
);

/** The section ids the nav offers, in render order. */
function navIds(): string[] {
  const block = src.match(/const RISK_SECTIONS = \[([\s\S]*?)\];/);
  if (!block) throw new Error("RISK_SECTIONS not found");
  return [...block[1].matchAll(/id:\s*"([a-z-]+)"/g)].map((m) => m[1]);
}

describe("RISK_SECTIONS", () => {
  it("offers the mandate its own tab, first", () => {
    expect(navIds()[0]).toBe("mandate");
  });

  it("still offers every other section it did before", () => {
    // Hardcoded rather than derived: the point is to catch a section being
    // dropped while the mandate was promoted.
    expect(navIds()).toEqual([
      "mandate",
      "limits",
      "attribution",
      "stress",
      "concentration",
      "exposure",
      "realised",
    ]);
  });

  it("has no duplicate tab ids", () => {
    const ids = navIds();
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("the mandate anchor", () => {
  it("is rendered by MandatePanel, so the tab has a target", () => {
    expect(mandatePanel).toContain('id="mandate"');
  });

  it("is not nested inside the limits section it is measured by", () => {
    // The specific shape of the bug: `<section id="limits">` opening BEFORE
    // <MandatePanel>. A tab can only scroll to a top-level landmark.
    const limitsAt = src.indexOf('<section id="limits"');
    const panelAt = src.indexOf("<MandatePanel");
    expect(limitsAt, "limits section not found").toBeGreaterThan(-1);
    expect(panelAt, "MandatePanel not rendered").toBeGreaterThan(-1);
    expect(
      panelAt,
      "MandatePanel renders inside <section id=\"limits\">, so #mandate is not a landmark",
    ).toBeLessThan(limitsAt);
  });

  it("is where the process map's phase 1 sends a reader", () => {
    // Binds the two surfaces: if phase 1 is ever repointed, this fails rather
    // than leaving the tab and the map disagreeing about where the mandate is.
    const phase1 = PHASES.find((p) => p.n === 1);
    expect(phase1?.route).toBe("/risk");
    expect(phase1?.anchor).toBe("mandate");
    expect(navIds()).toContain(phase1!.anchor!);
  });
});
