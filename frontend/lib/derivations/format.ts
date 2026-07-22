// frontend/lib/derivations/format.ts
// Pure formatting helpers. No React, no DOM.

import type { NumericDerivation, NumericUnit } from "./numeric";

export function formatFreshnessAge(observed_age_seconds: number): string {
  if (observed_age_seconds < 3600) return `${Math.round(observed_age_seconds / 60)}m`;
  if (observed_age_seconds < 86400) return `${Math.round(observed_age_seconds / 3600)}h`;
  return `${Math.round(observed_age_seconds / 86400)}d`;
}

export function formatBand(low: number, high: number): string {
  return `${low.toFixed(3)}…${high.toFixed(3)}`;
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
