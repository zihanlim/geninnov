// The regime inputs are persisted in the SAME unit as their underlying FRED
// series — percentage points. `yield_curve_slope` is DGS10 − DGS2 (e.g. 4.67 −
// 4.31 = 0.36), and `hy_oas` is BAMLH0A0HYM2 (e.g. 2.77). Neither is basis points.
//
// The 2s10s curve is quoted in basis points by convention, so it must be scaled
// ×100 before a "bps" label. Rendering the raw 0.36 as "0.36 bps" — or worse,
// `(0.36).toFixed(0)` = "0bps" — put a flat/inverted curve on the showcase page
// over a curve that was actually +36bps. These helpers own that conversion so no
// display site re-derives it (and mis-derives it).

/** Percentage-point slope → basis points. null-safe. */
export function slopeToBps(slopePp: number | null | undefined): number | null {
  if (slopePp === null || slopePp === undefined || Number.isNaN(slopePp)) return null;
  return slopePp * 100;
}

/** 2s10s slope (stored in pp) formatted as whole basis points, e.g. "36bps".
 *  Returns "—" when absent. The rounding is the trap: 0.36pp is 36bps, not 0. */
export function formatSlopeBps(slopePp: number | null | undefined): string {
  const bps = slopeToBps(slopePp);
  return bps === null ? "—" : `${bps.toFixed(0)}bps`;
}
