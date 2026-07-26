// frontend/lib/methodTones.ts
//
// Tone classes for the /method page's <Note> callouts, kept out of the component
// so tests/unit/chip-contrast.test.ts can import them and assert the AA floor on
// the real strings rather than a copy.
//
// These carried `bg-long-dim/40`, `bg-warning-dim/50` and `bg-short-dim/50` until
// 2026-07-25. That reads as "40% of an already-faint tint" and is not what Tailwind
// does: the opacity modifier REPLACES a colour's alpha rather than compounding it,
// so `bg-long-dim/40` compiled to rgba(18,110,83,0.4) — 40% of full-strength
// forest green, roughly four times the intended tint. Body text on it measured
// 3.23:1 and the tone label 3.31:1, both well under AA. The `-dim` tokens already
// carry the intended alpha, so the modifier is simply dropped.

export type Tone = "info" | "warn" | "bad" | "ok";

// `ok` and `bad` used --long and --short: direction ink spent on a VERDICT about
// a computation, which is goal 3's failure mode (ADR-0085). On /method a green
// "reconciles" callout sat near green LONG rows and taught a reader that the hue
// meant two unrelated things.
//
// Neither could move to an existing semantic token — `warn` already owns
// --warning, and the palette has no affirmative colour at all. The resolution is
// ADR-0085's own principle rather than a new hue: every one of these tones is
// introduced by a WORD (its label), so the word carries the meaning and the box
// only has to be distinguishable. So the four separate by BORDER WEIGHT and fill
// rather than by four hues:
//
//   info  light neutral border, elevated fill      — context
//   ok    STRONG neutral border, elevated fill     — the claim held
//   warn  --warning border + tint                  — attention
//   bad   --warning-deep border + tint             — the loudest, matching the
//                                                    severity ramp's top band
//
// `bad` reuses --warning-deep, which exists for exactly this "louder than warn,
// not direction crimson" job (see globals.css).
export const TONE_CLS: Record<Tone, string> = {
  info: "border-border-strong bg-bg-elevated text-text-secondary",
  ok: "border-text-tertiary bg-bg-elevated text-text-secondary",
  warn: "border-warning/35 bg-warning-dim text-text-secondary",
  bad: "border-warning-deep/45 bg-warning-deep/10 text-text-secondary",
};

export const TONE_LABEL_CLS: Record<Tone, string> = {
  info: "text-text-primary",
  // Full-strength ink rather than a hue: "reconciles" is already an affirmative
  // word, and the palette has no affirmative colour that is not --long.
  ok: "text-text-primary",
  warn: "text-warning",
  bad: "text-warning-deep",
};
