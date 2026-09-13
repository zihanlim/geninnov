// The workbench: a scratch portfolio derived from the published book.
//
// WHAT IT IS, AND WHAT IT IS NOT
// ------------------------------
// The PUBLISHED book is immutable. It is produced nightly, citation-verified, and
// nothing in the browser may change it — design goal 5. What this module builds is
// a reader's own working copy: add a name, drop a name, move a weight, and see what
// happens to the exposures and the caps.
//
// Goal 5's test is "name what that path can change; 'nothing in the book' is the
// only acceptable answer". Every function here is a pure transform over data the
// browser already has. Nothing is sent anywhere and nothing is stored server-side.
//
// THREE TIERS OF NAME, AND WHY THE DISTINCTION IS NOT NEGOTIABLE
// -------------------------------------------------------------
// Any ticker may be added. What differs is what geninnov can honestly say:
//
//   held       — in the published book. Full analytics, full signal.
//   candidate  — cleared the screen, was not taken. Full analytics, full signal.
//   unscored   — anything else. Risk analytics only.
//
// An unscored name has no EdgeScore and no conviction, because those require a
// theme, news mentions and a HypeScore that an arbitrary ticker has none of. Vol
// and betas derive from prices alone, so those are available. The absence is
// rendered with its cause and never as a zero (design goal 2) — a conviction of 0
// would read as "measured, and it is nothing", which is a different and false claim.
//
// EVERY FIGURE HERE IS A BROWSER-SIDE ESTIMATE
// --------------------------------------------
// Goal 1 allows a number that is "labelled as a browser-side estimate". Nothing in
// this module is published, nothing traces to a persisted row, and the UI must say
// so. A workbench figure that looks like a book figure is the failure mode.

import { ENFORCED } from "@/lib/mandate";

export type Tier = "held" | "candidate" | "unscored";

/** One line in the scratch portfolio. */
export interface ScratchPosition {
  asset: string;
  direction: "long" | "short";
  /** Unsigned share of capital. The sign comes from `direction`. */
  weight: number;
  tier: Tier;
  /** null for an unscored name — never 0, which would read as a measurement. */
  edgeScore: number | null;
  conviction: number | null;
  vol: number | null;
  sector: string | null;
  geo: string | null;
}

export interface CapUsage {
  key: string;
  weight: number;
  cap: number;
  utilisation: number;
  breached: boolean;
}

export interface ScratchMetrics {
  gross: number;
  net: number;
  longWeight: number;
  shortWeight: number;
  cash: number;
  deployed: number;
  /** Herfindahl on the 0–10 000 scale, matching the backend's concentration_hhi. */
  hhi: number;
  singleName: CapUsage[];
  sector: CapUsage[];
  geo: CapUsage[];
  grossCap: CapUsage;
  breaches: string[];
  /** Names carrying no signal, so the UI can say why rather than showing a zero. */
  unscored: string[];
}

const signed = (p: ScratchPosition): number =>
  p.direction === "short" ? -Math.abs(p.weight) : Math.abs(p.weight);

/**
 * Mirrors `book_metrics.CAP_EPSILON` (ADR-0068) and for the same reason: a book
 * clamped exactly to its cap lands on the limit by design, and summing clamped
 * floats reintroduces representation error. `0.35000000000000003 > 0.35` is not a
 * governance breach, it is one ULP.
 */
export const CAP_EPSILON = 1e-9;

const exceeds = (weight: number, cap: number): boolean => weight - cap > CAP_EPSILON;

function group(
  positions: ScratchPosition[],
  by: (p: ScratchPosition) => string | null,
  cap: number,
): CapUsage[] {
  const totals = new Map<string, number>();
  for (const p of positions) {
    const key = by(p);
    // A name with no sector or geography is EXCLUDED rather than bucketed into an
    // "Unknown" group. A synthetic group would invent a cap check that means
    // nothing, and could report a breach of a category that does not exist.
    if (!key) continue;
    totals.set(key, (totals.get(key) ?? 0) + Math.abs(signed(p)));
  }
  // forEach rather than spreading the iterator: the repo's tsconfig target predates
  // downlevelIteration, as risk-thresholds.test.ts already notes.
  const rows: CapUsage[] = [];
  totals.forEach((weight, key) => {
    rows.push({
      key,
      weight,
      cap,
      utilisation: cap > 0 ? weight / cap : 0,
      breached: exceeds(weight, cap),
    });
  });
  return rows.sort((a, b) => b.weight - a.weight);
}

/**
 * Everything the workbench can compute without a server.
 *
 * Deliberately does NOT compute VaR, CVaR or a re-optimised book: those need a
 * covariance matrix and cvxpy respectively, and inventing a browser-side
 * approximation of either would put a second, differently-wrong number beside the
 * published one.
 */
export function scratchMetrics(positions: ScratchPosition[]): ScratchMetrics {
  const longWeight = positions
    .filter((p) => p.direction === "long")
    .reduce((s, p) => s + Math.abs(p.weight), 0);
  const shortWeight = positions
    .filter((p) => p.direction === "short")
    .reduce((s, p) => s + Math.abs(p.weight), 0);

  const gross = longWeight + shortWeight;
  const net = longWeight - shortWeight;

  const singleName: CapUsage[] = positions
    .map((p) => {
      const w = Math.abs(p.weight);
      const cap = ENFORCED.single_name_pct.value;
      return { key: p.asset, weight: w, cap, utilisation: w / cap, breached: exceeds(w, cap) };
    })
    .sort((a, b) => b.weight - a.weight);

  const sector = group(positions, (p) => p.sector, ENFORCED.sector_pct.value);
  const geo = group(positions, (p) => p.geo, ENFORCED.geo_pct.value);

  const grossCapValue = ENFORCED.gross_exposure_pct.value;
  const grossCap: CapUsage = {
    key: "Gross",
    weight: gross,
    cap: grossCapValue,
    utilisation: gross / grossCapValue,
    breached: exceeds(gross, grossCapValue),
  };

  // Σwᵢ² × 10 000 — the DOJ scale the backend's concentration_hhi uses. On the 0–1
  // scale a 2 500 book would read as 0.25 and be compared against a 2 000 limit.
  const hhi = positions.reduce((s, p) => s + Math.abs(p.weight) ** 2, 0) * 10_000;

  const breaches = [
    ...singleName.filter((c) => c.breached).map((c) => `${c.key} single-name`),
    ...sector.filter((c) => c.breached).map((c) => `${c.key} sector`),
    ...geo.filter((c) => c.breached).map((c) => `${c.key} geography`),
    ...(grossCap.breached ? ["gross exposure"] : []),
  ];

  return {
    gross,
    net,
    longWeight,
    shortWeight,
    deployed: gross,
    // Cash is what the book does NOT deploy, and it cannot be negative: a book over
    // its gross budget is leveraged, not holding negative cash.
    cash: Math.max(0, 1 - gross),
    hhi,
    singleName,
    sector,
    geo,
    grossCap,
    breaches,
    unscored: positions.filter((p) => p.tier === "unscored").map((p) => p.asset),
  };
}

/**
 * Value-weighted factor tilts, over the names that HAVE betas.
 *
 * Returns the coverage alongside, because a tilt computed over four of ten names is
 * a different claim from one computed over all ten, and the number alone cannot show
 * the difference. Same reasoning as ADR-0097's coverage-first rule for crowding.
 */
export function scratchTilts(
  positions: ScratchPosition[],
  betas: Record<string, Record<string, number>>,
): { tilts: Record<string, number>; covered: number; total: number; missing: string[] } {
  const tilts: Record<string, number> = {};
  const missing: string[] = [];
  let covered = 0;

  for (const p of positions) {
    const b = betas[p.asset];
    if (!b) {
      missing.push(p.asset);
      continue;
    }
    covered += 1;
    for (const [factor, value] of Object.entries(b)) {
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      tilts[factor] = (tilts[factor] ?? 0) + signed(p) * value;
    }
  }
  return { tilts, covered, total: positions.length, missing };
}

/** Notional per name under a capital base. Signed, so a short reads negative. */
export function scratchNotionals(
  positions: ScratchPosition[],
  totalCapital: number = ENFORCED.total_capital.value,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of positions) out[p.asset] = signed(p) * totalCapital;
  return out;
}

/** How far the scratch book has moved from the published one, in summed |Δweight|. */
export function driftFromBook(
  scratch: ScratchPosition[],
  published: { asset: string; direction: "long" | "short"; weight?: number }[],
): { turnover: number; added: string[]; removed: string[]; resized: string[] } {
  const s = new Map(scratch.map((p) => [p.asset, signed(p)]));
  const b = new Map(
    published.map((p) => [
      p.asset,
      (p.direction === "short" ? -1 : 1) * Math.abs(p.weight ?? 0),
    ]),
  );

  let turnover = 0;
  const added: string[] = [];
  const removed: string[] = [];
  const resized: string[] = [];

  // Union of both sides via forEach, not a spread: a name present in only one book
  // is a full entry or a full exit, and iterating one side alone would price
  // entries and silently miss every exit.
  const seen = new Set<string>();
  const visit = (asset: string) => {
    if (seen.has(asset)) return;
    seen.add(asset);
    const from = b.get(asset) ?? 0;
    const to = s.get(asset) ?? 0;
    const delta = to - from;
    if (delta === 0) return;
    turnover += Math.abs(delta);
    if (!b.has(asset)) added.push(asset);
    else if (!s.has(asset)) removed.push(asset);
    else resized.push(asset);
  };
  s.forEach((_v, asset) => visit(asset));
  b.forEach((_v, asset) => visit(asset));
  return { turnover, added: added.sort(), removed: removed.sort(), resized: resized.sort() };
}
