// frontend/lib/book/positionEdge.ts
//
// Book-page-only pure helpers. This file exists so /book can render the CROWN
// JEWEL of the platform — the 4-component EdgeScore, the conviction × inverse-vol
// sizing chain, and per-position marginal risk — without duplicating logic across
// the row, the section header, and the abstention roster.
//
// The shared read-model in `@/lib/themeSignals` owns the EdgeScore contract
// (ThemeEdge, edgeContributions, edgeRationale, abstainedThemes). It is NOT
// edited here. This file only adds the pieces specific to the /book surface:
//
//  1. RESOLVING an edge for a *position*. The edge for a position can come from
//     two places, in priority order: the columns on portfolio_positions itself
//     (migration 025, keyed by asset), then the theme's latest row via
//     fetchThemeEdge (keyed by theme_id). picks[] carry NO edge fields, so a pick
//     alone can never resolve a side — it must be joined to one of those two.
//
//  2. The SIZING CHAIN. Weight is NOT hype_score/100. It is
//     conviction (= |edge|/vol) → normalised across the book → cap-clamped →
//     final weight → signed weight → notional. When conviction is null the book
//     was sized by the legacy HypeScore heuristic and the UI must say so.
//
//  3. MARGINAL RISK. A position's marginal contribution to gross and net
//     exposure, plus its single most-correlated sibling from the persisted
//     correlation_pairs. Best-effort from data already on the page.

import type { EdgeWeights, ThemeEdge } from "@/lib/themeSignals";

// ─────────────────────────────────────────────────────────────────────────────
// scoring_config → EdgeWeights
// ─────────────────────────────────────────────────────────────────────────────

/** One row of scoring_config as read elsewhere in the app (param_name/value). */
export interface ScoringConfigRow {
  param_name: string;
  value: number | string | null;
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v)
    ? v
    : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))
      ? Number(v)
      : null;

/**
 * Resolve the live EdgeScore weights and the abstain threshold from scoring_config.
 * Any param the table does not carry falls back to the migration-024 default that
 * `DEFAULT_EDGE_WEIGHTS` encodes, and `resolved` reports which params were actually
 * found so the UI can flag when it is showing defaults rather than live values.
 */
export function edgeWeightsFromConfig(
  rows: ScoringConfigRow[] | null | undefined,
  defaults: EdgeWeights,
): { weights: EdgeWeights; resolved: Record<keyof EdgeWeights, boolean> } {
  const byName = new Map<string, number | null>();
  for (const r of rows ?? []) byName.set(r.param_name, num(r.value));

  const pick = (name: string, fallback: number): [number, boolean] => {
    const v = byName.get(name);
    return v === null || v === undefined ? [fallback, false] : [v, true];
  };

  const [trend, tOk] = pick("edge_trend_weight", defaults.trend);
  const [regime, rOk] = pick("edge_regime_weight", defaults.regime);
  const [carry, cOk] = pick("edge_carry_weight", defaults.carry);
  const [value, vOk] = pick("edge_value_weight", defaults.value);
  const [sentiment, sOk] = pick("edge_sentiment_weight", defaults.sentiment);
  const [abstainThreshold, aOk] = pick(
    "edge_abstain_threshold",
    defaults.abstainThreshold,
  );

  return {
    weights: { trend, regime, carry, value, sentiment, abstainThreshold },
    resolved: {
      trend: tOk,
      regime: rOk,
      carry: cOk,
      value: vOk,
      sentiment: sOk,
      abstainThreshold: aOk,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// portfolio_positions edge columns (migration 025)
// ─────────────────────────────────────────────────────────────────────────────

/** The migration-025 edge columns on portfolio_positions, keyed by asset. */
export interface PositionEdgeRow {
  asset: string;
  theme_id?: string | null;
  edge_score: number | null;
  trend_signal: number | null;
  regime_bias: number | null;
  carry_signal: number | null;
  value_signal: number | null;
  sentiment_signal: number | null;
  conviction: number | null;
  vol: number | null;
}

/** Where a resolved position edge came from — surfaced so a PM can trust it. */
export type EdgeSource = "position_row" | "theme_latest" | "none";

export interface ResolvedEdge extends ThemeEdge {
  source: EdgeSource;
}

const dirOf = (edge: number | null): "long" | "short" | null =>
  edge === null || Number.isNaN(edge) || edge === 0
    ? null
    : edge > 0
      ? "long"
      : "short";

const hasAnyComponent = (e: {
  trend_signal: number | null;
  regime_bias: number | null;
  carry_signal: number | null;
  value_signal: number | null;
  sentiment_signal: number | null;
}): boolean =>
  e.trend_signal !== null ||
  e.regime_bias !== null ||
  e.carry_signal !== null ||
  e.value_signal !== null ||
  e.sentiment_signal !== null;

/**
 * Resolve the EdgeScore breakdown for a single position.
 *
 * Priority: the columns persisted on portfolio_positions itself (authoritative —
 * they are exactly what sized THIS book) win over the theme's latest signal row.
 * A position with neither yields `source: "none"` so the UI renders an explicit
 * "not computed for this run" state instead of a fabricated zero tilt.
 */
export function resolvePositionEdge(
  positionRow: PositionEdgeRow | undefined,
  themeEdge: ThemeEdge | undefined,
): ResolvedEdge {
  if (positionRow && hasAnyComponent(positionRow)) {
    return {
      edge_score: positionRow.edge_score,
      trend_signal: positionRow.trend_signal,
      regime_bias: positionRow.regime_bias,
      carry_signal: positionRow.carry_signal,
      value_signal: positionRow.value_signal,
      sentiment_signal: positionRow.sentiment_signal,
      conviction: positionRow.conviction,
      vol: positionRow.vol,
      direction: dirOf(positionRow.edge_score),
      run_date: null,
      source: "position_row",
    };
  }
  if (themeEdge && hasAnyComponent(themeEdge)) {
    return { ...themeEdge, source: "theme_latest" };
  }
  return {
    edge_score: null,
    trend_signal: null,
    regime_bias: null,
    carry_signal: null,
    value_signal: null,
    sentiment_signal: null,
    conviction: null,
    vol: null,
    direction: null,
    run_date: null,
    source: "none",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The sizing chain: conviction × inverse-vol → capped weight → notional
// ─────────────────────────────────────────────────────────────────────────────

export interface BindingGroupCap {
  /** The limit family, e.g. "geography" or "sector". */
  group: string;
  /** The group at its limit, e.g. "US" or "Energy". */
  key: string;
  /** The cap as a fraction of gross, e.g. 0.35. */
  cap: number;
}

export interface SizingStep {
  key: string;
  /** Human label for the row. */
  label: string;
  /** Formatted value, or "—" when the input is unavailable. */
  display: string;
  /** True when this step is where a cap clamped the raw weight down. */
  clamped?: boolean;
  /** True when this step could not be computed and is shown as unavailable. */
  unavailable?: boolean;
}

export interface SizingChain {
  /** True when conviction drove the size (the documented model). */
  convictionBased: boolean;
  steps: SizingStep[];
  /** The single-line headline, e.g. "conviction 9.5× → 6.0% weight → -$6.0M". */
  headline: string;
  /**
   * Set when the steps do not compose into the final weight.
   *
   * The chain mixes two provenances: the normalised-conviction step is RECOMPUTED
   * here from persisted edge/vol, while the cap and final steps are the weight the
   * sizer actually produced. Rendered in sequence they read as one derivation, and
   * for a long time they were not one: `size_positions` sized the published book by
   * HypeScore while this panel showed the conviction path (ADR-0053). The live
   * 2026-07-25 book displayed "normalised 19.0% → single-name cap 20% → final 6.4%",
   * which no cap can do — 19.0% is already under 20%.
   *
   * So the panel now checks its own arithmetic instead of trusting it. A note here
   * means the displayed model did not produce the displayed weight, and the number
   * to believe is the final one.
   */
  reconciliation: string | null;
}

const pctStr = (v: number | null | undefined, dp = 1): string =>
  v === null || v === undefined || Number.isNaN(v)
    ? "—"
    : `${(v * 100).toFixed(dp)}%`;

const usdM = (v: number | null | undefined): string =>
  v === null || v === undefined || Number.isNaN(v)
    ? "—"
    : `${v < 0 ? "-" : ""}$${Math.abs(v / 1_000_000).toFixed(1)}M`;

/**
 * Build the sizing derivation for one position.
 *
 * The persisted `weight`/`signed_weight`/`notional` are the ground truth of what
 * was sized — this reconstructs the *reasoning* that produced them. When
 * conviction is present it shows the documented chain (conviction → normalised →
 * cap → weight). When conviction is null it shows the weight as-is and flags that
 * the run used the superseded HypeScore/100 heuristic, so no one mistakes an old
 * fallback book for the conviction model.
 *
 * @param convictionSum the sum of |conviction| across every position with a
 *   non-null conviction, used to show the normalisation denominator. Pass null to
 *   omit the normalised-weight step (e.g. when siblings are not all loaded).
 */
export function buildSizingChain(args: {
  direction: "long" | "short";
  edge: ResolvedEdge;
  weight: number | null | undefined;
  signedWeight: number | null | undefined;
  notional: number | null | undefined;
  hypeScore: number | null | undefined;
  cap?: { weight: number; cap: number; utilisation: number; breached: boolean };
  convictionSum?: number | null;
  /** Group caps (geography, sector) sitting at their limit. A name scaled below its
   *  normalised weight is inside one of these — ADR-0037 clamps a capped group and
   *  banks the freed capital as cash — so this is what "no cap binding" got wrong. */
  bindingGroupCaps?: BindingGroupCap[];
}): SizingChain {
  const {
    direction,
    edge,
    weight,
    signedWeight,
    notional,
    hypeScore,
    cap,
    convictionSum,
    bindingGroupCaps,
  } = args;
  const isLong = direction === "long";
  const conviction = edge.conviction;
  const convictionBased = conviction !== null && conviction !== undefined;

  const steps: SizingStep[] = [];

  if (convictionBased) {
    const absEdge =
      edge.edge_score === null ? null : Math.abs(edge.edge_score);
    steps.push({
      key: "edge",
      label: "|EdgeScore|",
      display:
        absEdge === null ? "—" : absEdge.toFixed(3),
      unavailable: absEdge === null,
    });
    steps.push({
      key: "vol",
      label: "Volatility (annualised)",
      display: edge.vol === null ? "—" : pctStr(edge.vol, 1),
      unavailable: edge.vol === null,
    });
    steps.push({
      key: "conviction",
      label: "Conviction = |Edge| / vol",
      display: conviction === null ? "—" : `${conviction.toFixed(2)}×`,
    });
    if (convictionSum !== null && convictionSum !== undefined && convictionSum > 0) {
      steps.push({
        key: "normalised",
        label: "Normalised weight (÷ Σ conviction)",
        display:
          conviction === null ? "—" : pctStr(conviction / convictionSum, 1),
      });
    }
  } else {
    steps.push({
      key: "hype",
      label: "Raw weight (HypeScore / 100)",
      display:
        hypeScore === null || hypeScore === undefined
          ? "—"
          : (hypeScore / 100).toFixed(3),
      unavailable: hypeScore === null || hypeScore === undefined,
    });
  }

  if (cap) {
    steps.push({
      key: "cap",
      label: `Single-name cap (${(cap.cap * 100).toFixed(0)}%)`,
      display: `${(cap.weight * 100).toFixed(1)}% used${cap.breached ? " — BREACHED" : ""}`,
      clamped: cap.utilisation >= 1 || cap.breached,
    });
  }

  steps.push({
    key: "final",
    label: "Final weight",
    display: pctStr(weight),
    unavailable: weight === null || weight === undefined,
  });
  steps.push({
    key: "signed",
    label: "Signed weight",
    display:
      signedWeight !== null && signedWeight !== undefined
        ? pctStr(signedWeight)
        : weight === null || weight === undefined
          ? "—"
          : pctStr(isLong ? weight : -weight),
  });
  steps.push({
    key: "notional",
    label: "Notional",
    display: usdM(notional),
    unavailable: notional === null || notional === undefined,
  });

  // Signed notional for the headline: prefer the persisted notional's own sign;
  // if it is unsigned (positive for both sides), fall back to the direction.
  const headlineNotional =
    typeof notional === "number" &&
    isLong === notional >= 0
      ? usdM(notional)
      : typeof notional === "number"
        ? usdM(isLong ? Math.abs(notional) : -Math.abs(notional))
        : "—";
  const headline = convictionBased
    ? `conviction ${(conviction as number).toFixed(1)}× → ${pctStr(weight)} → ${headlineNotional}`
    : `HypeScore ${hypeScore?.toFixed(0) ?? "—"} → ${pctStr(weight)} → ${headlineNotional}`;

  // Do the displayed steps actually compose into the displayed weight?
  //
  // Under the documented model the normalised-conviction weight is the final weight
  // unless a cap clamps it DOWN. So a final weight materially below the normalised
  // one with no cap binding means something other than the shown model set the size,
  // and the panel should say so rather than let the reader join the steps up.
  //
  // Only flags a SHORTFALL: caps can only reduce, and a final weight above the
  // normalised one is a different (louder) bug that the cap step already shows.
  let reconciliation: string | null = null;
  if (convictionBased && conviction !== null && conviction !== undefined) {
    const normalised =
      convictionSum !== null && convictionSum !== undefined && convictionSum > 0
        ? conviction / convictionSum
        : null;
    const capBinding = cap ? cap.utilisation >= 1 || cap.breached : false;
    if (
      normalised !== null &&
      weight !== null &&
      weight !== undefined &&
      !capBinding &&
      normalised - weight > 0.005          // half a point of capital
    ) {
      const groups = (bindingGroupCaps ?? []).filter((g) => g.cap > 0);
      if (groups.length > 0) {
        // A name scaled below its normalised weight sits inside a group whose cap is
        // binding: ADR-0037 clamps the group and banks the freed capital as cash rather
        // than redistributing it, so the shortfall IS a cap — just not the single-name
        // one this chain shows. Naming it beats the old "no cap binding", which was
        // wrong precisely when a group cap was doing the work.
        const naming = groups
          .map((g) => `the ${g.group} cap (${g.key}, ${pctStr(g.cap, 0)})`)
          .join(" and ");
        const isAre = groups.length === 1 ? "is" : "are";
        const itsTheir = groups.length === 1 ? "its" : "their";
        reconciliation =
          `${pctStr(normalised, 1)} normalised → ${pctStr(weight, 1)} held: the ` +
          `single-name cap is not the binding one here — ${naming} ${isAre} at ${itsTheir} ` +
          `limit. Conviction weights are scaled to fit the caps that bind and the freed ` +
          `capital held as cash (ADR-0037); this per-name chain shows conviction, not that ` +
          `group rescaling, so the final weight is ground truth.`;
      } else {
        reconciliation =
          `These steps do not compose: ${pctStr(normalised, 1)} normalised, ` +
          `no cap binding, yet the book holds ${pctStr(weight, 1)}. ` +
          `The weight was set by something other than the model shown above — ` +
          `trust the final weight, not the derivation.`;
      }
    }
  }

  return { convictionBased, steps, headline, reconciliation };
}

// ─────────────────────────────────────────────────────────────────────────────
// Marginal risk: contribution to gross/net, and the top correlated sibling
// ─────────────────────────────────────────────────────────────────────────────

export interface MinimalPick {
  asset: string;
  direction: "long" | "short";
  notional?: number | null;
}

export interface MarginalContribution {
  /** This position's notional as a share of book gross (|long| + |short|). */
  grossShare: number | null;
  /** Signed contribution to net exposure, as a share of gross. +long, -short. */
  netContribution: number | null;
  /** Absolute dollar notional. */
  notional: number | null;
  /** Book gross the shares are computed against. */
  bookGross: number | null;
}

/**
 * A position's marginal contribution to book gross and net exposure.
 *
 * Gross share is |notional| / Σ|notional|. Net contribution is signed
 * (+ for a long, − for a short) over the same gross base, so summing it across
 * every position recovers the book's net/gross ratio. Returns nulls (not zeros)
 * when the notional is missing, so the UI can say "unavailable".
 */
export function marginalContribution(
  pick: MinimalPick,
  allPicks: MinimalPick[],
): MarginalContribution {
  const own = typeof pick.notional === "number" ? Math.abs(pick.notional) : null;
  const gross = allPicks.reduce(
    (s, p) => s + (typeof p.notional === "number" ? Math.abs(p.notional) : 0),
    0,
  );
  if (own === null || gross <= 0) {
    return {
      grossShare: null,
      netContribution: null,
      notional: own,
      bookGross: gross > 0 ? gross : null,
    };
  }
  const signed = pick.direction === "long" ? own : -own;
  return {
    grossShare: own / gross,
    netContribution: signed / gross,
    notional: own,
    bookGross: gross,
  };
}

/** A persisted correlation pair (subset of the /risk analytics shape). */
export interface CorrelationPairLite {
  asset_a: string;
  asset_b: string;
  corr: number;
  relationship?: string | null;
}

export interface TopSibling {
  asset: string;
  corr: number;
  /** True when the pair moves together (adds concentration), false = hedge. */
  sameDirection: boolean;
}

/**
 * The single most-correlated sibling of `asset` among the flagged pairs.
 *
 * Only pairs above the backend's flagging threshold are persisted, so a null
 * result means "no flagged correlation for this leg", not "uncorrelated with
 * everything". Strongest |ρ| wins.
 */
export function topSibling(
  asset: string,
  pairs: CorrelationPairLite[] | null | undefined,
): TopSibling | null {
  let best: TopSibling | null = null;
  for (const p of pairs ?? []) {
    let other: string | null = null;
    if (p.asset_a === asset) other = p.asset_b;
    else if (p.asset_b === asset) other = p.asset_a;
    if (other === null || typeof p.corr !== "number" || !Number.isFinite(p.corr))
      continue;
    if (best === null || Math.abs(p.corr) > Math.abs(best.corr)) {
      best = {
        asset: other,
        corr: p.corr,
        sameDirection: p.relationship
          ? p.relationship === "same-direction"
          : p.corr > 0,
      };
    }
  }
  return best;
}
