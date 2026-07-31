// frontend/lib/book/bookFunnel.ts
//
// How 42 candidates became 9 positions, as one chain.
//
// WHY THIS EXISTS. Every number below was already on /book before this module,
// and the answer still could not be read off the page. The candidate narrowing
// was in `PoolDepth`, the sizer's edits were in `SizingProvenance` a section
// away, and the constraint that caused them was a string inside
// `optimizer_result.binding_constraints` that nothing rendered at all. On the
// 2026-07-30 run, assembling "the fifth long existed and the turnover cap
// deleted it" took three panels and a SQL query. That is not a reader's job.
//
// The decisive step is the LAST one, and it is the one no panel drew: the agent
// chose FIVE longs and five shorts -- exactly what Q1 asks for -- and the
// optimizer zeroed EMB, a 20% position at the single-name cap, because realised
// turnover hit 59.99999% against a 60% cap. "Four longs" is not a statement
// about conviction. It is a statement about a risk control, and the two read
// very differently to anyone deciding whether to trust the book.
//
// PURE. No React, no fetching, no Supabase. Everything here is derived from
// columns `BookBody` already selects, so the diagram costs no extra query --
// and every derivation is testable against fixed objects rather than a live run.
//
// GOAL 1 (no naked numbers): every node carries `source`, the table.column the
// figure was read from. A node that cannot name its source does not render a
// number.
// GOAL 2 (absence is stated, never filled): a stage whose inputs are missing
// returns `available: false` with a `cause`, never a zero. On this page a 0
// would read as "the screen found nothing", which is a different and much
// worse claim than "this run predates the column".

/** A stage row as persisted by `q1_agent.screen_candidates` (migration 022). */
export interface ScreeningStage {
  stage: string;
  reason?: string;
  removed?: number;
  remaining?: number;
}

/** Per-side depth from `independent_ideas` (ADR-0056/0058). */
export interface SideIdeas {
  /** Independent IDEAS after collapsing correlated names. */
  count?: number;
  /** Candidate NAMES on this side reaching the reasoning step. */
  names?: number;
  complexes?: Array<{ members: string[]; strongest: string }>;
  standalone?: string[];
  shortfall?: {
    held: number;
    available: number;
    empty_slots?: number;
    passed_over: string[];
    named: string[];
    unexplained: string[];
    satisfied?: boolean;
  };
}

export interface FunnelInputs {
  /**
   * The raw L1 pool from `trade_candidates`, for the first node's long/short
   * split. Optional: the chain is complete without it.
   *
   * `trade_candidates` has NO lens column — L1 ranks names before a lens is
   * chosen, so every lens screens the same rows. That is exactly why the split
   * is worth drawing: on 2026-07-30 the shared pool was 29 long / 13 short, and
   * the credit lens left 11 long and ZERO short. Every short candidate that
   * existed was outside the credit universe, which is the measured form of the
   * published thesis's own sentence that a long/short structure is not
   * constructible from this screen.
   */
  candidates?: Array<{ asset?: string | null; direction?: string | null }> | null;
  screeningFunnel?: ScreeningStage[] | null;
  independentIdeas?: Partial<Record<"long" | "short", SideIdeas>> | null;
  /** The agent's chosen book, signed, pre-optimizer (ADR-0107). */
  heuristicWeights?: Record<string, number> | null;
  picks?: Array<{ asset?: string | null; direction?: string | null }> | null;
  optimizerResult?: {
    zeroed?: string[] | null;
    binding_constraints?: string[] | null;
    realised_turnover?: number | null;
    turnover_cap?: number | null;
    forced_exit_turnover?: number | null;
    feasible?: boolean | null;
  } | null;
}

/** A box in the chain. */
export interface FunnelNode {
  id: "screen" | "context" | "ideas" | "chosen" | "published";
  label: string;
  /** Long / short split, when the stage carries one. Null means NOT CARRIED at
   *  this stage -- rendered as absent, never as zero. */
  long: number | null;
  short: number | null;
  /** The headline count. Null when unavailable; `cause` then says why. */
  total: number | null;
  /** What the count counts -- "candidates", "ideas", "positions". */
  unit: string;
  /** table.column this was read from (goal 1). */
  source: string;
  /** Set only when `total` is null (goal 2). */
  cause?: string;
  /**
   * A qualifier the count would be misread without.
   *
   * Exists for exactly one node so far, and for a reason worth stating: the
   * first node's figures are NOT this book's. `trade_candidates` has no lens
   * column — L1 ranks names before a lens is chosen — so `/book?lens=credit`
   * opens on 42 candidates split 29 long / 13 short, and neither number
   * describes the credit universe. The next edge removes 31 of them. Without a
   * qualifier a reader has to infer "shared" from the edge that follows, which
   * is ADR-0200's failure (a pool belonging to another book, shown unmarked)
   * one panel over from where it was just fixed.
   */
  note?: string;
}

/** The transition INTO a node: what happened, and how many it cost. */
export interface FunnelEdge {
  /** Node id this edge leads into. */
  to: FunnelNode["id"];
  label: string;
  /** Names removed across this edge; null when not quantifiable. */
  removed: number | null;
  /** The one sentence explaining the removal. */
  detail: string;
  /** Names dropped here, when the data identifies them individually. */
  names?: string[];
  /** True when this edge removed something a reader would not expect it to --
   *  drawn with emphasis, because it is the finding. */
  notable?: boolean;
}

export interface BookFunnel {
  available: boolean;
  cause?: string;
  nodes: FunnelNode[];
  edges: FunnelEdge[];
  /** The headline: did the agent hit Q1's five-and-five before sizing? */
  agentHitTarget: boolean | null;
}

const TARGET_PER_SIDE = 5;

/** Signed weights -> long/short counts. Zero is neither, and is not a position. */
export function splitSigned(weights: Record<string, number> | null | undefined): {
  long: number;
  short: number;
  total: number;
  assets: string[];
} {
  const entries = Object.entries(weights ?? {}).filter(([, w]) => Number.isFinite(w) && w !== 0);
  return {
    long: entries.filter(([, w]) => w > 0).length,
    short: entries.filter(([, w]) => w < 0).length,
    total: entries.length,
    assets: entries.map(([a]) => a),
  };
}

/** Picks -> long/short counts, tolerant of a missing direction. */
export function splitPicks(
  picks: FunnelInputs["picks"],
): { long: number; short: number; total: number; assets: string[] } {
  const rows = (picks ?? []).filter((p) => p && p.asset);
  return {
    long: rows.filter((p) => p.direction === "long").length,
    short: rows.filter((p) => p.direction === "short").length,
    total: rows.length,
    assets: rows.map((p) => String(p.asset)),
  };
}

/**
 * The first and last `remaining` in the screening funnel.
 *
 * Read positionally rather than by stage NAME: the stage list is authored in
 * `q1_agent` and has changed twice (the lens stage arrived with migration 062,
 * the editorial veto with ADR-0171). Matching on a label would make this
 * silently return null the next time a stage is renamed, and a silent null on
 * this page means the whole diagram disappears.
 */
export function funnelBounds(
  stages: ScreeningStage[] | null | undefined,
): { first: number | null; last: number | null } {
  const rows = (stages ?? []).filter((s) => typeof s?.remaining === "number");
  if (rows.length === 0) return { first: null, last: null };
  return {
    first: rows[0].remaining as number,
    last: rows[rows.length - 1].remaining as number,
  };
}

/** Human-readable percent, or null. Kept here so the component formats nothing. */
function pct(x: number | null | undefined): string | null {
  return typeof x === "number" && Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : null;
}

/**
 * The screening stages that actually removed something.
 *
 * THIS FUNCTION EXISTS BECAUSE THE FIRST VERSION GOT THE CREDIT BOOK WRONG. It
 * collapsed the whole screen to `first - last` and hardcoded the label "context
 * cap", which is true of the multi-asset run and false of every other lens. On
 * 2026-07-30 the credit funnel reads:
 *
 *     L1 ranked candidates      -0    42
 *     conviction override       -0    42
 *     lens = credit            -31    11     <-- the entire removal
 *     factor R^2 >= 0.10        -0    11
 *     dedupe                    -0    11
 *     editorial veto            -0    11
 *     candidate pool (cap 30)   -0    11     <-- removed NOTHING
 *
 * so the panel told a reader that the model's context window discarded 31 credit
 * candidates. It did not; the asset-class filter did, which is the entire point
 * of the credit book. A label naming the wrong cause is worse than no label --
 * it is the failure the whole panel was written to fix, reproduced inside the
 * fix. The stage list is authored in `q1_agent.screen_candidates` and carries
 * its own `reason` prose, so the edge now quotes the data instead of asserting
 * over it, and a stage added later is described correctly with no change here.
 */
export function removingStages(
  stages: ScreeningStage[] | null | undefined,
): Array<{ stage: string; removed: number; reason: string }> {
  return (stages ?? [])
    .filter((s) => typeof s?.removed === "number" && (s.removed as number) > 0)
    .map((s) => ({
      stage: s.stage ?? "screen",
      removed: s.removed as number,
      reason: (s.reason ?? "").trim(),
    }));
}

/** A stage name short enough for a connector label. */
function shortStageLabel(stage: string): string {
  // `candidate pool (cap 30)` -> `context cap`; anything else keeps its own
  // name, truncated at the first parenthesis so `lens = credit` survives whole.
  if (/candidate pool/i.test(stage)) return "context cap";
  return stage.split("(")[0].trim();
}

/**
 * Build the chain.
 *
 * Returns `available: false` rather than a partial diagram when the two columns
 * it cannot work without are absent. A funnel missing its middle is not a
 * shorter funnel; it is a different and wrong claim about how the book was made.
 */
export function buildBookFunnel(inp: FunnelInputs): BookFunnel {
  const bounds = funnelBounds(inp.screeningFunnel);
  const ideas = inp.independentIdeas ?? null;
  const longIdeas = ideas?.long ?? null;
  const shortIdeas = ideas?.short ?? null;

  const chosen = splitSigned(inp.heuristicWeights);
  const published = splitPicks(inp.picks);

  // The raw pool's own long/short split, used only if it describes the SAME pool
  // the funnel counts. `trade_candidates` is read on its own latest run_date and
  // the book row on its own; a split from one vintage under a total from another
  // is two books on one line, which is the failure this whole panel exists to
  // stop. Equality of counts is the cheapest honest check available here.
  const rawCandidates = inp.candidates?.length ? splitPicks(inp.candidates) : null;
  const rawSplit =
    rawCandidates && bounds.first !== null && rawCandidates.total === bounds.first
      ? rawCandidates
      : null;

  if (published.total === 0) {
    return {
      available: false,
      cause:
        "No sized book for this run, so there is no chain to draw. " +
        "research_recommendations.picks is empty.",
      nodes: [],
      edges: [],
      agentHitTarget: null,
    };
  }

  // Candidate NAMES reaching the reasoning step, per side. `names` is the count
  // of candidates; `count` is the count of IDEAS after collapsing correlated
  // members. Conflating them is the mistake PoolDepth exists to prevent.
  const ctxLong = typeof longIdeas?.names === "number" ? longIdeas.names : null;
  const ctxShort = typeof shortIdeas?.names === "number" ? shortIdeas.names : null;
  const ctxTotal =
    ctxLong !== null && ctxShort !== null ? ctxLong + ctxShort : bounds.last;

  const ideaLong = typeof longIdeas?.count === "number" ? longIdeas.count : null;
  const ideaShort = typeof shortIdeas?.count === "number" ? shortIdeas.count : null;
  const ideaTotal = ideaLong !== null && ideaShort !== null ? ideaLong + ideaShort : null;

  const nodes: FunnelNode[] = [
    {
      id: "screen",
      label: "L1 screen",
      // Split shown ONLY when the candidate rows agree with the funnel's own
      // count. `trade_candidates` is read on its own latest run_date and the
      // book on its own; those are normally the same day and occasionally are
      // not, and a split taken from a different vintage than the total above it
      // is the two-books-on-one-line failure in miniature. Disagree -> no split,
      // which costs a detail; assert it anyway -> a wrong one.
      long: rawSplit ? rawSplit.long : null,
      short: rawSplit ? rawSplit.short : null,
      total: bounds.first,
      unit: "candidates",
      note: "One pool, before any lens — L1 ranks names first and every lens screens these same rows.",
      source: rawSplit
        ? "research_recommendations.screening_funnel + trade_candidates.direction"
        : "research_recommendations.screening_funnel",
      cause:
        bounds.first === null
          ? "screening_funnel is absent on this row -- it is populated from migration 022 onward."
          : undefined,
    },
    {
      id: "context",
      label: "Reasoning pool",
      long: ctxLong,
      short: ctxShort,
      total: ctxTotal,
      unit: "candidates",
      source: "research_recommendations.independent_ideas[side].names",
      cause: ctxTotal === null ? "independent_ideas is absent on this row." : undefined,
    },
    {
      id: "ideas",
      label: "Independent ideas",
      long: ideaLong,
      short: ideaShort,
      total: ideaTotal,
      unit: "ideas",
      source: "research_recommendations.independent_ideas[side].count",
      cause: ideaTotal === null ? "independent_ideas is absent on this row." : undefined,
    },
    {
      id: "chosen",
      label: "Agent selected",
      long: chosen.total ? chosen.long : null,
      short: chosen.total ? chosen.short : null,
      total: chosen.total || null,
      unit: "positions",
      source: "research_recommendations.heuristic_weights",
      cause:
        chosen.total === 0
          ? "heuristic_weights is empty -- the conviction book was not persisted for this run."
          : undefined,
    },
    {
      id: "published",
      label: "Published",
      long: published.long,
      short: published.short,
      total: published.total,
      unit: "positions",
      source: "research_recommendations.picks",
    },
  ];

  // ── Edges ────────────────────────────────────────────────────────────────
  const edges: FunnelEdge[] = [];

  // Named by the stage that DID the removing, per lens, rather than by whichever
  // stage does it on the default book. See `removingStages`.
  const removers = removingStages(inp.screeningFunnel);
  const totalRemoved = removers.reduce((a, s) => a + s.removed, 0);
  const haveFunnel = bounds.first !== null;
  edges.push({
    to: "context",
    label:
      removers.length === 1
        ? shortStageLabel(removers[0].stage)
        : removers.length > 1
          ? "screen"
          : "screen",
    removed: haveFunnel ? totalRemoved : null,
    detail: !haveFunnel
      ? "The screening funnel did not record how many candidates were dropped."
      : removers.length === 0
        ? "Every candidate the screen admitted reached the reasoning step; nothing was dropped here."
        : // The stage's OWN reason text, authored beside the code that removed
          // the rows. Quoting it is what keeps this correct under a lens whose
          // dominant filter is not the one the default book hits.
          removers
            .map((s) =>
              s.reason ? `${s.stage} (−${s.removed}): ${s.reason}` : `${s.stage}: −${s.removed}`,
            )
            .join(" ") +
          // The side arithmetic across this edge, when both ends carry a split.
          // On the credit lens it is the whole argument: 13 shorts in, 0 out, so
          // the universe -- not the screen and not the agent -- is what makes a
          // long/short credit book unconstructible. Stated only when it is TRUE
          // that a side was emptied; a generic "x long and y short remain" every
          // day would bury the one day it matters.
          (rawSplit !== null && ctxLong !== null && ctxShort !== null
            ? ` Of ${rawSplit.long} long and ${rawSplit.short} short candidates, ` +
              `${ctxLong} long and ${ctxShort} short survive` +
              (rawSplit.short > 0 && ctxShort === 0
                ? " — every short candidate in the pool is outside this lens, so a long/short book is not constructible from it."
                : ".")
            : ""),
  });

  // Correlated names collapsing into one idea. This edge removes NOTHING from
  // the book -- it reclassifies. Reported as names-minus-ideas rather than as a
  // removal count, because a reader who reads it as a filter will conclude the
  // pool was smaller than it was.
  const collapsedLong =
    ctxLong !== null && ideaLong !== null ? ctxLong - ideaLong : null;
  const collapsedShort =
    ctxShort !== null && ideaShort !== null ? ctxShort - ideaShort : null;
  const collapsed =
    collapsedLong !== null && collapsedShort !== null
      ? collapsedLong + collapsedShort
      : null;
  const complexBits: string[] = [];
  for (const side of ["long", "short"] as const) {
    for (const cx of (ideas?.[side]?.complexes ?? [])) {
      if (cx.members?.length > 1) {
        complexBits.push(`{${cx.members.join(", ")}} -> ${cx.strongest}`);
      }
    }
  }
  edges.push({
    to: "ideas",
    label: "correlation",
    removed: collapsed,
    detail:
      collapsed === null
        ? "independent_ideas did not record the idea count for both sides."
        : `Names correlated at or above 0.70 are ONE idea, not several. ` +
          `Nothing is discarded here -- taking two members of a complex is one idea expressed twice.`,
    names: complexBits.length ? complexBits : undefined,
  });

  edges.push({
    to: "chosen",
    label: "agent",
    removed:
      ideaTotal !== null && chosen.total ? Math.max(0, ideaTotal - chosen.total) : null,
    detail:
      chosen.total === 0
        ? "The agent's pre-optimizer book was not persisted for this run."
        : `The L5 agent chose ${chosen.long} long and ${chosen.short} short from the available ideas.`,
  });

  // ── The edge that motivated the whole panel ──────────────────────────────
  const zeroed = (inp.optimizerResult?.zeroed ?? []).filter(Boolean);
  const droppedBySizer = chosen.assets.filter((a) => !published.assets.includes(a));
  const binding = (inp.optimizerResult?.binding_constraints ?? []).filter(Boolean);
  const turnover = pct(inp.optimizerResult?.realised_turnover);
  const cap = pct(inp.optimizerResult?.turnover_cap);
  const forced = pct(inp.optimizerResult?.forced_exit_turnover);

  const sizerDetail =
    droppedBySizer.length === 0
      ? "The optimizer funded every position the agent chose."
      : [
          `${droppedBySizer.join(", ")} cleared the screen and the agent's selection, and the sizer did not fund ${droppedBySizer.length === 1 ? "it" : "them"}.`,
          binding.length ? `Binding: ${binding.join("; ")}.` : null,
          turnover && cap ? `Realised turnover ${turnover} against a ${cap} cap.` : null,
          forced ? `${forced} of that was forced exit -- unwinding the previous book.` : null,
        ]
          .filter(Boolean)
          .join(" ");

  edges.push({
    to: "published",
    label: "sizer",
    removed: droppedBySizer.length || null,
    detail: sizerDetail,
    names: droppedBySizer.length ? droppedBySizer : undefined,
    // Emphasised only when the sizer actually removed something. A quiet run
    // should not draw an alarming edge -- the emphasis has to mean something.
    notable: droppedBySizer.length > 0,
  });

  const agentHitTarget =
    chosen.total === 0
      ? null
      : chosen.long >= TARGET_PER_SIDE && chosen.short >= TARGET_PER_SIDE;

  return { available: true, nodes, edges, agentHitTarget };
}

/**
 * The one-sentence headline, or null when there is nothing notable to say.
 *
 * Only speaks when the agent MET Q1's five-and-five and the sizer then cut it,
 * because that is the case a reader would otherwise misread as the screen
 * failing to find ideas. On every other run this returns null and the diagram
 * speaks for itself.
 */
export function funnelHeadline(f: BookFunnel): string | null {
  if (!f.available || !f.agentHitTarget) return null;
  const sizer = f.edges.find((e) => e.to === "published");
  if (!sizer?.names?.length) return null;
  const published = f.nodes.find((n) => n.id === "published");
  if (!published) return null;
  return (
    `The agent selected five long and five short. The sizer did not fund ` +
    `${sizer.names.join(", ")}, so the published book holds ${published.long} long ` +
    `and ${published.short} short.`
  );
}
