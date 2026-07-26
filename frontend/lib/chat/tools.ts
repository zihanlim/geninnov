// frontend/lib/chat/tools.ts
//
// What /ask is allowed to know.
//
// THE RULE THIS FILE ENFORCES: the model never computes a number. It asks for
// one. Every figure that can reach a reader is read from a persisted column or
// produced by a function that already renders that same figure on a page —
// `buildSizingChain` is the one on /book, `turnover` is the one on /book,
// `reconcileToBook` is the one in the status ribbon, `assessPipeline` is the one
// behind "6/6 succeeded". Not a reimplementation of them: the imports below are
// the same modules those surfaces import.
//
// That is not tidiness. If the chat had its own copy of the sizing chain, the
// two would drift, and the drift would surface as the product contradicting
// itself in front of the reader who was checking it most carefully. The whole
// point of the feature is that a sceptic can interrogate the book; a sceptic who
// catches the answer disagreeing with the page has been given a reason to
// disbelieve both.
//
// Every tool is READ-ONLY by construction, not by convention — `DbReader`
// exposes `select` and nothing else, so there is no write to review.

import { buildSizingChain, resolvePositionEdge } from "@/lib/book/positionEdge";
import type { CapRow, Pick, ScenarioResult } from "@/lib/book/types";
import { bookAssetsFromPicks } from "@/lib/bookPicks";
import { assessPipeline, EXPECTED_STAGES } from "@/lib/pipelineHealth";
import { reconcileToBook } from "@/lib/risk/bookOfRecord";
import { turnover } from "@/lib/turnover";
import type { DbReader, Fact, ToolContext, ToolResult, ToolSpec } from "./types";

/** Shorthand for a fact, since this file is mostly facts. */
const f = (
  key: string,
  label: string,
  value: number | string | null,
  source: string,
  unit?: Fact["unit"],
  runDate?: string | null,
): Fact => ({ key, label, value, source, unit, runDate });

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** The latest published book row, fetched once per question and shared. */
async function latestBook(
  db: DbReader,
  limit = 1,
): Promise<{ rows: Record<string, unknown>[]; error: string | null }> {
  return db.select(
    "research_recommendations",
    "run_date, picks, book_view, book_risks, book_metrics, scenario_results, cap_utilisation, screening_funnel, independent_ideas, correlation_pairs, lens",
    { order: { column: "run_date", ascending: false }, limit },
  );
}

const picksOf = (row: Record<string, unknown> | undefined): Pick[] =>
  Array.isArray(row?.picks) ? (row!.picks as Pick[]) : [];

/**
 * "The book is empty" and "the book could not be read" are different claims and
 * the reader is owed the difference (goal 2). This produces the sentence for
 * whichever one actually happened.
 */
const noBook = (error: string | null): string =>
  error
    ? `research_recommendations could not be read (${error}). No book figures are available, so nothing in this answer can be sourced.`
    : "research_recommendations has no rows — L5 has not published a book. The pipeline may not have run; /method records the last success per stage.";

// ─────────────────────────────────────────────────────────────────────────────
// Tools
// ─────────────────────────────────────────────────────────────────────────────

const bookSummary: ToolSpec = {
  name: "book_summary",
  description:
    "The published $100M book as a whole: run date, lens, the agent's own book view and named book risks, gross/net/long/short exposure, factor tilts, and every position with its direction, weight, notional and theme. Call this for any question about the book overall, its size, its balance, or which names are in it.",
  args: {},
  async run(args, { db }) {
    const { rows, error } = await latestBook(db);
    const row = rows[0];
    if (!row) {
      return { tool: "book_summary", args, facts: [], absence: noBook(error) };
    }
    const runDate = str(row.run_date);
    const picks = picksOf(row);
    const bm = (row.book_metrics ?? null) as Record<string, unknown> | null;
    const facts: Fact[] = [
      f("book.run_date", "Book run date", runDate, "research_recommendations.run_date", "date", runDate),
      f("book.positions", "Positions in the book", picks.length, "research_recommendations.picks[]", "count", runDate),
      f("book.lens", "Lens", str(row.lens) ?? "multi_asset", "research_recommendations.lens", "text", runDate),
    ];
    if (bm) {
      for (const [key, label] of [
        ["gross_exposure", "Gross exposure"],
        ["net_exposure", "Net exposure"],
        ["long_weight", "Long weight"],
        ["short_weight", "Short weight"],
      ] as const) {
        const v = num(bm[key]);
        if (v !== null) {
          facts.push(f(`book.${key}`, label, v, `research_recommendations.book_metrics.${key}`, "pct", runDate));
        }
      }
      const tilts = (bm.factor_tilts ?? {}) as Record<string, unknown>;
      for (const [factor, v] of Object.entries(tilts)) {
        const n = num(v);
        if (n !== null) {
          facts.push(
            f(`book.tilt.${factor}`, `${factor} tilt`, n, "research_recommendations.book_metrics.factor_tilts", "x", runDate),
          );
        }
      }
    }
    for (const p of picks) {
      const w = num(p.weight);
      if (w !== null) {
        facts.push(f(`position.${p.asset}.weight`, `${p.asset} weight`, w, "research_recommendations.picks[].weight", "pct", runDate));
      }
      const n = num(p.notional);
      if (n !== null) {
        facts.push(f(`position.${p.asset}.notional`, `${p.asset} notional`, n, "research_recommendations.picks[].notional", "usd", runDate));
      }
    }
    return {
      tool: "book_summary",
      args,
      facts,
      notes: {
        // The direction belongs in notes, not facts: it is a word, and the
        // guardrail only adjudicates numbers.
        positions: picks.map(
          (p) => `${p.asset} ${p.direction.toUpperCase()}${p.theme_name ? ` · theme ${p.theme_name}` : ""}`,
        ),
        ...(str(row.book_view) ? { book_view: str(row.book_view)! } : {}),
        ...(Array.isArray(row.book_risks) ? { book_risks: row.book_risks as string[] } : {}),
      },
      absence: bm ? undefined : "book_metrics is null for this run — exposures and factor tilts were not computed, so they cannot be quoted.",
    };
  },
};

const positionDetail: ToolSpec = {
  name: "position_detail",
  description:
    "Everything behind ONE position: its thesis, catalysts, stated risk, counter-thesis, horizon, factor tilts, distance from its 200-day MA, the EdgeScore components that scored it, and the full sizing derivation (conviction → normalised → cap → final weight → notional). Call this for any 'why is X in the book', 'why is X sized like that', or 'what would break X' question.",
  args: {
    asset:
      'The ticker exactly as it appears in the book, e.g. UNH. If you do not know the ticker yet — "the largest position", "the biggest short" — pass one of the selectors instead: largest, smallest, largest_long, largest_short. Never pass a placeholder.',
  },
  async run(args, { db }) {
    const raw = String(args.asset ?? "").trim();
    if (!raw) {
      return { tool: "position_detail", args, facts: [], absence: "No asset was given, so no position could be looked up." };
    }
    let asset = raw.toUpperCase();
    const [{ rows, error }, posRes] = await Promise.all([
      latestBook(db),
      db.select(
        "portfolio_positions",
        "asset, theme_id, edge_score, trend_signal, regime_bias, carry_signal, value_signal, sentiment_signal, conviction, vol",
      ),
    ]);
    const row = rows[0];
    if (!row) return { tool: "position_detail", args, facts: [], absence: noBook(error) };

    const runDate = str(row.run_date);
    const picks = picksOf(row);

    // SELECTORS, because a planner cannot know a ticker it has not fetched yet.
    // Observed on the first live run: asked "why is the largest position sized
    // the way it is", the model planned position_detail(asset: "<largest
    // position ticker>") — a placeholder, because the answer to "which one is
    // largest" was in the OTHER tool's result, which the planner had not seen.
    // The alternatives were a second planning round (one more completion on a
    // shared quota, for every question) or letting the tool resolve it. This is
    // resolution: deterministic, free, and it cannot pick a different name than
    // the weights say.
    const SELECTORS: Record<string, (a: Pick, b: Pick) => number> = {
      LARGEST: (a, b) => Math.abs(num(b.weight) ?? 0) - Math.abs(num(a.weight) ?? 0),
      SMALLEST: (a, b) => Math.abs(num(a.weight) ?? 0) - Math.abs(num(b.weight) ?? 0),
    };
    if (SELECTORS[asset] || asset === "LARGEST_LONG" || asset === "LARGEST_SHORT") {
      const side = asset === "LARGEST_LONG" ? "long" : asset === "LARGEST_SHORT" ? "short" : null;
      const pool = side ? picks.filter((p) => p.direction === side) : picks;
      const sorted = [...pool].sort(SELECTORS[asset] ?? SELECTORS.LARGEST);
      const chosen = sorted[0]?.asset;
      if (!chosen) {
        return {
          tool: "position_detail",
          args: { asset: raw },
          facts: [],
          absence: `No ${side ?? ""} position exists in the ${runDate ?? "latest"} book, so "${raw}" resolves to nothing.`,
        };
      }
      asset = chosen.toUpperCase();
    }

    const pick = picks.find((p) => p.asset?.toUpperCase() === asset);
    if (!pick) {
      return {
        tool: "position_detail",
        args,
        facts: [f("book.run_date", "Book run date", runDate, "research_recommendations.run_date", "date", runDate)],
        absence: /[<>]/.test(raw)
          ? `"${raw}" is a placeholder, not a ticker. Pass a real ticker, or one of the selectors: largest, smallest, largest_long, largest_short. The book holds: ${picks.map((p) => p.asset).join(", ") || "nothing"}.`
          : `${asset} is not in the ${runDate ?? "latest"} book. The book holds: ${picks.map((p) => p.asset).join(", ") || "nothing"}. Use screening_funnel to ask why a name was not taken.`,
      };
    }

    const posRows = (posRes.rows ?? []) as unknown as Parameters<typeof resolvePositionEdge>[0][];
    const edgeRow = posRows.find((r) => String(r?.asset).toUpperCase() === asset);
    const edge = resolvePositionEdge(edgeRow, undefined);

    // The normalisation denominator, computed the same way /book computes it —
    // the sum of |conviction| across every position that has one. Quoting a
    // normalised weight without it would be a naked number.
    const convictionSum = posRows.reduce(
      (acc, r) => (num(r?.conviction) !== null ? acc + Math.abs(r!.conviction as number) : acc),
      0,
    );
    const caps = (row.cap_utilisation ?? null) as { single_name?: CapRow[] } | null;
    const cap = caps?.single_name?.find((c) => c.key?.toUpperCase() === asset);

    const chain = buildSizingChain({
      direction: pick.direction,
      edge,
      weight: pick.weight,
      signedWeight: pick.signed_weight,
      notional: pick.notional,
      hypeScore: pick.hype_score,
      cap: cap ? { weight: cap.weight, cap: cap.cap, utilisation: cap.utilisation, breached: cap.breached } : undefined,
      convictionSum: convictionSum > 0 ? convictionSum : null,
    });

    const src = "research_recommendations.picks[]";
    const facts: Fact[] = [
      f("book.run_date", "Book run date", runDate, "research_recommendations.run_date", "date", runDate),
    ];
    const push = (key: string, label: string, v: number | null, source: string, unit: Fact["unit"]) => {
      if (v !== null) facts.push(f(key, label, v, source, unit, runDate));
    };
    push(`position.${asset}.weight`, `${asset} weight`, num(pick.weight), `${src}.weight`, "pct");
    push(`position.${asset}.signed_weight`, `${asset} signed weight`, num(pick.signed_weight), `${src}.signed_weight`, "pct");
    push(`position.${asset}.notional`, `${asset} notional`, num(pick.notional), `${src}.notional`, "usd");
    push(`position.${asset}.hype_score`, `${asset} HypeScore`, num(pick.hype_score), `${src}.hype_score`, "score");
    push(`position.${asset}.trade_score`, `${asset} TradeScore`, num(pick.trade_score), `${src}.trade_score`, "score");
    push(`position.${asset}.edge_score`, `${asset} EdgeScore`, edge.edge_score, "portfolio_positions.edge_score", "score");
    push(`position.${asset}.conviction`, `${asset} conviction`, edge.conviction, "portfolio_positions.conviction", "x");
    push(`position.${asset}.vol`, `${asset} volatility`, edge.vol, "portfolio_positions.vol", "pct");
    for (const [k, label] of [
      ["trend_signal", "trend"],
      ["regime_bias", "regime bias"],
      ["carry_signal", "carry"],
      ["value_signal", "value"],
      ["sentiment_signal", "sentiment"],
    ] as const) {
      push(`position.${asset}.${k}`, `${asset} ${label} signal`, edge[k], `portfolio_positions.${k}`, "score");
    }
    if (cap) {
      push(`position.${asset}.cap`, `${asset} single-name cap`, num(cap.cap), "research_recommendations.cap_utilisation.single_name[].cap", "pct");
      push(`position.${asset}.cap_utilisation`, `${asset} cap utilisation`, num(cap.utilisation), "research_recommendations.cap_utilisation.single_name[].utilisation", "pct");
    }
    if (pick.ma_context) {
      push(`position.${asset}.pct_from_ma`, `${asset} distance from 200d MA`, num(pick.ma_context.pct_from_ma), `${src}.ma_context.pct_from_ma`, "pct");
      push(`position.${asset}.last`, `${asset} last price`, num(pick.ma_context.last), `${src}.ma_context.last`, "usd_price");
      push(`position.${asset}.ma`, `${asset} 200d MA`, num(pick.ma_context.ma), `${src}.ma_context.ma`, "usd_price");
    }
    for (const [factor, v] of Object.entries(pick.factor_tilts ?? {})) {
      push(`position.${asset}.tilt.${factor}`, `${asset} ${factor} beta`, num(v), `${src}.factor_tilts`, "x");
    }
    push(`position.${asset}.factor_r2`, `${asset} factor R²`, num(pick.factor_r_squared), `${src}.factor_r_squared`, "x");

    return {
      tool: "position_detail",
      args: { asset },
      facts,
      notes: {
        direction: pick.direction.toUpperCase(),
        ...(pick.theme_name ? { theme: pick.theme_name } : {}),
        ...(pick.thesis ? { thesis: pick.thesis } : {}),
        ...(pick.catalysts?.length ? { catalysts: pick.catalysts } : {}),
        ...(pick.risk ? { risk: pick.risk } : {}),
        ...(pick.counter_thesis ? { counter_thesis: pick.counter_thesis } : {}),
        ...(pick.time_horizon ? { time_horizon: pick.time_horizon } : {}),
        // The sizing chain as /book renders it, headline and all. Prose, because
        // the numbers inside it are already facts above.
        sizing_headline: chain.headline,
        sizing_steps: chain.steps.map((s) => `${s.label}: ${s.display}${s.clamped ? " (clamped by a cap)" : ""}`),
        ...(chain.reconciliation ? { sizing_reconciliation: chain.reconciliation } : {}),
      },
      absence:
        edge.source === "none"
          ? `EdgeScore components were not persisted for ${asset} on this run, so the signal breakdown cannot be quoted — only the sizing outcome can.`
          : undefined,
    };
  },
};

const regimeTool: ToolSpec = {
  name: "regime",
  description:
    "The L3 macro regime: cycle × sentiment, and the four inputs that classified it (yield-curve slope, HY OAS, VIX level, real rate, SPX breadth). Call this for any question about the macro backdrop or why the book is tilted the way it is.",
  args: {},
  async run(args, { db }) {
    const { rows, error } = await db.select(
      "regime_classifications",
      "run_date, cycle, sentiment, yield_curve_slope, hy_oas, vix_level, vix_term_diff, real_rate, spx_breadth",
      { order: { column: "run_date", ascending: false }, limit: 1 },
    );
    const row = rows[0];
    if (!row) {
      return {
        tool: "regime",
        args,
        facts: [],
        absence: error
          ? `regime_classifications could not be read (${error}).`
          : "regime_classifications has no rows — L3 has not classified a regime, so the macro backdrop cannot be stated.",
      };
    }
    const runDate = str(row.run_date);
    const facts: Fact[] = [
      f("regime.run_date", "Regime run date", runDate, "regime_classifications.run_date", "date", runDate),
    ];
    for (const [k, label, unit] of [
      ["yield_curve_slope", "Yield-curve slope", "pct_points"],
      ["hy_oas", "HY OAS", "pct_points"],
      ["vix_level", "VIX", "score"],
      ["vix_term_diff", "VIX term structure", "score"],
      ["real_rate", "Real rate", "pct_points"],
      ["spx_breadth", "S&P breadth", "pct"],
    ] as const) {
      const v = num(row[k]);
      if (v !== null) facts.push(f(`regime.${k}`, label, v, `regime_classifications.${k}`, unit, runDate));
    }
    return {
      tool: "regime",
      args,
      facts,
      notes: {
        cycle: str(row.cycle) ?? "—",
        sentiment: str(row.sentiment) ?? "—",
        classification: `${str(row.cycle) ?? "—"} × ${str(row.sentiment) ?? "—"}`,
      },
    };
  },
};

const riskMetrics: ToolSpec = {
  name: "risk_metrics",
  description:
    "L4 portfolio risk (VaR 95, CVaR 95, Sharpe, beta, concentration HHI, capital) and the five stress scenarios with their estimated book return and dollar P&L. Call this for anything about risk, drawdown, stress, or what happens if the market moves.",
  args: {},
  async run(args, { db }) {
    const [riskRes, bookRes] = await Promise.all([
      db.select("portfolio_risk", "total_capital, var_95, cvar_95, sharpe, beta, concentration_hhi, updated_at", {
        order: { column: "updated_at", ascending: false },
        limit: 1,
      }),
      latestBook(db),
    ]);
    const risk = riskRes.rows[0];
    const book = bookRes.rows[0];
    const runDate = str(book?.run_date ?? null);
    const facts: Fact[] = [];
    if (risk) {
      for (const [k, label, unit] of [
        ["var_95", "VaR 95%", "usd"],
        ["cvar_95", "CVaR 95%", "usd"],
        ["sharpe", "Sharpe", "x"],
        ["beta", "Beta", "x"],
        ["concentration_hhi", "Concentration HHI", "x"],
        ["total_capital", "Total capital", "usd"],
      ] as const) {
        const v = num(risk[k]);
        if (v !== null) facts.push(f(`risk.${k}`, label, v, `portfolio_risk.${k}`, unit, runDate));
      }
    }
    const scenarios = (book?.scenario_results ?? null) as ScenarioResult[] | null;
    for (const s of scenarios ?? []) {
      const r = num(s.estimated_book_return);
      if (r !== null) {
        facts.push(f(`scenario.${s.scenario_name}.return`, `${s.label} — book return`, r, "research_recommendations.scenario_results[].estimated_book_return", "pct", runDate));
      }
      const p = num(s.estimated_dollar_pnl);
      if (p !== null) {
        facts.push(f(`scenario.${s.scenario_name}.pnl`, `${s.label} — P&L`, p, "research_recommendations.scenario_results[].estimated_dollar_pnl", "usd", runDate));
      }
    }
    return {
      tool: "risk_metrics",
      args,
      facts,
      notes: scenarios?.length
        ? { scenarios: scenarios.map((s) => `${s.label} (severity ${s.severity})`) }
        : undefined,
      absence: !risk
        ? "portfolio_risk has no rows — L4 has not computed risk for this book, so VaR, Sharpe and beta cannot be quoted."
        : !scenarios?.length
          ? "scenario_results is empty for this run — the book was not stress-tested, so scenario numbers cannot be quoted."
          : undefined,
    };
  },
};

const themeScores: ToolSpec = {
  name: "theme_scores",
  description:
    "The theme roster ranked by HypeScore, with the four sub-scores that compose it (volume, sentiment, correlation, momentum), plus tier and discovery source. Call this for questions about themes, what the engine is detecting, or how a theme scored.",
  args: { limit: "How many themes to return, highest HypeScore first. Default 12." },
  async run(args, { db }) {
    const limit = Math.min(Math.max(Number(args.limit) || 12, 1), 40);
    const { rows, error } = await db.select(
      "themes",
      "id, name, tier, source, hype_score, volume_score, sentiment_score, corr_score, momentum_score, updated_at",
      { order: { column: "hype_score", ascending: false }, limit },
    );
    if (!rows.length) {
      return {
        tool: "theme_scores",
        args,
        facts: [],
        absence: error ? `themes could not be read (${error}).` : "themes has no rows — nothing has been scored.",
      };
    }
    const facts: Fact[] = [];
    for (const r of rows) {
      const name = str(r.name) ?? "?";
      for (const [k, label, unit] of [
        ["hype_score", "HypeScore", "score"],
        ["volume_score", "volume sub-score", "score"],
        ["sentiment_score", "sentiment sub-score", "score"],
        ["corr_score", "correlation sub-score", "score"],
        ["momentum_score", "momentum sub-score", "score"],
      ] as const) {
        const v = num(r[k]);
        if (v !== null) facts.push(f(`theme.${name}.${k}`, `${name} ${label}`, v, `themes.${k}`, unit, str(r.updated_at)));
      }
    }
    return {
      tool: "theme_scores",
      args: { limit },
      facts,
      notes: { themes: rows.map((r) => `${str(r.name)} (tier ${str(r.tier)}, source ${str(r.source)})`) },
    };
  },
};

const macroTool: ToolSpec = {
  name: "macro_indicators",
  description:
    "The L0 macro snapshot: every FRED/yfinance series with its latest value, unit and fetch date. Call this when a question needs a macro level (rates, spreads, the dollar, oil, gold).",
  args: {},
  async run(args, { db }) {
    const { rows, error } = await db.select(
      "macro_indicators",
      "series_id, series_name, value, unit, fetch_date",
      { order: { column: "fetch_date", ascending: false }, limit: 60 },
    );
    if (!rows.length) {
      return {
        tool: "macro_indicators",
        args,
        facts: [],
        absence: error
          ? `macro_indicators could not be read (${error}).`
          : "macro_indicators has no rows — L0 did not run, so no macro level can be quoted (FRED_API_KEY may be unset).",
      };
    }
    // One row per series: the table is a per-(series, date) history and the
    // question is always about the latest.
    const seen = new Set<string>();
    const facts: Fact[] = [];
    for (const r of rows) {
      const id = str(r.series_id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const v = num(r.value);
      if (v !== null) {
        facts.push(f(`macro.${id}`, `${str(r.series_name) ?? id} (${str(r.unit) ?? "—"})`, v, "macro_indicators.value", "score", str(r.fetch_date)));
      }
    }
    return { tool: "macro_indicators", args, facts };
  },
};

const pipelineStatus: ToolSpec = {
  name: "pipeline_status",
  description:
    "Whether the pipeline actually ran: per-stage status for the latest run date, which stages are missing or incomplete, and how the published book reconciles against portfolio_positions. Call this for 'is this current', 'did it run', or 'why is the data stale'.",
  args: {},
  async run(args, { db }) {
    const [runsRes, bookRes, posRes] = await Promise.all([
      db.select("pipeline_runs", "run_date, stage, status, finished_at, duration_s", {
        order: { column: "run_date", ascending: false },
        limit: 40,
      }),
      latestBook(db),
      db.select("portfolio_positions", "asset"),
    ]);
    const health = assessPipeline(runsRes.rows as never);
    const book = bookRes.rows[0];
    const runDate = str(book?.run_date ?? null);
    const recon = reconcileToBook(
      (posRes.rows ?? []).map((r) => String(r.asset)),
      bookAssetsFromPicks(book?.picks),
    );
    const facts: Fact[] = [
      f("pipeline.run_date", "Latest pipeline run date", str(runsRes.rows[0]?.run_date ?? null), "pipeline_runs.run_date", "date"),
      f("pipeline.stages_recorded", "Stages recorded", health.ran.length, "pipeline_runs.stage", "count"),
      f("pipeline.stages_expected", "Stages expected", EXPECTED_STAGES.length, "lib/pipelineHealth.EXPECTED_STAGES", "count"),
      f("book.run_date", "Book run date", runDate, "research_recommendations.run_date", "date", runDate),
      f("recon.book_count", "Names in the published book", recon.bookCount, "research_recommendations.picks[]", "count", runDate),
      f("recon.position_count", "Rows in portfolio_positions", recon.positionCount, "portfolio_positions.asset", "count"),
    ];
    return {
      tool: "pipeline_status",
      args,
      facts,
      notes: {
        health: health.health,
        summary: health.label,
        detail: health.detail,
        reconciled: recon.reconciled
          ? "portfolio_positions matches the published book"
          : "portfolio_positions holds L1's provisional candidate pool and has not been reconciled down to the published book yet (ADR-0040) — risk numbers computed on it describe the pool, not the book",
      },
      absence: health.missing.length
        ? `These stages did not record a run on ${str(runsRes.rows[0]?.run_date ?? null) ?? "the latest date"}: ${health.missing.join(", ")}.`
        : undefined,
    };
  },
};

const screeningFunnel: ToolSpec = {
  name: "screening_funnel",
  description:
    "Why a name is NOT in the book: the screening funnel stage counts, the independent-idea count per side, and the candidate pool with each name's EdgeScore. Call this whenever the question is about something absent from the book, or about how deep the pool was.",
  args: { asset: "Optional ticker to look up in the candidate pool, e.g. NVDA." },
  async run(args, { db }) {
    const asset = String(args.asset ?? "").trim().toUpperCase();
    const [{ rows, error }, candRes] = await Promise.all([
      latestBook(db),
      db.select("trade_candidates", "asset, direction, edge_score, theme_id, run_date, via_conviction", {
        order: { column: "run_date", ascending: false },
        limit: 200,
      }),
    ]);
    const row = rows[0];
    if (!row) return { tool: "screening_funnel", args, facts: [], absence: noBook(error) };
    const runDate = str(row.run_date);
    const funnel = (row.screening_funnel ?? []) as { stage?: string; label?: string; count?: number }[];
    const facts: Fact[] = [];
    for (const s of funnel) {
      const c = num(s.count);
      if (c !== null) {
        facts.push(f(`funnel.${s.stage ?? s.label}`, `Funnel — ${s.label ?? s.stage}`, c, "research_recommendations.screening_funnel[].count", "count", runDate));
      }
    }
    facts.push(f("funnel.candidate_pool", "Candidate pool size", candRes.rows.length, "trade_candidates.asset", "count", runDate));

    const notes: Record<string, string | string[]> = {};
    if (asset) {
      const inBook = picksOf(row).some((p) => p.asset?.toUpperCase() === asset);
      const cand = candRes.rows.find((r) => String(r.asset).toUpperCase() === asset);
      if (cand) {
        const e = num(cand.edge_score);
        if (e !== null) {
          facts.push(f(`candidate.${asset}.edge_score`, `${asset} EdgeScore in the pool`, e, "trade_candidates.edge_score", "score", str(cand.run_date)));
        }
        notes[asset] = inBook
          ? `${asset} cleared the screen AND was taken into the book.`
          : `${asset} cleared the screen as a ${String(cand.direction)} candidate but was NOT taken into the book — it lost the ranking, or a cap or correlation constraint bound first.`;
      } else {
        notes[asset] = `${asset} is not in the candidate pool for this run at all, so it never reached the ranking stage.`;
      }
    }
    return {
      tool: "screening_funnel",
      args: asset ? { asset } : {},
      facts,
      notes,
      absence: funnel.length ? undefined : "screening_funnel is empty for this run — the stage counts were not persisted, so the funnel cannot be quoted.",
    };
  },
};

const bookTurnover: ToolSpec = {
  name: "book_turnover",
  description:
    "How much the book changed against the previous published run: names kept, opened, closed, and turnover percent. Call this for 'would you get the same answer tomorrow', stability, or churn questions.",
  args: {},
  async run(args, { db }) {
    const { rows, error } = await latestBook(db, 2);
    if (!rows.length) return { tool: "book_turnover", args, facts: [], absence: noBook(error) };
    if (rows.length < 2) {
      return {
        tool: "book_turnover",
        args,
        facts: [f("book.run_date", "Book run date", str(rows[0].run_date), "research_recommendations.run_date", "date", str(rows[0].run_date))],
        absence: "Only one published run exists, so there is no previous book to measure turnover against.",
      };
    }
    const current = bookAssetsFromPicks(rows[0].picks) ?? [];
    const previous = bookAssetsFromPicks(rows[1].picks) ?? [];
    const t = turnover(current, previous);
    const runDate = str(rows[0].run_date);
    return {
      tool: "book_turnover",
      args,
      facts: [
        f("turnover.pct", "Turnover", t.pct, "lib/turnover.turnover() over research_recommendations.picks[]", "pct", runDate),
        f("turnover.kept", "Names kept", t.kept.length, "lib/turnover.turnover()", "count", runDate),
        f("turnover.opened", "Names opened", t.opened.length, "lib/turnover.turnover()", "count", runDate),
        f("turnover.closed", "Names closed", t.closed.length, "lib/turnover.turnover()", "count", runDate),
        f("turnover.previous_run_date", "Previous run date", str(rows[1].run_date), "research_recommendations.run_date", "date"),
      ],
      notes: {
        kept: t.kept,
        opened: t.opened,
        closed: t.closed,
      },
    };
  },
};

export const TOOLS: ToolSpec[] = [
  bookSummary,
  positionDetail,
  regimeTool,
  riskMetrics,
  themeScores,
  macroTool,
  pipelineStatus,
  screeningFunnel,
  bookTurnover,
];

export const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/**
 * Run one planned tool call, never throwing.
 *
 * A tool that throws must degrade to a stated absence rather than a 500: the
 * reader gets a worse answer, not a broken page, and the model is told what it
 * could not see so it says so.
 */
export async function runTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const spec = TOOL_BY_NAME.get(name);
  if (!spec) {
    return { tool: name, args, facts: [], absence: `No tool named "${name}" exists, so nothing was read.` };
  }
  const started = Date.now();
  try {
    const out = await spec.run(args, ctx);
    return { ...out, ms: Date.now() - started };
  } catch (err) {
    return {
      tool: name,
      args,
      facts: [],
      absence: `${name} failed: ${err instanceof Error ? err.message : String(err)}. No figures from it can be used.`,
      ms: Date.now() - started,
    };
  }
}
