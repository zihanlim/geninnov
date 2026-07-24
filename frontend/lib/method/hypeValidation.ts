// Is HypeScore a validated return signal, or just a measured-once number?
//
// HypeScore measures ATTENTION. Whether attention predicts forward returns is the
// rank information coefficient (IC), and the panel that reports it has one job it
// must not get wrong: a single day's cross-sectional IC is a POINT ESTIMATE, not a
// validated signal. One rank correlation across ~8 themes on one day carries no
// information about stability, and stability is the entire difference between a
// signal and a lucky draw.
//
// The IC information ratio (mean/σ across dates) is that stability measure. It is
// undefined until there are at least two independent cross-sections, so keying the
// "validated" verdict on `icIr` — not on a non-null point IC — is what stops a lucky
// one-day reading from flipping the panel green. This module is the pure core of that
// decision, extracted so a test pins it: the failure mode it guards against
// (single-date IC read as validation) is exactly the kind of confident-but-wrong
// number this codebase keeps removing.

export interface HorizonIC {
  h: number;
  ic: number | null;
  nObs: number | null;
  nDates: number | null;
  icIr: number | null;
}

export type ICStatus =
  | "validated" // a stable IC across ≥2 dates
  | "measured-thin" // a number, but from too few dates to be stable
  | "too-few-names" // observations exist but not enough to rank on any date
  | "no-window"; // no forward price window yet

/** Per-horizon status. `icIr` is only defined with ≥2 dates, so it is the boundary
 *  between "measured once" and "a signal". */
export function horizonStatus(s: HorizonIC): ICStatus {
  if (s.ic !== null) {
    return s.icIr !== null ? "validated" : "measured-thin";
  }
  return (s.nObs ?? 0) > 0 ? "too-few-names" : "no-window";
}

/** The panel-level verdict across all horizons. */
export function isValidated(stats: readonly HorizonIC[]): boolean {
  return stats.some((s) => s.icIr !== null);
}

/** True when a number exists but none of it clears the stability bar — the state
 *  that must read as "point estimate", never as validation. */
export function isMeasuredThin(stats: readonly HorizonIC[]): boolean {
  return !isValidated(stats) && stats.some((s) => s.ic !== null);
}
