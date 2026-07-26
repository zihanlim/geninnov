// frontend/lib/risk/riskChips.ts
//
// The /risk page's two enumerated chip vocabularies, kept out of their components
// so tests/unit/chip-contrast.test.ts can import them and assert the real strings —
// the same reason lib/statusChips.ts and lib/methodTones.ts live under lib/.
//
// WHY THEY MOVED HERE. Both maps used to sit inside their component, and that is
// precisely how they survived the goal-3 sweep (ADR-0085, commit 86fb737a) that
// cleared every other status vocabulary of direction ink. The guard that sweep
// added looks for `badge badge-long|short`; these were written as utility classes —
// `badge bg-short-dim text-short` — so the guard could not see them, and the /risk
// page kept shipping a green OK chip that is the exact forest-green of a LONG pill
// and a crimson BREACHED chip that is the exact crimson of a SHORT pill. On /risk
// that green and that crimson render in the same viewport as PositionRiskAttribution's
// long and short rows, so one hue meant two unrelated things on one page.
//
// Living under lib/ also keeps the classes inside Tailwind's content globs — see the
// note in tailwind.config.ts about why a class written outside them compiles only by
// coincidence.

import type { LimitStatus } from "@/lib/risk/riskBoard";

/** A chip's box classes plus, where it has one, the solid fill its meter uses. */
export interface RiskChip {
  label: string;
  cls: string;
  /** CSS colour for the utilisation-bar fill / status dot. */
  fill: string;
}

// The ramp is ADR-0085's, not a new one: escalate by WEIGHT along --warning, and let
// the affirmative state be quiet rather than coloured, because the palette has no
// affirmative tone that is not --long. Every chip here is a WORD ("OK", "BREACHED"),
// so the word carries the meaning and the box only has to be distinguishable.
//
//   ok        quiet + confident   elevated fill, full-strength ink, strong hairline
//   near      attention           --warning tint + ink        (unchanged — already right)
//   breached  loudest             --warning-deep tint + ink   (the severity ramp's top)
//   unknown   absent              elevated fill, secondary ink, normal border
//
// `ok` is byte-identical to STATUS_CHIPS.exact and `breached` to the /method `bad`
// tone (TONE_CLS.bad's fill with TONE_LABEL_CLS.bad's ink) — both pairings are
// already measured against every surface by the contrast suite, so neither opens a
// new accessibility question.
//
// The meter fills escalate the same way: neutral → warning → warning-deep reads as a
// severity ramp, where the old green → orange → crimson read as direction → attention
// → direction.
export const LIMIT_STATUS_CHIPS: Record<LimitStatus, RiskChip> = {
  breached: {
    label: "BREACHED",
    cls: "bg-warning-deep/10 text-warning-deep",
    fill: "var(--warning-deep)",
  },
  near: {
    label: "NEAR",
    cls: "bg-warning-dim text-warning",
    fill: "var(--warning)",
  },
  ok: {
    label: "OK",
    cls: "bg-bg-elevated text-text-primary border border-border-strong",
    fill: "var(--text-tertiary)",
  },
  unknown: {
    label: "NO DATA",
    cls: "bg-bg-elevated text-text-secondary border border-border",
    fill: "var(--border-strong)",
  },
};

// DeltaChip's hue does NOT track the sign of its number: `higherIsWorse` inverts it,
// so a falling Sharpe renders `▼` in the "worse" colour while a falling VaR renders
// `▼` in the "better" one. That is what puts it inside goal 3 rather than inside the
// signed-value exemption — the exemption is granted because a +/− glyph already says
// what the hue says, and here it does not. A crimson ▼ chip on the risk page was
// simply a short position to anyone scanning.
//
// Same resolution: the loud state escalates along --warning, the good state goes
// quiet. On a risk page that is arguably the better reading anyway — attention lands
// on what got worse.
export type DeltaVerdict = "worse" | "better" | "unchanged";

export const DELTA_CHIPS: Record<DeltaVerdict, string> = {
  worse: "bg-warning-deep/10 text-warning-deep",
  better: "bg-bg-elevated text-text-primary border border-border-strong",
  unchanged: "bg-bg-elevated text-text-tertiary border border-border",
};
