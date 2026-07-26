// frontend/lib/derivations/format.ts
// Pure formatting helpers. No React, no DOM.

import type { NumericDerivation, NumericStatus, NumericUnit } from "./numeric";

export function formatFreshnessAge(observed_age_seconds: number): string {
  if (observed_age_seconds < 3600) return `${Math.round(observed_age_seconds / 60)}m`;
  if (observed_age_seconds < 86400) return `${Math.round(observed_age_seconds / 3600)}h`;
  return `${Math.round(observed_age_seconds / 86400)}d`;
}

export function formatBand(low: number, high: number): string {
  return `${low.toFixed(3)}…${high.toFixed(3)}`;
}

/** U+2248 ALMOST EQUAL TO, as an escape rather than a literal.
 *
 *  This environment has twice double-encoded UTF-8 on save (commits 0dbcabcc
 *  and 25fc0105 repaired em-dashes and minus signs across /book). A glyph that
 *  prefixes figures is a bad place to rediscover that; an escape cannot rot. */
const APPROX = "\u2248";

/**
 * A rendered figure, prefixed with `≈` when the pipeline marked it estimated.
 *
 * WHY THIS IS A FUNCTION AND NOT AN INLINE TERNARY. It lives in lib/ for the
 * same reason statusChips, methodTones and riskChips do: tests run in a `node`
 * environment with no jsdom and no testing-library, so anything expressed only
 * inside a component's JSX cannot be asserted on. Extracting the rule makes it
 * checkable, and it is worth checking — nothing in the live book currently
 * carries `estimated` status (the /risk tiles read 2 Exact, 4 Unavailable), so
 * this branch has no on-screen exercise to catch a regression.
 *
 * The marker goes ON the value because a reader scanning a column reads the
 * numbers, not the chips beside them. StatusBadge still names the status in
 * words; this only makes the distinction survive a scan.
 */
export function markEstimated(rendered: string, status: NumericStatus): string {
  // Only `estimated` is marked. `stale` is a freshness claim, not a precision
  // one, and `unverified` is about provenance — neither means "approximately".
  if (status !== "estimated") return rendered;
  // Idempotent. A formatter that double-marks when applied twice is a latent
  // bug waiting for the first caller that pre-formats, and "≈≈5" reads as
  // damage rather than as an estimate.
  if (rendered.startsWith(APPROX)) return rendered;
  return `${APPROX}${rendered}`;
}

export function formatNumericValue(d: NumericDerivation): string {
  if (d.value === null) return "—";
  switch (d.unit) {
    case "pct":
      return `${d.value.toFixed(2)}%`;
    case "usd_m":
      return `$${d.value.toFixed(1)}M`;
    case "usd":
      return `$${d.value.toFixed(2)}`;
    case "ratio":
      return d.value.toFixed(2);
    case "count":
      return `${d.value}`;
    case "score":
      return d.value.toFixed(2);
    case "duration":
      return `${d.value}`;
    case "basis_points":
      return `${d.value.toFixed(0)} bp`;
    default: {
      const _exhaustive: never = d.unit as never;
      void _exhaustive;
      return `${d.value}`;
    }
  }
}

export function unitLabel(unit: NumericUnit): string {
  switch (unit) {
    case "pct":
      return "%";
    case "usd_m":
      return "$M";
    case "usd":
      return "$";
    case "ratio":
      return "x";
    case "count":
      return "";
    case "score":
      return "";
    case "duration":
      return "s";
    case "basis_points":
      return "bp";
  }
}
