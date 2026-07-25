// frontend/lib/statusChips.ts
//
// The status → chip-class map, kept out of the component so it is plain data that
// tests can import. tests/unit/chip-contrast.test.ts asserts the AA floor on every
// entry here; reading it from the real map rather than a copy is the point, since a
// copied class string passes while the shipped chip regresses.
//
// Lives under lib/ so Tailwind's content globs pick the classes up — see the note
// in tailwind.config.ts about why a class written outside the globs compiles only
// by coincidence.

import type { NumericStatus } from "@/lib/derivations/numeric";

export const STATUS_CHIPS: Record<NumericStatus, { text: string; cls: string }> = {
  exact: { text: "Exact", cls: "bg-long-dim text-long" },
  estimated: { text: "Estimated", cls: "bg-warning-dim text-warning" },
  // Outlined rather than a second flat warning tint: `estimated` already owns
  // bg-warning-dim/text-warning, and two states must not render identically. The
  // ring distinguishes them without opening a new hue. (Was
  // bg-[#3a2615]/text-[#f0883e] — a pre-Ledger dark-theme pair that drew a
  // dark-brown chip on cream paper.)
  stale: { text: "Stale", cls: "bg-warning-dim text-warning border border-warning/40" },
  unavailable: {
    text: "Unavailable",
    cls: "bg-bg-elevated text-text-secondary border border-border",
  },
  unverified: { text: "Unverified", cls: "bg-short-dim text-short" },
};
