// frontend/lib/chat/types.ts
//
// The contract between the three halves of /ask: the tools that read the
// published book, the guardrail that checks the answer against them, and the UI
// that shows a reader where every figure came from.
//
// The shape is dictated by design goal 1 (no naked numbers). A tool does not
// return "the data" — it returns FACTS, each carrying the `table.column` it was
// read from, because an answer the reader cannot follow back to a source is the
// one thing this product cannot ship. Everything else here follows from that.

/**
 * One citable value.
 *
 * `value` is the machine value, not a rendering. The guardrail needs the number
 * to compare against numerals in the answer, and the UI needs to format it in
 * the site's own conventions rather than trust whatever the model typed.
 */
export interface Fact {
  /** Stable identifier the model cites, e.g. "position.UNH.weight". */
  key: string;
  /** Human label for the UI, e.g. "UNH weight". */
  label: string;
  value: number | string | null;
  /**
   * How to render and how to compare. `pct` means value is a FRACTION (0.088
   * renders 8.8%) — the single most likely place for a unit bug, so it is named
   * rather than inferred.
   *
   * `usd` is a BOOK-SCALE amount and renders in millions; `usd_price` is a
   * per-share price and renders as itself. They are separate because they were
   * once the same: a $121.40 close tagged `usd` rendered as "$0.00M", which is
   * not a rounding error but a different claim about the world.
   *
   * `pct` is a FRACTION (0.65 -> 65%); `pct_whole` is ALREADY in percent units
   * (65 -> 65%); `pct_points` is a spread or difference in points (0.34 ->
   * "0.34 percentage points"). Mixing the first two is how the first production
   * answer described S&P breadth as "6500.00%" — the column stores 65 meaning
   * 65%, and the tool had called it a fraction. Check the page that already
   * renders a field before choosing: RegimeInputsPanel gives spx_breadth the
   * unit "%" and real_rate the unit "%", but stores both as whole numbers.
   */
  unit?: "pct" | "pct_whole" | "pct_points" | "usd" | "usd_price" | "score" | "bp" | "x" | "date" | "count" | "text";
  /** Provenance, e.g. "research_recommendations.picks[].weight". */
  source: string;
  /** The run this value belongs to. A figure without its vintage is a rumour. */
  runDate?: string | null;
}

/**
 * What one tool call produced.
 *
 * `absence` is not an error channel — it is goal 2 in the type system. A tool
 * that finds nothing says what is missing and why, and the model is instructed
 * to relay that rather than fill the hole.
 */
export interface ToolResult {
  tool: string;
  args: Record<string, unknown>;
  facts: Fact[];
  /**
   * Prose the model may quote: a thesis, a counter-thesis, a catalyst list.
   * Kept apart from facts because prose is not citable as a number and must not
   * be fed to the numeric guardrail as grounding — a thesis that happens to say
   * "8.8%" would otherwise launder any figure the model invented.
   */
  notes?: Record<string, string | string[]>;
  /** Set when the tool could not answer. Non-empty means facts may be empty. */
  absence?: string;
  /** Wall-clock, for the UI's step timing. */
  ms?: number;
}

export interface ToolSpec {
  name: string;
  /** Shown to the model verbatim. Written as an answer to "when would I call this?". */
  description: string;
  /** Arg name → what it means. Deliberately tiny: every tool takes 0 or 1 args. */
  args: Record<string, string>;
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}

/** Injected so tests can run the whole agent without a database or an API key. */
export interface ToolContext {
  db: DbReader;
}

/**
 * The narrow slice of Supabase the tools use.
 *
 * Narrow on purpose: it is the seam that lets every tool test run against fixed
 * rows, and it makes the read-only claim structural rather than a promise —
 * there is no insert, update or delete on this interface to call.
 */
export interface DbReader {
  select: (
    table: string,
    columns: string,
    opts?: {
      order?: { column: string; ascending?: boolean };
      limit?: number;
      eq?: Record<string, string | number>;
    },
  ) => Promise<{ rows: Record<string, unknown>[]; error: string | null }>;
}

/** One step of the agent's visible reasoning. */
export interface AgentStep {
  tool: string;
  args: Record<string, unknown>;
  /** Why the planner asked for this — shown above the step in the UI. */
  because: string;
  result: ToolResult;
}

export interface AgentAnswer {
  answer: string;
  steps: AgentStep[];
  /**
   * Per-numeral verdicts with their character offsets, so the UI can mark each
   * figure in place rather than putting one banner over the whole answer. The
   * offsets come from the guardrail's own scan — the renderer must never
   * re-parse the prose, or the two could disagree about which figure failed.
   */
  verdicts: import("./guardrail").NumeralVerdict[];
  /** Facts the guardrail matched, in the order the answer used them. */
  citations: Fact[];
  /**
   * Numerals in the answer that matched no fact, after one retry. Rendered
   * inline as untraceable rather than silently shipped: goal 1 says a figure a
   * reader cannot follow back is worse than no figure, and the honest move when
   * the model insists on one anyway is to mark it, not to hide it.
   */
  unverified: string[];
  /** True when every numeral traced. */
  verified: boolean;
  /** The run_date the answer is about — the chat must never imply live data. */
  runDate: string | null;
  /** Set when the agent gave up: no provider, planner unparseable, etc. */
  error?: string;
}
