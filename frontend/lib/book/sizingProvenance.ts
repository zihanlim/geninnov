// frontend/lib/book/sizingProvenance.ts
//
// Read model for `research_recommendations.sizing_method / optimizer_result /
// efficient_frontier / heuristic_weights` (migration 047, ADR-0107).
//
// The arithmetic lives here rather than in the component for the reason ADR-0018
// gives: a figure should trace to a persisted source, and a number computed on the
// way to the screen is the one layer that cannot be tested against the pipeline.
// Nothing here derives a NEW quantity — it formats, pairs and scales what the
// backend already decided.

export type SizingMethod = "optimizer" | "conviction";

export interface OptimizerResult {
  feasible?: boolean;
  status?: string;
  reason?: string | null;
  signed_weights?: Record<string, number>;
  weight_delta?: Record<string, number>;
  expected_return?: number | null;
  volatility?: number | null;
  gross?: number | null;
  net?: number | null;
  cash?: number | null;
  turnover?: number | null;
  binding_constraints?: string[];
  zeroed?: string[];
  warnings?: string[];
  unpriced_assets?: string[];
  ic?: { value?: number; raw?: number; shrinkage?: number; as_of?: string | null };
  crowding?: CrowdingBlock | null;
}

/** `optimizer_result.crowding` — migration 047 payload, ADR-0110. */
export interface CrowdingBlock {
  applied?: boolean;
  reason?: string | null;
  multiplier?: number;
  base_cap?: number;
  coverage_share?: number | null;
  crowded_share?: number | null;
  observed_positions?: number;
  unobservable_positions?: number;
  unobservable_causes?: Record<string, number>;
  fetched?: boolean;
  as_of?: string | null;
  tightened?: {
    asset: string;
    cap: number;
    base_cap?: number;
    direction?: string;
    effective_side?: string;
    inverse?: boolean;
    cot_index?: number;
    crowded_side?: string;
    contract?: string;
  }[];
}

export interface CrowdingSummary {
  /** Leads with coverage, always. The verdict is subordinate to the share it could reach. */
  coverage: string;
  /** What the check did, or why it did nothing. */
  verdict: string;
  tightened: NonNullable<CrowdingBlock["tightened"]>;
}

/**
 * Describe the crowding input at the point where it sized something.
 *
 * GOAL.md's constraint is that a sizing input unmeasurable on four fifths of the book must
 * degrade to neutral **with its coverage stated at the point of use** — never silently. So
 * coverage is returned as its own string that the caller cannot omit, and it is stated
 * whether or not anything was tightened: "nothing was crowded" and "almost nothing could be
 * checked" are the two readings a reader must be able to tell apart.
 *
 * Returns null only when the column is absent entirely — a run predating ADR-0110.
 */
export function describeCrowding(block: CrowdingBlock | null | undefined): CrowdingSummary | null {
  if (!block || typeof block !== "object") return null;

  const share = block.coverage_share;
  const observed = block.observed_positions ?? 0;
  const total = observed + (block.unobservable_positions ?? 0);

  const coverage =
    typeof share === "number" && Number.isFinite(share)
      ? `External positioning can see ${(share * 100).toFixed(0)}% of gross — ` +
        `${observed} of ${total} position${total === 1 ? "" : "s"} map to a futures contract` +
        (block.as_of ? `, as of ${block.as_of}` : "") +
        "."
      : `External positioning covers an unmeasurable share of this book` +
        (block.as_of ? `, as of ${block.as_of}` : "") +
        ".";

  const tightened = block.tightened ?? [];
  const multiplier = block.multiplier;

  const verdict = block.applied
    ? `${tightened.length} position${tightened.length === 1 ? "" : "s"} sit${
        tightened.length === 1 ? "s" : ""
      } with a crowded consensus and ${tightened.length === 1 ? "was" : "were"} limited to ` +
      `${typeof multiplier === "number" ? `${(multiplier * 100).toFixed(0)}% of` : "a fraction of"}` +
      ` the normal single-name cap. Agreeing with a crowd is exposure to it unwinding, not confirmation.`
    : `No position was limited for crowding — ${block.reason ?? "no reason was recorded"}. ` +
      `Positions with no contract are sized exactly as they would be without this check.`;

  return { coverage, verdict, tightened };
}

export interface SizingSummary {
  tone: "optimizer" | "fallback" | "unrecorded";
  headline: string;
  detail: string;
}

/**
 * One sentence naming the model that produced the weights, and — when it is not the
 * optimizer — why not.
 *
 * The fallback case is the one that matters. A book sized by conviction because no IC
 * has been measured is a different claim from one sized by conviction because the
 * constraint set was infeasible, and a reader who is told only "conviction-sized"
 * cannot tell which. An absence has to say which kind of absence it is (ADR-0098).
 */
export function describeSizing(
  method: SizingMethod | null,
  reason: string | null,
  result: OptimizerResult | null
): SizingSummary {
  if (method === "optimizer" && result?.feasible) {
    const ic = result.ic?.value;
    const icNote =
      typeof ic === "number" && Number.isFinite(ic)
        ? ` Expected returns were built from a measured EdgeScore IC of ${(ic).toFixed(4)}` +
          (result.ic?.as_of ? ` (as of ${result.ic.as_of})` : "") +
          `, already shrunk toward zero.`
        : "";
    return {
      tone: "optimizer",
      headline: "Sized by constrained mean-variance.",
      detail:
        `The agent chose the names and the sides; the optimizer chose only the ` +
        `magnitudes, with the 20% single-name, 30% sector and 35% geography limits ` +
        `entered as constraints rather than applied afterwards.${icNote}`,
    };
  }

  // No method on the row at all. This is a book published before migration 047, so
  // the honest statement is that the provenance was not recorded — NOT "sized by
  // conviction", which would be inferring a fact about the run from the absence of a
  // column. It happens to be true of every pre-047 run, and that is exactly why
  // asserting it here is the wrong habit: the page would say the same thing on a
  // future run where the write silently failed.
  if (!method) {
    return {
      tone: "unrecorded",
      headline: "Sizing method not recorded for this run.",
      detail:
        `This book predates the column that stores it (migration 047), so which ` +
        `model set these weights cannot be read off the row. Runs from here on ` +
        `record it.`,
    };
  }

  return {
    tone: "fallback",
    headline: "Sized by conviction, not the optimizer.",
    detail:
      (reason
        ? `The optimizer did not run: ${reason}. `
        : "The optimizer did not run, and no reason was recorded. ") +
      `Weights are proportional to conviction (|EdgeScore| / volatility), then ` +
      `clamped to the same published limits.`,
  };
}

export interface SizingRow {
  asset: string;
  heuristic: number | null;
  optimizer: number | null;
  delta: number | null;
  zeroed: boolean;
}

/**
 * Pair the two sizings by asset, ordered by the size of the position the book
 * actually holds. Names present in either are shown: one the optimizer priced out
 * still belongs in the table, because "we declined this" is a result.
 */
export function sizingRows(
  result: OptimizerResult | null,
  heuristicWeights: Record<string, number> | null
): SizingRow[] {
  const optimizer = result?.feasible ? (result.signed_weights ?? {}) : {};
  const heuristic = heuristicWeights ?? {};
  const assets = Array.from(
    new Set([...Object.keys(optimizer), ...Object.keys(heuristic)])
  );
  if (assets.length === 0) return [];

  const zeroed = new Set(result?.zeroed ?? []);
  const hasOptimizer = Object.keys(optimizer).length > 0;

  return assets
    .map((asset) => {
      const o = hasOptimizer ? (optimizer[asset] ?? 0) : null;
      const h = asset in heuristic ? heuristic[asset] : null;
      return {
        asset,
        heuristic: h,
        optimizer: o,
        delta: o !== null && h !== null ? o - h : null,
        zeroed: zeroed.has(asset),
      };
    })
    .sort((a, b) => {
      const av = Math.abs(a.optimizer ?? a.heuristic ?? 0);
      const bv = Math.abs(b.optimizer ?? b.heuristic ?? 0);
      return bv - av;
    });
}

export interface FrontierPath {
  width: number;
  height: number;
  polyline: string;
  points: { x: number; y: number }[];
  current: { x: number; y: number } | null;
  minVol: number;
  maxVol: number;
}

const WIDTH = 320;
const HEIGHT = 120;
const PAD = 14;

/**
 * Project the frontier and the "you are here" point onto one set of axes.
 *
 * Both are scaled against the SAME extents, which is the only thing that makes the
 * picture honest — and the extents include the current book, so a book sitting off
 * the frontier is drawn off the frontier rather than clipped onto it.
 *
 * Returns null when there is nothing to draw, so the caller renders no chart rather
 * than an empty axis, which reads as "measured, and flat".
 */
export function frontierPath(frontier: unknown): FrontierPath | null {
  const f = frontier as
    | {
        points?: { volatility?: number; expected_return?: number }[];
        current?: { volatility?: number; expected_return?: number } | null;
      }
    | null
    | undefined;

  const raw = (f?.points ?? []).filter(
    (p): p is { volatility: number; expected_return: number } =>
      typeof p?.volatility === "number" &&
      typeof p?.expected_return === "number" &&
      Number.isFinite(p.volatility) &&
      Number.isFinite(p.expected_return)
  );
  if (raw.length < 2) return null;

  const current =
    f?.current &&
    typeof f.current.volatility === "number" &&
    typeof f.current.expected_return === "number" &&
    Number.isFinite(f.current.volatility) &&
    Number.isFinite(f.current.expected_return)
      ? { volatility: f.current.volatility, expected_return: f.current.expected_return }
      : null;

  const vols = raw.map((p) => p.volatility).concat(current ? [current.volatility] : []);
  const rets = raw
    .map((p) => p.expected_return)
    .concat(current ? [current.expected_return] : []);

  const minVol = Math.min(...vols);
  const maxVol = Math.max(...vols);
  const minRet = Math.min(...rets);
  const maxRet = Math.max(...rets);
  const volSpan = maxVol - minVol || 1;
  const retSpan = maxRet - minRet || 1;

  const project = (v: number, r: number) => ({
    x: PAD + ((v - minVol) / volSpan) * (WIDTH - 2 * PAD),
    // SVG y grows downward; a higher expected return must sit higher on the page.
    y: HEIGHT - PAD - ((r - minRet) / retSpan) * (HEIGHT - 2 * PAD),
  });

  const points = raw.map((p) => project(p.volatility, p.expected_return));

  return {
    width: WIDTH,
    height: HEIGHT,
    polyline: points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" "),
    points,
    current: current ? project(current.volatility, current.expected_return) : null,
    minVol,
    maxVol,
  };
}
