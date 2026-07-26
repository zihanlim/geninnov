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
  // Was `bg-long-dim text-long` — forest-green, which is DIRECTION ink. On /book a
  // green "Exact" provenance chip sits inches from a green LONG pill and teaches a
  // reader that green means two unrelated things (ADR-0085). It is now the quiet,
  // confident state: page-elevated fill, full-strength ink, a stronger hairline.
  // Distinct from `unavailable` — which is the same fill with SECONDARY ink and a
  // normal border — because a verified number and a missing one must never render
  // alike, the same rule that gave `stale` its ring below.
  exact: {
    text: "Exact",
    cls: "bg-bg-elevated text-text-primary border border-border-strong",
  },
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
  // Was `bg-short-dim text-short` — crimson, which is DIRECTION ink, and the exact
  // hue of a SHORT position (ADR-0085). This is the loudest state in the vocabulary:
  // a number nobody checked, on a site whose entire claim is that every number is
  // checked. So it takes the SOLID warning fill rather than a third tint —
  // `estimated` owns the flat tint and `stale` owns tint-plus-ring, and a fourth
  // variation of the same tint would not read as more serious than either.
  // White on solid --warning measures 6.72:1 (see globals.css), the same pairing
  // the filled `severe`/`high` severity chips already use.
  unverified: { text: "Unverified", cls: "bg-warning text-bg-surface" },
};
