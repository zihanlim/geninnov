// frontend/components/datamap/dataMap.ts
//
// THE MAP, AS DATA.
//
// Every node on the /datamap page is declared here. The renderer never
// hard-codes a node — the SVG is built from `mapNodes` and `mapEdges`.
//
// The shape:
//   - `id`         stable string, used as the foreign key for edges and the
//                  `aria-label` / mono caption on the node card.
//   - `name`       short display name (1–3 words).
//   - `summary`    one-line description in plain prose.
//   - `type`       which swimlane it belongs to.
//   - `doc`        optional path to the doc that records it; rendered in
//                  the table companion.
//
// Edges know from / to, plus an optional `kind` that classifies the visual:
//   - "solid"  → primary flow (animated teal)
//   - "purple" → LLM call (animated purple, e.g. llms → L5)
//   - "dashed" → shadow / optional / reference (static gray, e.g. rss → L1b)
//
// Layout: `sectionOrder` is the authoritative sequence (01–13, matching the
// reference HTML diagram). Nodes are grouped by `section`; within a section
// they render in `swimlaneOrder[type]` order. The vertical layout needs no
// fixed canvas — it uses flex-wrap and an SVG overlay that is sized to the
// DOM after nodes are painted.

export type NodeType = "source" | "pipeline" | "table" | "surface";

/** One row in the 01–13 layout sequence, matching the reference HTML. */
export interface Section {
  section: string;
  title: string;
}

/** The authoritative 01–13 sequence — not grouped by type, but in visual
 *  reading order top-to-bottom. Sections that have no nodes are omitted
 *  (e.g. section "10" is skipped — no L9 layer). */
export const sectionOrder: Section[] = [
  { section: "01", title: "External Sources" },
  { section: "02", title: "L0 · Macro" },
  { section: "03", title: "L1 · Theme" },
  { section: "04", title: "L1b · Narrative" },
  { section: "05", title: "L2 · Factors" },
  { section: "06", title: "L2b · Credit / Duration" },
  { section: "07", title: "L3 · Regime" },
  { section: "08", title: "L4 · Risk" },
  { section: "09", title: "Sizing · Optimizer" },
  { section: "11", title: "L5 / L6 / L7 / L8 + L5b · Reasoning / Writeup / Provenance / Ask" },
  { section: "12", title: "Supabase Tables" },
  { section: "13", title: "Frontend Surfaces" },
];

export interface Node {
  id: string;
  name: string;
  summary: string;
  type: NodeType;
  /** Top-right badge: layer target, e.g. "→L0", "🤖". */
  badge?: string;
  /** Top-left badge: position in the 01–13 section sequence. */
  section?: string;
  /** Card tint override; "purple" marks an LLM-boundary node. */
  tint?: "purple";
  doc?: string;
}

export const mapNodes: Node[] = [
  // ─────────────── EXTERNAL SOURCES ───────────────
  {
    id: "fred",
    name: "FRED",
    summary: "Yield curve, HY OAS, CPI, DFF, DGS*, DFII10",
    type: "source",
    badge: "→L0",
    doc: "ARCHITECTURE.md · L0",
  },
  {
    id: "yfinance",
    name: "yfinance",
    summary: "Daily closes, returns, vol for mapped instruments",
    type: "source",
    badge: "→L0",
    doc: "ARCHITECTURE.md · market_assets",
  },
  {
    id: "brave",
    name: "Brave Search",
    summary: "Recency-ranked news; primary attention signal",
    type: "source",
    badge: "→L1",
    doc: "ADR-0144",
  },
  {
    id: "gdelt",
    name: "GDELT 2.0",
    summary: "News archive with real history (1 req/5s)",
    type: "source",
    badge: "→L1",
    doc: "ADR-0144",
  },
  {
    id: "reddit",
    name: "Reddit PRAW",
    summary: "Retail attention; configured, not live",
    type: "source",
    badge: "→L1",
    doc: "methodology §8",
  },
  {
    id: "rss",
    name: "RSS ×14",
    summary: "News, pubDate required; SHADOW (not scored)",
    type: "source",
    badge: "→L1",
    doc: "ADR-0157",
  },
  {
    id: "kenfrench",
    name: "Ken French",
    summary: "FF5 + UMD monthly factor returns",
    type: "source",
    badge: "→L2",
    doc: "ARCHITECTURE.md · L2",
  },
  {
    id: "polymarket",
    name: "Polymarket",
    summary: "Prediction market odds (m011 not deployed)",
    type: "source",
    badge: "→L5",
    doc: "ARCHITECTURE.md · m011",
  },
  {
    id: "cftc",
    name: "CFTC CoT",
    summary: "Weekly spec positioning (Tue obs)",
    type: "source",
    badge: "→SIZ",
    doc: "ADR-0097",
  },
  {
    id: "worldmonitor",
    name: "worldmonitor",
    summary: "Chokepoint status; credential-gated",
    type: "source",
    badge: "→L5",
    doc: "ADR-0095, ADR-0099",
  },
  {
    id: "fedwatch",
    name: "CME FedWatch",
    summary: "Per-meeting rate-hike probabilities",
    type: "source",
    badge: "→L3",
    doc: "ADR-0219",
  },
  {
    id: "llms",
    name: "LLM providers",
    summary: "MiniMax, Anthropic, Gemini (L5 + L8 only)",
    type: "source",
    badge: "🤖",
    tint: "purple",
    doc: "ARCHITECTURE.md · LLM",
  },

  // ─────────────── L0–L8 PIPELINE ───────────────
  {
    id: "L0",
    name: "L0 · Macro",
    summary: "FRED + yfinance snapshot",
    type: "pipeline",
    section: "02",
    doc: "backend/data/macro_fetcher.py",
  },
  {
    id: "L1",
    name: "L1 · Theme",
    summary: "Brave + Reddit → VADER → HypeScore + TradeScore",
    type: "pipeline",
    section: "03",
    doc: "methodology §4.1",
  },
  {
    id: "L1b",
    name: "L1b · Narrative",
    summary: "Un-themed corpus → share of voice (SHADOW)",
    type: "pipeline",
    section: "04",
    doc: "ADR-0128",
  },
  {
    id: "L2",
    name: "L2 · Factors",
    summary: "FF5 + UMD rolling betas (one OLS)",
    type: "pipeline",
    section: "05",
    doc: "ADR-0190",
  },
  {
    id: "L2b",
    name: "L2b · Credit/Duration",
    summary: "DGS10 / IG / HY−IG legs; sizes nothing",
    type: "pipeline",
    section: "06",
    doc: "ADR-0190, 0192, 0193",
  },
  {
    id: "L3",
    name: "L3 · Regime",
    summary: "Cycle × sentiment + debasement + fed posture",
    type: "pipeline",
    section: "07",
    doc: "ADR-0091, 0139, 0140",
  },
  {
    id: "L4",
    name: "L4 · Risk",
    summary: "VaR / CVaR / Sharpe / β / HHI (derive-aware)",
    type: "pipeline",
    section: "08",
    doc: "ARCHITECTURE.md · L4",
  },
  {
    id: "L5",
    name: "L5 · Reasoning",
    summary: "8 nodes, LLM at classify_news + reason_picks",
    type: "pipeline",
    section: "11",
    doc: "backend/services/q1_agent.py",
  },
  {
    id: "L5b",
    name: "L5b · Credit lens",
    summary: "Second nightly run under lens=credit (m062)",
    type: "pipeline",
    section: "11",
    doc: "ADR-0194",
  },
  {
    id: "sizing",
    name: "Sizing · Optimizer",
    summary: "cvxpy; 20/30/35 caps as solver constraints",
    type: "pipeline",
    section: "09",
    doc: "ADR-0107, 0037, 0173",
  },
  {
    id: "L6",
    name: "L6 · Writeup",
    summary: "Six PM-phase pages; nav = process",
    type: "pipeline",
    section: "11",
    doc: "ADR-0170",
  },
  {
    id: "L7",
    name: "L7 · Provenance",
    summary: "Drawers, citations, status read-models",
    type: "pipeline",
    section: "11",
    doc: "ADR-0009–0011",
  },
  {
    id: "L8",
    name: "L8 · /ask + MCP",
    summary: "Plan → execute → answer → verify (2 LLM calls)",
    type: "pipeline",
    section: "11",
    doc: "ADR-0087, 0092",
  },

  // ─────────────── SUPABASE TABLES (representative) ───────────────
  {
    id: "t-themes",
    name: "themes / theme_signals",
    summary: "Daily hype + trade scores per anchor",
    type: "table",
    section: "12",
    doc: "Supabase · themes",
  },
  {
    id: "t-narrative",
    name: "market_news / narrative_signals",
    summary: "Un-themed corpus + share of voice",
    type: "table",
    section: "12",
    doc: "m049, ADR-0128",
  },
  {
    id: "t-macro",
    name: "macro_indicators / market_assets",
    summary: "FRED series + 7-group daily tape",
    type: "table",
    section: "12",
    doc: "m067, ADR-0196",
  },
  {
    id: "t-factors",
    name: "factor_exposures / credit_rates",
    summary: "FF5+UMD per ticker; m060 credit legs",
    type: "table",
    section: "12",
    doc: "m060, m061",
  },
  {
    id: "t-regime",
    name: "regime_classifications",
    summary: "Cycle × sentiment + crosscurrents",
    type: "table",
    section: "12",
    doc: "m052, m053, m065",
  },
  {
    id: "t-candidates",
    name: "trade_candidates",
    summary: "Ranked L1 pool, ONE pool (no lens)",
    type: "table",
    section: "12",
    doc: "ADR-0030",
  },
  {
    id: "t-positions",
    name: "portfolio_positions",
    summary: "Sized book; per-lens since m068",
    type: "table",
    section: "12",
    doc: "ADR-0222",
  },
  {
    id: "t-book",
    name: "research_recommendations",
    summary: "Picks + book_metrics + scenario JSONB",
    type: "table",
    section: "12",
    doc: "m022, m062, ADR-0024",
  },
  {
    id: "t-risk",
    name: "portfolio_risk",
    summary: "Risk + numeric_derivations JSONB",
    type: "table",
    section: "12",
    doc: "T15, ADR-0098",
  },
  {
    id: "t-signal",
    name: "book_signal / book_holdings",
    summary: "Mandate-free signal + cost-netted NAV",
    type: "table",
    section: "12",
    doc: "m055, m056, ADR-0148, 0150",
  },
  {
    id: "t-picks",
    name: "pick_outcomes",
    summary: "Forward record; 21td horizon",
    type: "table",
    section: "12",
    doc: "m043, ADR-0090",
  },
  {
    id: "t-facts",
    name: "structured_facts",
    summary: "Hand-curated citable rows (L4b)",
    type: "table",
    section: "12",
    doc: "m066, ADR-0218, 0220",
  },

  // ─────────────── FRONTEND SURFACES ───────────────
  {
    id: "f-home",
    name: "/ (Themes)",
    summary: "Theme board, tape, regime, narrative",
    type: "surface",
    section: "13",
    doc: "Phase 2 — Alpha",
  },
  {
    id: "f-book",
    name: "/book",
    summary: "Positions + thesis + sizing chain",
    type: "surface",
    section: "13",
    doc: "Phase 3 — Construction",
  },
  {
    id: "f-mandate",
    name: "/mandate",
    summary: "Mandate + limit board",
    type: "surface",
    section: "13",
    doc: "Phase 1 — Mandate",
  },
  {
    id: "f-risk",
    name: "/risk",
    summary: "Stress + VaR + attribution",
    type: "surface",
    section: "13",
    doc: "Phase 4 — Risk",
  },
  {
    id: "f-attr",
    name: "/attribution",
    summary: "Realised drawdown (only backward)",
    type: "surface",
    section: "13",
    doc: "Phase 6 — Attribution",
  },
  {
    id: "f-method",
    name: "/method",
    summary: "Process map; chapters: build + evidence",
    type: "surface",
    section: "13",
    doc: "ADR-0169, 0084",
  },
  {
    id: "f-ask",
    name: "/ask + MCP",
    summary: "Interrogate the book; every numeral cited",
    type: "surface",
    section: "13",
    doc: "ADR-0087, 0092",
  },
  {
    id: "f-facts",
    name: "/facts",
    summary: "Structured-facts read-side surface",
    type: "surface",
    section: "13",
    doc: "ADR-0221",
  },
];

/** How an edge reads. Defaults to "solid" when omitted. */
export type EdgeKind = "solid" | "purple" | "dashed";

export interface MapEdge {
  from: string;
  to: string;
  /** Optional annotation rendered at the bezier midpoint (e.g. "SHADOW"). */
  label?: string;
  /** Visual class: primary flow, LLM call, or shadow / optional / reference. */
  kind?: EdgeKind;
}

export const mapEdges: MapEdge[] = [
  // Sources → L0
  { from: "fred", to: "L0" },
  { from: "yfinance", to: "L0" },
  // Sources → L1
  { from: "brave", to: "L1" },
  { from: "reddit", to: "L1" },
  // Sources → L1b (un-themed corpus)
  { from: "brave", to: "L1b" },
  { from: "gdelt", to: "L1b" },
  { from: "rss", to: "L1b", label: "SHADOW", kind: "dashed" },
  // Sources → L2
  { from: "kenfrench", to: "L2" },
  { from: "yfinance", to: "L2" },
  // Sources → L2b
  { from: "fred", to: "L2b" },
  { from: "yfinance", to: "L2b" },
  // Sources → L3
  { from: "fred", to: "L3" },
  { from: "fedwatch", to: "L3" },
  // Sources → L4 (book returns)
  { from: "yfinance", to: "L4" },
  // Sources → L5 (LLM call)
  { from: "llms", to: "L5", kind: "purple" },
  // External positioning → book
  { from: "cftc", to: "sizing" },
  { from: "worldmonitor", to: "L5", kind: "dashed" },
  { from: "polymarket", to: "L5", kind: "dashed" },

  // Pipeline internal
  { from: "L0", to: "L1" },
  { from: "L0", to: "L1b" },
  { from: "L0", to: "L3" },
  { from: "L1", to: "L5" },
  { from: "L1b", to: "L5", kind: "dashed" },
  { from: "L2", to: "L5" },
  { from: "L2b", to: "L5", kind: "dashed" },
  { from: "L3", to: "L5" },
  { from: "L4", to: "L5" },
  { from: "L5", to: "L5b" },
  { from: "L5", to: "sizing" },
  { from: "L5b", to: "sizing" },
  { from: "sizing", to: "L6" },
  { from: "L6", to: "L7" },
  { from: "L7", to: "L8" },

  // Pipeline → Tables (writes)
  { from: "L0", to: "t-macro" },
  { from: "L1", to: "t-themes" },
  { from: "L1b", to: "t-narrative" },
  { from: "L2", to: "t-factors" },
  { from: "L2b", to: "t-factors" },
  { from: "L3", to: "t-regime" },
  { from: "L1", to: "t-candidates" },
  { from: "sizing", to: "t-positions" },
  { from: "sizing", to: "t-book" },
  { from: "L4", to: "t-risk" },
  { from: "L5", to: "t-signal" },
  { from: "sizing", to: "t-signal" },
  { from: "L5", to: "t-picks" },
  { from: "t-facts", to: "L5" },

  // Tables → Frontend (reads)
  { from: "t-themes", to: "f-home" },
  { from: "t-macro", to: "f-home" },
  { from: "t-narrative", to: "f-home" },
  { from: "t-regime", to: "f-home" },
  { from: "t-book", to: "f-book" },
  { from: "t-candidates", to: "f-book" },
  { from: "t-positions", to: "f-book" },
  { from: "t-signal", to: "f-book" },
  { from: "t-picks", to: "f-book" },
  { from: "t-factors", to: "f-book" },
  { from: "t-book", to: "f-mandate" },
  { from: "t-risk", to: "f-mandate" },
  { from: "t-positions", to: "f-mandate" },
  { from: "t-risk", to: "f-risk" },
  { from: "t-book", to: "f-risk" },
  { from: "t-positions", to: "f-risk" },
  { from: "t-factors", to: "f-risk" },
  { from: "t-signal", to: "f-risk" },
  { from: "t-picks", to: "f-attr" },
  { from: "t-book", to: "f-attr" },
  { from: "t-risk", to: "f-attr" },
  { from: "t-themes", to: "f-method" },
  { from: "t-factors", to: "f-method" },
  { from: "t-book", to: "f-method" },
  { from: "t-picks", to: "f-method" },
  { from: "t-themes", to: "f-ask" },
  { from: "t-book", to: "f-ask" },
  { from: "t-positions", to: "f-ask" },
  { from: "t-risk", to: "f-ask" },
  { from: "t-macro", to: "f-ask" },
  { from: "t-facts", to: "f-facts" },
];

/**
 * The declared order within each swimlane. A node not in this list is laid
 * out at the end of its lane. The pipeline ordering is the L0–L8 reading
 * order the rest of the app uses (ARCHITECTURE.md · Data Flow); deviating
 * here would be wrong without arguing down the source.
 */
export const swimlaneOrder: Record<NodeType, string[]> = {
  source: [
    "fred",
    "yfinance",
    "brave",
    "gdelt",
    "rss",
    "reddit",
    "kenfrench",
    "polymarket",
    "cftc",
    "worldmonitor",
    "fedwatch",
    "llms",
  ],
  pipeline: [
    "L0",
    "L1",
    "L1b",
    "L2",
    "L2b",
    "L3",
    "L4",
    "L5",
    "L5b",
    "sizing",
    "L6",
    "L7",
    "L8",
  ],
  table: [
    "t-themes",
    "t-narrative",
    "t-macro",
    "t-factors",
    "t-regime",
    "t-candidates",
    "t-positions",
    "t-book",
    "t-risk",
    "t-signal",
    "t-picks",
    "t-facts",
  ],
  surface: [
    "f-home",
    "f-mandate",
    "f-book",
    "f-risk",
    "f-attr",
    "f-method",
    "f-ask",
    "f-facts",
  ],
};
