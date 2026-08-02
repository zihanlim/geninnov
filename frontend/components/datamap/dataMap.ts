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

export type NodeType = "source" | "pipeline" | "table" | "surface" | "verify";

/** One row in the 01–13 layout sequence, matching the reference HTML. */
export interface Section {
  section: string;
  title: string;
}

/** The authoritative 01–13 sequence — not grouped by type, but in visual
 *  reading order top-to-bottom. Sections that have no nodes are omitted
 *  (e.g. section "10" is skipped — no L9 layer). */
export const sectionOrder: Section[] = [
  { section: "01", title: "External Sources & Triggers" },
  { section: "02", title: "L0— Macro Ingestion" },
  { section: "03", title: "L1 — Theme Detection & Narrative Tracking" },
  { section: "05", title: "L2 — Factor Exposure & Credit" },
  { section: "07", title: "L3 — Regime Classifier" },
  { section: "08", title: "L4 — Risk Engine" },
  { section: "09", title: "Quant Sizing Services" },
  { section: "10", title: "LLM Providers" },
  { section: "11", title: "L5 — Reasoning Agent: Reasoning / Writeup / Provenance / Ask" },
  { section: "12", title: "Supabase Tables" },
  { section: "13", title: "Frontend Surfaces" },
  { section: "14", title: "Verification" },
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
  /** Card fill override; "purple" marks an LLM-boundary node; named colours apply a solid rgba fill. */
  fill?: "purple" | "blue" | "green" | "amber" | "red";
  /** Override border colour independently of fill (e.g. grey fill + purple border). */
  borderColor?: string;
  doc?: string;
  /** Optional sub-group label within a section (e.g. Supabase table groups). */
  group?: string;
}

export const mapNodes: Node[] = [
  // ─────────────── EXTERNAL SOURCES ───────────────
  {
    id: "cron",
    name: "cron",
    summary: "GitHub Actions · 21:30 UTC weekdays",
    type: "source",
    section: "01",
    badge: "TRIGGER",
    doc: "ARCHITECTURE.md · Scheduling",
  },
  {
    id: "fred",
    name: "FRED",
    summary: "Yield curve, HY OAS, CPI, DFF, DGS*, DFII10",
    type: "source",
    section: "01",
    badge: "→L0",
    doc: "ARCHITECTURE.md · L0",
  },
  {
    id: "yfinance",
    name: "yfinance",
    summary: "Daily closes, returns, vol for mapped instruments",
    type: "source",
    section: "01",
    badge: "→L0",
    doc: "ARCHITECTURE.md · market_assets",
  },
  {
    id: "brave",
    name: "Brave Search",
    summary: "Recency-ranked news; primary attention signal",
    type: "source",
    section: "01",
    badge: "→L1",
    doc: "ADR-0144",
  },
  {
    id: "gdelt",
    name: "GDELT 2.0",
    summary: "News archive with real history (1 req/5s)",
    type: "source",
    section: "01",
    badge: "→L1",
    doc: "ADR-0144",
  },
  {
    id: "reddit",
    name: "Reddit PRAW",
    summary: "Retail attention; configured, not live",
    type: "source",
    section: "01",
    badge: "→L1",
    doc: "methodology §8",
  },
  {
    id: "rss",
    name: "RSS ×14",
    summary: "News, pubDate required; SHADOW (not scored)",
    type: "source",
    section: "01",
    badge: "→L1",
    doc: "ADR-0157",
  },
  {
    id: "kenfrench",
    name: "Ken French",
    summary: "FF5 + UMD monthly factor returns",
    type: "source",
    section: "01",
    badge: "→L2",
    doc: "ARCHITECTURE.md · L2",
  },
  {
    id: "polymarket",
    name: "Polymarket",
    summary: "Prediction market odds (m011 not deployed)",
    type: "source",
    section: "01",
    badge: "→L5",
    doc: "ARCHITECTURE.md · m011",
  },
  {
    id: "cftc",
    name: "CFTC CoT",
    summary: "Weekly spec positioning (Tue obs)",
    type: "source",
    section: "01",
    badge: "→SIZ",
    doc: "ADR-0097",
  },
  {
    id: "worldmonitor",
    name: "worldmonitor",
    summary: "Chokepoint status; credential-gated",
    type: "source",
    section: "01",
    badge: "→L5",
    doc: "ADR-0095, ADR-0099",
  },
  {
    id: "fedwatch",
    name: "CME FedWatch",
    summary: "Per-meeting rate-hike probabilities",
    type: "source",
    section: "01",
    badge: "→L3",
    doc: "ADR-0219",
  },
  {
    id: "minimax",
    name: "MiniMax API",
    summary: "MiniMax-M3 · primary L5 + L8 provider",
    type: "source",
    section: "10",
    badge: "🤖",
    borderColor: "var(--datamap-purple)",
    doc: "ARCHITECTURE.md · LLM",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    summary: "Claude Sonnet 4 · L5 fallback",
    type: "source",
    section: "10",
    badge: "🤖",
    borderColor: "var(--datamap-purple)",
    doc: "ARCHITECTURE.md · LLM",
  },
  {
    id: "gemini",
    name: "Google Gemini",
    summary: "Gemini Flash · L8 3rd fallback",
    type: "source",
    section: "10",
    badge: "🤖",
    borderColor: "var(--datamap-purple)",
    doc: "ARCHITECTURE.md · LLM",
  },

  // ─────────────── L0–L8 PIPELINE ───────────────
  {
    id: "L0",
    name: "MacroFetcher",
    summary: "fetch_fred() + fetch_yf() → macro_indicators → macro_daily_history",
    type: "pipeline",
    section: "02",
    doc: "backend/data/macro_fetcher.py",
  },
  // L0 sub-nodes
  {
    id: "L0-macroindicators",
    name: "macro_indicators",
    summary: "→ macro_daily_history",
    type: "pipeline",
    section: "02",
    doc: "backend/data/macro_fetcher.py",
  },
  // L1 sub-nodes
  {
    id: "L1-vader",
    name: "VADER",
    summary: "sentiment on headlines",
    type: "pipeline",
    section: "03",
    group: "L1a — Theme Scoring",
    doc: "scripts/build_theme_signals()",
  },
  {
    id: "L1-corr",
    name: "Cross-Asset Corr",
    summary: "per-class · ADR-0127",
    type: "pipeline",
    section: "03",
    group: "L1a — Theme Scoring",
    doc: "ADR-0127",
  },
  {
    id: "L1-mom",
    name: "Momentum",
    summary: "abs(corr) × return",
    type: "pipeline",
    section: "03",
    group: "L1a — Theme Scoring",
    doc: "scripts/build_theme_signals()",
  },
  {
    id: "L1-hype",
    name: "HypeScore",
    summary: "attn × sent × corr × mom",
    type: "pipeline",
    section: "03",
    group: "L1a — Theme Scoring",
    doc: "scripts/build_theme_signals()",
  },
  {
    id: "L1-trade",
    name: "TradeScore",
    summary: "direction + size",
    type: "pipeline",
    section: "03",
    group: "L1a — Theme Scoring",
    doc: "scripts/build_theme_signals()",
  },
  {
    id: "L1-edge",
    name: "EdgeScore",
    summary: "w_trend·Trend + w_regime·RegimeFit + w_carry·Carry + w_value·Value",
    type: "pipeline",
    section: "03",
    group: "L1a — Theme Scoring",
    fill: "green",
    doc: "scripts/daily_refresh.py compute_edge_score()",
  },
  // L1b sub-nodes
  {
    id: "L1b-freq",
    name: "Doc Freq",
    summary: "1-3-gram document frequency",
    type: "pipeline",
    section: "03",
    group: "L1b — Narrative Tracker (Shadow)",
    doc: "backend/services/narrative_tracker.py",
  },
  {
    id: "L1b-voice",
    name: "Share of Voice",
    summary: "phrase vs corpus",
    type: "pipeline",
    section: "03",
    group: "L1b — Narrative Tracker (Shadow)",
    doc: "backend/services/narrative_tracker.py",
  },
  {
    id: "L1b-vel",
    name: "Velocity",
    summary: "vs own history",
    type: "pipeline",
    section: "03",
    group: "L1b — Narrative Tracker (Shadow)",
    doc: "backend/services/narrative_tracker.py",
  },
  {
    id: "L1b-status",
    name: "Status",
    summary: "new · emerging · established · fading → L1",
    type: "pipeline",
    section: "03",
    group: "L1b — Narrative Tracker (Shadow)",
    doc: "backend/services/narrative_tracker.py",
  },
  // L2 sub-nodes
  {
    id: "L2-ols",
    name: "rolling_ols()",
    summary: "→ L3",
    type: "pipeline",
    section: "05",
    group: "L2a — Factor Exposure",
    doc: "backend/data/factor_fetcher.py",
  },
  {
    id: "L2-bmkt",
    name: "β_mkt",
    summary: "market beta",
    type: "pipeline",
    section: "05",
    group: "L2a — Factor Exposure",
    doc: "backend/data/factor_fetcher.py",
  },
  {
    id: "L2-bsmb",
    name: "β_smb",
    summary: "small-cap beta",
    type: "pipeline",
    section: "05",
    group: "L2a — Factor Exposure",
    doc: "backend/data/factor_fetcher.py",
  },
  {
    id: "L2-bhml",
    name: "β_hml",
    summary: "value beta",
    type: "pipeline",
    section: "05",
    group: "L2a — Factor Exposure",
    doc: "backend/data/factor_fetcher.py",
  },
  {
    id: "L2-brmw",
    name: "β_rmw",
    summary: "profitability beta",
    type: "pipeline",
    section: "05",
    group: "L2a — Factor Exposure",
    doc: "backend/data/factor_fetcher.py",
  },
  {
    id: "L2-bcma",
    name: "β_cma",
    summary: "investment beta",
    type: "pipeline",
    section: "05",
    group: "L2a — Factor Exposure",
    doc: "backend/data/factor_fetcher.py",
  },
  {
    id: "L2-bumd",
    name: "β_umd",
    summary: "momentum beta",
    type: "pipeline",
    section: "05",
    group: "L2a — Factor Exposure",
    doc: "backend/data/factor_fetcher.py",
  },
  {
    id: "L2-r2",
    name: "R²",
    summary: "regression fit",
    type: "pipeline",
    section: "05",
    group: "L2a — Factor Exposure",
    doc: "backend/data/factor_fetcher.py",
  },
  // L2b sub-nodes
  {
    id: "L2b-legs",
    name: "Credit Legs",
    summary: "d_ust · d_ig · d_qual",
    type: "pipeline",
    section: "05",
    group: "L2b — Credit & Duration",
    doc: "ADR-0193",
  },
  {
    id: "L2b-total",
    name: "Total Beta",
    summary: "3 univariate fits",
    type: "pipeline",
    section: "05",
    group: "L2b — Credit & Duration",
    doc: "ADR-0192",
  },
  {
    id: "L2b-marg",
    name: "Marginal Beta",
    summary: "FF5+UMD residualised",
    type: "pipeline",
    section: "05",
    group: "L2b — Credit & Duration",
    doc: "ADR-0193",
  },
  {
    id: "L2b-s7",
    name: "S7 fallen angel",
    summary: "ADR-0192 · |t|≥2 threshold",
    type: "pipeline",
    section: "05",
    group: "L2b — Credit & Duration",
    doc: "ADR-0192",
  },
  // L3 sub-nodes
  {
    id: "L3-cycle",
    name: "Cycle × Sentiment",
    summary: "early · mid · late · rec / on · off",
    type: "pipeline",
    section: "07",
    doc: "backend/services/regime_classifier.py",
  },
  {
    id: "L3-debase",
    name: "Debasement",
    summary: "DFII10 + DX-Y + GC=F",
    type: "pipeline",
    section: "07",
    doc: "backend/services/regime_classifier.py",
  },
  {
    id: "L3-fed",
    name: "Fed Posture",
    summary: "DFF + DGS2 + DGS10",
    type: "pipeline",
    section: "07",
    doc: "backend/services/regime_classifier.py",
  },
  // L4 sub-nodes
  {
    id: "L4-var",
    name: "VaR / CVaR",
    summary: "95th pct",
    type: "pipeline",
    section: "08",
    doc: "backend/services/risk_engine.py",
  },
  {
    id: "L4-mc",
    name: "Monte Carlo",
    summary: "Student-t · seeded",
    type: "pipeline",
    section: "08",
    doc: "backend/services/monte_carlo.py",
  },
  {
    "id": "L4-fan",
    name: "VaR Fan",
    summary: "1/5/10/21/63d",
    type: "pipeline",
    section: "08",
    doc: "backend/services/var_forecast.py",
  },
  {
    id: "L4-vol",
    name: "EWMA+GARCH",
    summary: "reporting only",
    type: "pipeline",
    section: "08",
    doc: "backend/services/volatility_models.py",
  },
  {
    id: "L4-bcmp",
    name: "Benchmark",
    summary: "TE · IR · up/down capture",
    type: "pipeline",
    section: "08",
    doc: "backend/services/benchmark_compare.py",
  },
  {
    id: "L4-wbt",
    name: "Wt Backtest",
    summary: "252d path statistics",
    type: "pipeline",
    section: "08",
    doc: "backend/services/weights_backtest.py",
  },
  // Section 11 — L5 agent chain (step boxes)
  {
    id: "a1", name: "aggregate context",    summary: "L0→L4 inputs assembled",    type: "pipeline", section: "11" },
  {
    id: "a2", name: "screen candidates",    summary: "lens · R²≥0.10 filter",     type: "pipeline", section: "11" },
  {
    id: "a3", name: "classify news",        summary: "🤖 LLM step — classify",     type: "pipeline", section: "11", borderColor: "var(--datamap-purple)" },
  {
    id: "a4", name: "book metrics",         summary: "FF5+UMD tilts computed",    type: "pipeline", section: "11" },
  {
    id: "a5", name: "scenario analysis",    summary: "6 stress scenarios run",     type: "pipeline", section: "11" },
  {
    id: "a6", name: "reason picks",          summary: "🤖 LLM step — thesis",       type: "pipeline", section: "11", borderColor: "var(--datamap-purple)" },
  {
    id: "a7", name: "verify citations",     summary: "pure-fn guardrail",          type: "pipeline", section: "11" },
  {
    id: "a7b", name: "✕ retry",             summary: "max 2× on guardrail fail",   type: "pipeline", section: "11" },
  {
    id: "a8", name: "size positions",       summary: "mean-var cvxpy solve",       type: "pipeline", section: "11" },
  {
    id: "a9", name: "finalise analytics",   summary: "OUTPUT — persisted",         type: "pipeline", section: "11" },
  {
    id: "sizing",
    name: "Sizing · Optimizer",
    summary: "cvxpy; 20/30/35 caps as solver constraints",
    type: "pipeline",
    section: "09",
    doc: "ADR-0107, 0037, 0173",
  },
  // Section 09 — quant sizing sub-services
  {
    id: "q-mandate",
    name: "mandate.py",
    summary: "Capital · caps · gross limit",
    type: "pipeline",
    section: "09",
    doc: "ADR-0107",
  },
  {
    id: "q-signal",
    name: "signal.py",
    summary: "|Edge| / vol",
    type: "pipeline",
    section: "09",
    doc: "ADR-0108",
  },
  {
    id: "q-mu",
    name: "expected_returns",
    summary: "Grinold–Kahn: IC · σ · z",
    type: "pipeline",
    section: "09",
    doc: "ADR-0108",
  },
  {
    id: "q-opt",
    name: "optimizer.py",
    summary: "cvxpy · gross ≤ 1",
    type: "pipeline",
    section: "09",
    doc: "ADR-0107",
  },
  {
    id: "q-cost",
    name: "cost_model.py",
    summary: "Linear transaction costs",
    type: "pipeline",
    section: "09",
    doc: "ADR-0045",
  },
  {
    id: "q-crowd",
    name: "crowding",
    summary: "CFTC positioning · cap halved",
    type: "pipeline",
    section: "09",
    doc: "ADR-0097, 0110",
  },
  {
    id: "q-sanc",
    name: "sanctions",
    summary: "Exposure + side (net short ADRs)",
    type: "pipeline",
    section: "09",
    doc: "ADR-0096",
  },
  {
    id: "q-choke",
    name: "chokepoint",
    summary: "S6 multiplier from measured disruption",
    type: "pipeline",
    section: "09",
    doc: "ADR-0095",
  },

  // ─────────────── SUPABASE TABLES ───────────────
  // Ingestion & Signals
  {
    id: "t-themes",
    name: "themes / theme_signals",
    summary: "Daily hype + trade scores per anchor",
    type: "table",
    section: "12",
    group: "Ingestion & Signals",
    doc: "Supabase · themes",
  },
  {
    id: "t-narrative",
    name: "market_news / narrative_signals",
    summary: "Un-themed corpus + share of voice",
    type: "table",
    section: "12",
    group: "Ingestion & Signals",
    doc: "m049, ADR-0128",
  },
  {
    id: "t-macro",
    name: "macro_indicators / market_assets",
    summary: "FRED series + 7-group daily tape",
    type: "table",
    section: "12",
    group: "Ingestion & Signals",
    doc: "m067, ADR-0196",
  },
  // Computed Exposures
  {
    id: "t-factors",
    name: "factor_exposures / credit_rates",
    summary: "FF5+UMD per ticker; m060 credit legs",
    type: "table",
    section: "12",
    group: "Computed Exposures",
    doc: "m060, m061",
  },
  {
    id: "t-regime",
    name: "regime_classifications",
    summary: "Cycle × sentiment + crosscurrents",
    type: "table",
    section: "12",
    group: "Computed Exposures",
    doc: "m052, m053, m065",
  },
  {
    id: "t-risk",
    name: "portfolio_risk",
    summary: "Risk + numeric_derivations JSONB",
    type: "table",
    section: "12",
    group: "Computed Exposures",
    doc: "T15, ADR-0098",
  },
  {
    id: "t-signal",
    name: "book_signal / book_holdings",
    summary: "Mandate-free signal + cost-netted NAV",
    type: "table",
    section: "12",
    group: "Computed Exposures",
    doc: "m055, m056, ADR-0148, 0150",
  },
  {
    id: "t-picks",
    name: "pick_outcomes",
    summary: "Forward record; 21td horizon",
    type: "table",
    section: "12",
    group: "Computed Exposures",
    doc: "m043, ADR-0090",
  },
  // Book & Outputs
  {
    id: "t-candidates",
    name: "trade_candidates",
    summary: "Ranked L1 pool, ONE pool (no lens)",
    type: "table",
    section: "12",
    group: "Book & Outputs",
    doc: "ADR-0030",
  },
  {
    id: "t-positions",
    name: "portfolio_positions",
    summary: "Sized book; per-lens since m068",
    type: "table",
    section: "12",
    group: "Book & Outputs",
    doc: "ADR-0222",
  },
  {
    id: "t-book",
    name: "research_recommendations",
    summary: "Picks + book_metrics + scenario JSONB",
    type: "table",
    section: "12",
    group: "Book & Outputs",
    doc: "m022, m062, ADR-0024",
  },
  {
    id: "t-facts",
    name: "structured_facts",
    summary: "Hand-curated citable rows (L4b)",
    type: "table",
    section: "12",
    group: "Book & Outputs",
    doc: "m066, ADR-0218, 0220",
  },
  // Operations
  {
    id: "t-pipe",
    name: "pipeline_runs",
    summary: "Run log + status",
    type: "table",
    section: "12",
    group: "Operations",
    doc: "ARCHITECTURE.md · Scheduling",
  },
  {
    id: "t-runs",
    name: "research_agent_runs",
    summary: "L5 run log + citations",
    type: "table",
    section: "12",
    group: "Operations",
    doc: "m044",
  },
  {
    id: "t-sc",
    name: "scoring_config",
    summary: "Weights + lookbacks (editable)",
    type: "table",
    section: "12",
    group: "Operations",
    doc: "ARCHITECTURE.md · Scoring",
  },
  {
    id: "t-bench",
    name: "benchmark_returns",
    summary: "Benchmark daily returns",
    type: "table",
    section: "12",
    group: "Operations",
    doc: "ARCHITECTURE.md · L4",
  },
  {
    id: "t-mkt",
    name: "market_assets",
    summary: "Ticker master + group map",
    type: "table",
    section: "12",
    group: "Operations",
    doc: "m067",
  },
  {
    id: "t-chat",
    name: "chat_usage",
    summary: "Sealed spend ledger",
    type: "table",
    section: "12",
    group: "Operations",
    doc: "m039, ADR-0093",
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
  {
    id: "f-exec",
    name: "/execution",
    summary: "Advisory only — not a live blotter",
    type: "surface",
    section: "13",
    doc: "Phase 5 — Execution",
  },

  // ─────────────── VERIFICATION ───────────────
  {
    id: "v-eval",
    name: "eval battery",
    summary: "5 frozen L0–L4 fixtures",
    type: "verify",
    section: "14",
    doc: "ADR-0013",
  },
  {
    id: "v-repl",
    name: "replication test",
    summary: "N× frozen state",
    type: "verify",
    section: "14",
    doc: "ADR-0013",
  },
  {
    id: "v-bth",
    name: "backtest hype",
    summary: "IC of HypeScore signals",
    type: "verify",
    section: "14",
    doc: "ARCHITECTURE.md · Scoring",
  },
  {
    id: "v-bfr",
    name: "backfill regime",
    summary: "L3 history rebuild",
    type: "verify",
    section: "14",
    doc: "scripts/backfill_regime.py",
  },
  {
    id: "v-reso",
    name: "resolve outcomes",
    summary: "+21td forward scoring",
    type: "verify",
    section: "14",
    doc: "scripts/resolve_outcomes.py",
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
  // Sources -> L0 (section 02)
  { from: "fred",       to: "L0-macroindicators" },
  { from: "yfinance",   to: "L0-macroindicators" },

  // Sources -> L1 (section 03)
  { from: "brave",      to: "L1-hype" },
  { from: "reddit",     to: "L1-hype" },

  // Sources -> L1b (section 04)
  { from: "brave",      to: "L1b-freq" },
  { from: "gdelt",      to: "L1b-freq" },
  { from: "rss",        to: "L1b-freq",  label: "SHADOW", kind: "dashed" },

  // Sources -> L2 (section 05)
  { from: "kenfrench",  to: "L2-ols" },
  { from: "yfinance",   to: "L2-ols" },

  // L2 feeds L2b credit/duration (section 06)
  { from: "L2-ols",     to: "L2b-legs" },
  { from: "fred",       to: "L2b-legs" },
  { from: "yfinance",   to: "L2b-legs" },
  // L2b sub-nodes
  { from: "L2b-legs",   to: "L2b-total" },
  { from: "L2b-legs",   to: "L2b-marg" },
  { from: "L2b-marg",   to: "L2b-s7",   kind: "dashed" },

  // Sources -> L3 (section 07)
  { from: "fred",       to: "L3-cycle" },
  { from: "fedwatch",   to: "L3-cycle" },

  // Sources -> L4 (section 08)
  { from: "yfinance",   to: "L4-var" },

  // External signals -> L5 aggregate context (a1)
  { from: "worldmonitor", to: "a1",  kind: "dashed" },
  { from: "polymarket",  to: "a1",  kind: "dashed" },

  // LLM providers call the L5 reasoning step (a6), not feed it
  { from: "minimax",   to: "a6",  kind: "purple" },
  { from: "anthropic", to: "a6",  kind: "purple" },
  { from: "gemini",    to: "a6",  kind: "purple" },

  // External positioning -> sizing
  { from: "cftc",      to: "sizing" },

  // Pipeline internal -- L0 feeds downstream layers
  { from: "L0-macroindicators", to: "L1-hype" },
  { from: "L0-macroindicators", to: "L1b-freq" },
  { from: "L0-macroindicators", to: "L3-cycle" },

  // L1 chain: hype -> trade -> edge -> candidates
  { from: "L1-hype",    to: "L1-trade" },
  { from: "L1-trade",   to: "L1-edge" },
  { from: "L1-edge",    to: "L1-mom" },
  { from: "L1-edge",    to: "t-themes" },
  { from: "L1-edge",    to: "t-candidates" },

  // L5 section 11 internal chain
  { from: "a1",         to: "a2" },
  { from: "a2",         to: "a3" },
  { from: "a3",         to: "a4" },
  { from: "a4",         to: "a5" },
  { from: "a5",         to: "a6" },
  { from: "a6",         to: "a7" },
  { from: "a7",         to: "a7b" },
  { from: "a7b",        to: "a8" },
  { from: "a8",         to: "a9" },
  { from: "a9",         to: "sizing" },

  // Section 09 sub-nodes
  { from: "sizing",    to: "q-mandate" },
  { from: "sizing",    to: "q-signal" },
  { from: "sizing",    to: "q-mu" },
  { from: "sizing",    to: "q-opt" },
  { from: "sizing",    to: "q-cost" },
  { from: "sizing",    to: "q-crowd" },
  { from: "sizing",    to: "q-sanc" },
  { from: "sizing",    to: "q-choke" },

  // Book surfaces (L6 -> L7 -> L8)
  { from: "sizing",     to: "f-book" },
  { from: "f-book",     to: "f-attr" },
  { from: "f-attr",     to: "f-ask" },

  // Pipeline -> Tables (writes)
  { from: "L0-macroindicators", to: "t-macro" },
  { from: "L1-hype",    to: "t-themes" },
  { from: "L1-trade",   to: "t-themes" },
  { from: "L1b-freq",   to: "t-narrative" },
  { from: "L2-ols",     to: "t-factors" },
  { from: "L2b-legs",   to: "t-factors" },
  { from: "L3-cycle",   to: "t-regime" },
  { from: "L1-hype",    to: "t-candidates" },
  { from: "L1-trade",   to: "t-candidates" },
  { from: "sizing",     to: "t-positions" },
  { from: "a9",         to: "t-book" },
  { from: "L4-var",     to: "t-risk" },
  { from: "a8",         to: "t-signal" },
  { from: "a9",         to: "t-signal" },
  { from: "a6",         to: "t-picks" },
  { from: "a9",         to: "t-picks" },
  { from: "a9",         to: "t-runs" },
  { from: "t-facts",    to: "a6" },

  // Tables -> Frontend (reads)
  { from: "t-themes",   to: "f-home" },
  { from: "t-macro",    to: "f-home" },
  { from: "t-narrative",to: "f-home" },
  { from: "t-regime",   to: "f-home" },
  { from: "t-book",     to: "f-book" },
  { from: "t-candidates",to: "f-book" },
  { from: "t-positions",to: "f-book" },
  { from: "t-signal",   to: "f-book" },
  { from: "t-picks",    to: "f-book" },
  { from: "t-factors",  to: "f-book" },
  { from: "t-book",     to: "f-mandate" },
  { from: "t-risk",     to: "f-mandate" },
  { from: "t-positions",to: "f-mandate" },
  { from: "t-risk",     to: "f-risk" },
  { from: "t-book",     to: "f-risk" },
  { from: "t-positions",to: "f-risk" },
  { from: "t-factors",  to: "f-risk" },
  { from: "t-signal",   to: "f-risk" },
  { from: "t-picks",    to: "f-attr" },
  { from: "t-book",     to: "f-attr" },
  { from: "t-risk",     to: "f-attr" },
  { from: "t-themes",   to: "f-method" },
  { from: "t-factors",  to: "f-method" },
  { from: "t-book",     to: "f-method" },
  { from: "t-picks",    to: "f-method" },
  { from: "t-themes",   to: "f-ask" },
  { from: "t-book",     to: "f-ask" },
  { from: "t-positions",to: "f-ask" },
  { from: "t-risk",     to: "f-ask" },
  { from: "t-macro",    to: "f-ask" },
  { from: "t-facts",    to: "f-facts" },
];

/**
 * The declared order within each swimlane. A node not in this list is laid
 * out at the end of its lane. The pipeline ordering is the L0–L8 reading
 * order the rest of the app uses (ARCHITECTURE.md · Data Flow); deviating
 * here would be wrong without arguing down the source.
 */
export const swimlaneOrder: Record<NodeType, string[]> = {
  source: [
    "cron",
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
    "minimax",
    "anthropic",
    "gemini",
  ],
  pipeline: [
    "L0",
    "L1",
    "L1b",
    "L2",
    "L2b",
    "L2b-legs",
    "L2b-total",
    "L2b-marg",
    "L2b-s7",
    "L3",
    "L4",
    "L5",
    "L5b",
    "a1",
    "a2",
    "a3",
    "a4",
    "a5",
    "a6",
    "a7",
    "a7b",
    "a8",
    "a9",
    "sizing",
    "q-mandate",
    "q-signal",
    "q-mu",
    "q-opt",
    "q-cost",
    "q-crowd",
    "q-sanc",
    "q-choke",
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
    "t-pipe",
    "t-runs",
    "t-sc",
    "t-bench",
    "t-mkt",
    "t-chat",
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
    "f-exec",
  ],
  verify: [
    "v-eval",
    "v-repl",
    "v-bth",
    "v-bfr",
    "v-reso",
  ],
};
