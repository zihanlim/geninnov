// Severity is the column a reader scans first on /risk — "which shock hurts".
// Every band used to be a low-opacity tint of its own hue, which on warm paper
// rendered four near-identical faint pills, so a table deliberately sorted
// worst-first carried no severity signal at all. The escalation now runs by FILL
// as well as hue, and these tests pin that: the two worst bands are solid, the
// lower two are not.
//
// Also pins the palette closed. The `high` band shipped bg-[#3a2615]/text-[#f0883e]
// for as long as the Ledger light theme existed — a pre-Ledger dark-theme pair
// that painted a dark-brown chip on cream paper. A hex literal reappearing here
// is the same regression. See docs/design-goals.md §4.

import { describe, expect, it } from "vitest";
import { severityChipClass, severityRank } from "@/lib/risk/analytics";

/** The bands scenario_analysis.py actually assigns, worst first. */
const BANDS = ["severe", "high", "moderate", "low"] as const;

describe("severityChipClass", () => {
  it("fills the two worst bands and only those", () => {
    // Solid token background + white text = readable from across the room.
    // `severe` was bg-short until ADR-0085 — direction crimson on a scale that
    // has nothing to do with direction. It could not move to --warning, which
    // `high` owns, so --warning-deep exists for this one band.
    expect(severityChipClass("severe")).toContain("bg-warning-deep");
    expect(severityChipClass("severe")).not.toContain("bg-short");
    expect(severityChipClass("severe")).toContain("text-white");

    // Substring hazard: "bg-warning" is a prefix of "bg-warning-deep", so
    // asserting `high` contains "bg-warning" would also pass for `severe`.
    // Pin the exclusion too, or the two filled bands could silently converge.
    expect(severityChipClass("high")).toContain("bg-warning");
    expect(severityChipClass("high")).not.toContain("bg-warning-deep");
    expect(severityChipClass("high")).not.toContain("bg-warning-dim");
    expect(severityChipClass("high")).toContain("text-white");

    // The lower two must stay quiet, or the escalation flattens again.
    expect(severityChipClass("moderate")).toContain("bg-warning-dim");
    expect(severityChipClass("moderate")).not.toContain("text-white");
    expect(severityChipClass("low")).not.toContain("text-white");
  });

  it("gives every band a visually distinct chip", () => {
    const chips = BANDS.map(severityChipClass);
    expect(new Set(chips).size).toBe(BANDS.length);
  });

  it("distinguishes the two filled bands by hue, not by fill alone", () => {
    // Both are solid; if they resolved to the same token, `severe` and `high`
    // would be indistinguishable on the page despite ranking differently.
    expect(severityChipClass("severe")).not.toBe(severityChipClass("high"));
    expect(severityRank("severe")).toBeLessThan(severityRank("high"));
  });

  it("uses only palette tokens — no raw hex", () => {
    for (const band of [...BANDS, "unknown", ""]) {
      expect(severityChipClass(band)).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    }
  });

  it("is case-insensitive and degrades to the neutral chip", () => {
    expect(severityChipClass("SEVERE")).toBe(severityChipClass("severe"));
    // An unrecognised band must not fall through to a filled, alarming chip.
    for (const junk of ["", "unknown", "catastrophic"]) {
      const cls = severityChipClass(junk);
      expect(cls).not.toContain("text-white");
      expect(cls).toContain("border");
    }
  });
});
