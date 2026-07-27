// frontend/lib/book/types.ts
//
// The shapes /book reads out of Supabase, shared between app/book/page.tsx and
// components/book/PositionRow.tsx. See lib/book/format.ts for why these could not
// stay in the route file.
//
// Every field is optional or nullable in the same places the database is, so a
// missing value stays visibly missing rather than defaulting to zero.

/** One sized position in the published book. */
export interface Pick {
  direction: "long" | "short";
  asset: string;
  theme?: string;
  theme_id?: string;
  theme_name?: string;
  thesis?: string;
  catalysts?: string[];
  risk?: string;
  counter_thesis?: string;
  time_horizon?: string;
  factor_tilts?: Record<string, number>;
  factor_r_squared?: number | null;
  /** Where this name sits against its 200-day MA — ADR-0078. */
  ma_context?: {
    last: number;
    ma: number;
    pct_from_ma: number;
    window: number;
    observations: number;
  } | null;
  notional?: number;
  weight?: number;
  signed_weight?: number;
  hype_score?: number;
  trade_score?: number;
  /**
   * What this position is a bet ON, as distinct from the ticker holding it —
   * ADR-0116. L5 writes it; where a correlation complex is involved every member
   * shares one label, because they are one idea.
   */
  exposure?: string;
  /** The complex (or `solo::<asset>`) this position belongs to. */
  idea_id?: string;
  /**
   * False when the optimizer, not L5, chose this instrument to carry the idea.
   * Such a row has no thesis of its own — `expresses_pick` names the position
   * whose argument it is held under, and the book must show them together or it
   * publishes a holding nobody argued for.
   */
  named_by_llm?: boolean;
  expresses_pick?: string;
}

/** One calibrated shock and what it does to the book. */
export interface ScenarioResult {
  scenario_name: string;
  label: string;
  estimated_book_return: number;
  estimated_dollar_pnl: number;
  severity: string;
  contribution_breakdown: string[];
}

/** A single cap and how much of it this position consumes. */
export interface CapRow {
  key: string;
  weight: number;
  cap: number;
  utilisation: number;
  breached: boolean;
}
