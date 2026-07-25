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

export const TONE_CLS: Record<Tone, string> = {
  info: "border-border-strong bg-bg-elevated text-text-secondary",
  ok: "border-long/30 bg-long-dim text-text-secondary",
  warn: "border-warning/35 bg-warning-dim text-text-secondary",
  bad: "border-short/35 bg-short-dim text-text-secondary",
};

export const TONE_LABEL_CLS: Record<Tone, string> = {
  info: "text-text-primary",
  ok: "text-long",
  warn: "text-warning",
  bad: "text-short",
};
