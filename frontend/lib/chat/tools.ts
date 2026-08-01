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
import { sampleAdequacy } from "@/lib/risk/sampleAdequacy";
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
    "run_date, picks, book_view, book_risks, book_metrics, scenario_results, cap_utilisation, screening_funnel, independent_ideas, correlation_pairs, lens, " +
      // Ex-ante risk (038, 047) and sizing provenance (047). Added to the SHARED reader so
      // every tool sees the same book row — a second select would let two tools answer from
      // two different runs if one landed mid-publication.
      "risk_decomposition, monte_carlo_var, var_forecast, sizing_method, sizing_reason, optimizer_result, heuristic_weights, rebalance_cost",
    {
      order: { column: "run_date", ascending: false },
      limit,
      // Migration 062 re-keyed this table on (run_date, lens) — more than one row can
      // now exist per run_date. /ask and the MCP server only ever discuss the
      // multi-asset book (the credit lens has no track record and is not part of
      // this contract yet — ADR-0194), so the read is explicit rather than
      // depending on whichever row Postgres returns first for a tied run_date.
      eq: { lens: "multi_asset" },
    },
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
    "The L3 macro regime: cycle × sentiment with its classifier inputs (yield-curve slope, HY OAS, VIX level, real rate, SPX breadth), plus the ADR-0139/0140 cross-current readings — dollar-debasement pressure (0–100 composite with four components) and Fed posture (hawkish/neutral/dovish with the 13-week pivot delta). Call this for any question about the macro backdrop, Fed policy stance, dollar debasement, or why the book is tilted the way it is.",
  args: {},
  async run(args, { db }) {
    const { rows, error } = await db.select(
      "regime_classifications",
      "run_date, cycle, sentiment, yield_curve_slope, hy_oas, vix_level, vix_term_diff, real_rate, spx_breadth, " +
        "debasement_pressure, debasement_real_yield_comp, debasement_dxy_decline_comp, debasement_gold_rise_comp, " +
        "debasement_comovement_comp, debasement_lookback_weeks, fed_posture, fed_pivot_delta, " +
        "fed_rate_change_13w_bps, fed_curve_change_13w_bps, fed_curve_steepness_bps",
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
      // 65 means 65% of SPX constituents above their 200d MA — the unit
      // RegimeInputsPanel renders. Tagged `pct` here, it read as 6500%.
      ["spx_breadth", "S&P breadth (% of SPX above 200d MA)", "pct_whole"],
      // ADR-0139: composite is a 0–100 dial; components are 0–1 shares of
      // their own fixed anchors. NULL rows simply emit no fact — an absent
      // reading is "we cannot say", never zero (ADR-0091).
      ["debasement_pressure", "Dollar-debasement pressure (0–100)", "score"],
      ["debasement_real_yield_comp", "Debasement component: real yield vs −2% anchor (0–1)", "score"],
      ["debasement_dxy_decline_comp", "Debasement component: DXY drawdown from 26w peak vs 5% (0–1)", "score"],
      ["debasement_gold_rise_comp", "Debasement component: gold 26w return vs +20% (0–1)", "score"],
      ["debasement_comovement_comp", "Debasement component: real-yield↔gold daily co-movement (0–1)", "score"],
      // ADR-0140: pivot is signed, sign(dovish)=+1 so +2 = hawkish → dovish.
      ["fed_pivot_delta", "Fed pivot delta vs 13 weeks ago (sign(dovish)=+1)", "score"],
      ["fed_rate_change_13w_bps", "DFF change over 13 weeks", "bp"],
      ["fed_curve_change_13w_bps", "2s10s change over 13 weeks (steepening = market pricing cuts)", "bp"],
      ["fed_curve_steepness_bps", "Current 2s10s steepness", "bp"],
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
        // ADR-0140: a label, not a number, so it travels as a note. NULL is
        // rendered as absence — the model may not call the posture "neutral"
        // when the truth is "not computable".
        fed_posture: str(row.fed_posture) ?? "not computable (an input was missing)",
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
    const [riskRes, bookRes, sessionsRes] = await Promise.all([
      db.select("portfolio_risk", "total_capital, var_95, cvar_95, sharpe, beta, concentration_hhi, updated_at, var_95_historical, es_95_historical, sortino, max_drawdown, calmar, tracking_error, information_ratio", {
        order: { column: "updated_at", ascending: false },
        limit: 1,
      }),
      latestBook(db),
      // The sample every estimated statistic below is judged against. Counted by reading
      // one column rather than by widening `DbReader` with a `count`: that interface is
      // deliberately minimal so the read-only claim stays structural, and this table gains
      // one row per trading day, so the read is small and bounded in practice.
      db.select("portfolio_returns", "run_date"),
    ]);
    const risk = riskRes.rows[0];
    const book = bookRes.rows[0];
    const runDate = str(book?.run_date ?? null);
    const facts: Fact[] = [];

    // How many sessions of realised return history exist. A statistic below its declared
    // minimum is WITHHELD here exactly as the /risk tile withholds it — otherwise /ask and
    // the MCP server quote a number the page refuses to show (ADR-0100). On the 2026-07-25
    // book that was a Sharpe of 6.32 from three observations against a minimum of 60.
    // `null` on a failed read, NOT 0 — `sampleAdequacy` treats an unknown sample as
    // unjudged and does not withhold, so a transient read error degrades to today's
    // behaviour rather than blacking out every figure.
    const sessions = sessionsRes.error ? null : sessionsRes.rows.length;
    const withheld: string[] = [];

    if (risk) {
      // EVERY LABEL CARRIES ITS METHOD AND HORIZON. There are now four figures a reader
      // may call "VaR" and they differ by an order of magnitude, mostly because of
      // horizon rather than method. A model handed two facts both labelled "VaR 95%"
      // will state one and cite the other — the regression PROGRESS records twice
      // (ADR-0082). The label is the only thing standing between it and that.
      for (const [k, label, unit] of [
        ["var_95", "VaR 95% (parametric, 1-day, realised)", "usd"],
        ["cvar_95", "CVaR 95% (parametric, 1-day, realised)", "usd"],
        ["var_95_historical", "VaR 95% (historical/empirical, 1-day, realised)", "usd"],
        ["es_95_historical", "Expected shortfall 95% (historical, 1-day, realised)", "usd"],
        ["sharpe", "Sharpe (annualised)", "x"],
        ["sortino", "Sortino (annualised, downside-only denominator)", "x"],
        ["calmar", "Calmar (annualised return over max drawdown)", "x"],
        ["max_drawdown", "Max drawdown (realised, peak-to-trough, negative)", "pct"],
        ["tracking_error", "Tracking error vs benchmark (annualised)", "pct"],
        ["information_ratio", "Information ratio vs benchmark", "x"],
        ["beta", "Beta", "x"],
        ["concentration_hhi", "Concentration HHI", "x"],
        ["total_capital", "Total capital", "usd"],
      ] as const) {
        const v = num(risk[k]);
        if (v === null) continue;
        const adequacy = sampleAdequacy(k, sessions);
        if (!adequacy.ok) {
          // Named in `absence` rather than silently dropped: a model that cannot see the
          // figure must still be told it exists and why it is not quotable, or it will
          // report "no VaR is available" — a different and wrong claim.
          withheld.push(`${label} (${adequacy.reason})`);
          continue;
        }
        facts.push(f(`risk.${k}`, label, v, `portfolio_risk.${k}`, unit, runDate));
      }
    }
    // ── Ex-ante risk, from the CONSTITUENTS' covariance ────────────────────────────
    // Deliberately NOT gated on `sessions`. These borrow history from the assets rather
    // than from the book, which is the entire reason they exist: a two-day-old book has a
    // meaningful ex-ante VaR and a meaningless realised one. Gating them on the book's own
    // age would withhold the only risk numbers it has.
    const decomposition = book?.risk_decomposition as Record<string, unknown> | null;
    const exAnteVar = num(decomposition?.portfolio_var);
    if (exAnteVar !== null) {
      facts.push(f("risk.var_95_ex_ante", "VaR 95% (ex-ante, from constituent covariance, ANNUALISED)", exAnteVar, "research_recommendations.risk_decomposition.portfolio_var", "pct", runDate));
    }
    const exAnteVol = num(decomposition?.portfolio_vol);
    if (exAnteVol !== null) {
      facts.push(f("risk.portfolio_vol_ex_ante", "Book volatility (ex-ante, annualised)", exAnteVol, "research_recommendations.risk_decomposition.portfolio_vol", "pct", runDate));
    }

    const mc = book?.monte_carlo_var as Record<string, unknown> | null;
    const mcHorizon = num(mc?.horizon_days);
    const mcBands = Array.isArray(mc?.bands) ? (mc!.bands as Record<string, unknown>[]) : [];
    for (const band of mcBands) {
      const conf = num(band.confidence);
      const value = num(band.var);
      if (conf === null || value === null) continue;
      const pctLabel = `${(conf * 100).toFixed(0)}%`;
      facts.push(f(
        `risk.monte_carlo_var_${pctLabel.replace("%", "")}`,
        `VaR ${pctLabel} (Monte Carlo, Student-t, ${mcHorizon ?? 21}-day, ex-ante)`,
        value,
        "research_recommendations.monte_carlo_var.bands[].var",
        "pct",
        runDate,
      ));
    }

    const fanBands = Array.isArray((book?.var_forecast as Record<string, unknown> | null)?.bands)
      ? ((book!.var_forecast as Record<string, unknown>).bands as Record<string, unknown>[])
      : [];
    for (const band of fanBands) {
      const horizon = num(band.horizon_days);
      const p95 = num((band.quantiles as Record<string, unknown> | undefined)?.p95);
      if (horizon === null || p95 === null) continue;
      facts.push(f(
        `risk.var_forecast_${horizon}d`,
        `VaR 95% (square-root-of-time projection, ${horizon}-day, ex-ante)`,
        p95,
        "research_recommendations.var_forecast.bands[].quantiles.p95",
        "pct",
        runDate,
      ));
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
        : withheld.length
          ? `These statistics EXIST in portfolio_risk but are not quotable, because the return ` +
            `sample cannot support them: ${withheld.join("; ")}. Say they are not published ` +
            `at this sample size — do NOT say they are unavailable or that the book has no ` +
            `risk figures.` +
            (scenarios?.length
              ? ""
              : " Separately, scenario_results is empty for this run, so scenario numbers cannot be quoted.")
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

// ADR-0218: read the structured_facts table the L5 cites. Category is
// the one filter the L5 actually uses ("what do we know about
// ai_capex?"), entity is a free-text match for "is X in the table?",
// metric narrows a known entity. The result is one Fact per (entity,
// metric) pair at its most recent as_of — the same shape the L5
// prompt renders.
const structuredFactsTool: ToolSpec = {
  name: "structured_facts",
  description:
    "The hand-curated `structured_facts` table the L5 reasoning agent cites (ADR-0218). Each fact is (entity, metric, value, unit, as_of, source, confidence). Call this when a question asks about hyperscaler capex, cash runways, Chinese AI model releases, OpenRouter share, FOMC probabilities, equity risk premium, MIT/Bain/JPM research findings, or any other 'is there a fact the system can defend' question. Pass `category` to read all facts in one bucket; pass `entity` to scope to one subject; pass `metric` to narrow further.",
  args: {
    category:
      "Optional. One of 'ai_capex', 'china_ai', 'macro', 'valuation'. Returns all facts in the category. Omit to read all.",
    entity:
      "Optional. Filters to one entity, e.g. 'MSFT' or 'industry:hyperscaler' or 'OpenRouter'.",
    metric:
      "Optional. Narrows to one metric, e.g. 'capex_fy26_bn'. Combine with entity for an exact match.",
  },
  async run(args, { db }) {
    const category = str(args.category);
    const entity = str(args.entity);
    const metric = str(args.metric);
    const filters: Record<string, unknown> = { order: { column: "as_of", ascending: false }, limit: 200 };
    if (category) filters.eq = { ...(filters.eq as object ?? {}), category };
    if (entity)    filters.eq = { ...(filters.eq as object ?? {}), entity };
    if (metric)    filters.eq = { ...(filters.eq as object ?? {}), metric };
    const { rows, error } = await db.select(
      "structured_facts",
      "entity, metric, value, unit, as_of, source, source_url, confidence, category, notes",
      filters,
    );
    if (!rows.length) {
      return {
        tool: "structured_facts",
        args,
        facts: [],
        absence: error
          ? `structured_facts could not be read (${error}).`
          : category
            ? `No structured_facts rows in category='${category}'${entity ? ` for entity='${entity}'` : ""}${metric ? ` metric='${metric}'` : ""}. The fact the user is asking about is not in the table — say so rather than inventing it.`
            : "structured_facts has no rows. The seed has not been loaded; run the loader to populate it.",
      };
    }
    // Per (entity, metric) keep the most recent as_of. The natural key
    // is (entity, metric, as_of), so the order-by-as_of-DESC walk picks
    // the freshest row per pair by taking the first occurrence.
    const seen = new Set<string>();
    const facts: Fact[] = [];
    for (const r of rows) {
      const e = str(r.entity), m = str(r.metric);
      if (!e || !m) continue;
      const key = `${e}:${m}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const v = num(r.value);
      const asOf = str(r.as_of);
      const conf = str(r.confidence) ?? "?";
      const src = str(r.source) ?? "?";
      const unit = str(r.unit) ?? "";
      const label = `${e} / ${m}`;
      const value = v !== null ? v : str(r.value) ?? "—";
      // Confidence is a property of the cite, not a number. Carry it
      // in the label so the guardrail sees it on the read side.
      facts.push(
        f(`structured_facts.${e}.${m}`,
          `${label} (${conf})`,
          value,
          src,
          "score",
          asOf,
        ),
      );
    }
    return {
      tool: "structured_facts",
      args,
      facts,
      notes: error ? { read_error: error } : undefined,
    };
  },
};

// ADR-0217: read the computable_macro JSONB on the latest regime
// row. The runner writes three derived readings (erp, equity_bond_corr,
// ndx_seasonality); this tool pulls them with their status so the
// guardrail sees 'unknown' rather than treating a missing value as
// zero.
const computableMacroTool: ToolSpec = {
  name: "computable_macro",
  description:
    "The three computable-from-existing-data macro analytics on the latest regime row (ADR-0217): ERP (earnings yield − 10y), equity_bond_corr (60d rolling SPX × DGS10 with the SocGen flip flag), ndx_seasonality (per-month NDX 1990-2025 + midterm-year subset). Each metric carries its own status — measured / insufficient_history / unknown. Call this when a question asks for ERP, equity-bond correlation, or NDX seasonality; the values come from regime_classifications.computable_macro, not from a re-derivation.",
  args: {},
  async run(args, { db }) {
    const { rows, error } = await db.select(
      "regime_classifications",
      "run_date, computable_macro",
      { order: { column: "run_date", ascending: false }, limit: 1 },
    );
    const row = rows[0];
    const cm = (row?.computable_macro ?? null) as Record<string, Record<string, unknown>> | null;
    if (!cm || typeof cm !== "object") {
      return {
        tool: "computable_macro",
        args,
        facts: [],
        absence: error
          ? `regime_classifications could not be read (${error}).`
          : "The L3a runner has not written computable_macro yet — the JSONB column is null. Run scripts/daily_refresh.py to populate.",
      };
    }
    const runDate = str(row?.run_date);
    const facts: Fact[] = [];
    for (const metric of ["erp", "equity_bond_corr", "ndx_seasonality"] as const) {
      const m = cm[metric];
      if (!m || typeof m !== "object") continue;
      const status = str(m.status) ?? "unknown";
      // Per-metric: render the inner key the L5 cites most. ADR-0220's
      // citation guardrail accepts any inner key, but the prompt
      // names these specifically.
      let primaryKey: string;
      switch (metric) {
        case "erp": primaryKey = "erp_pct"; break;
        case "equity_bond_corr": primaryKey = "corr"; break;
        case "ndx_seasonality": primaryKey = "n_observations"; break;
      }
      const v = m[primaryKey];
      const n = num(v);
      if (n !== null) {
        facts.push(
          f(`computable_macro.${metric}.${primaryKey}`,
            `${metric} (${status})`,
            n,
            `regime_classifications.computable_macro.${metric}.${primaryKey}`,
            "score",
            runDate,
          ),
        );
      }
    }
    return { tool: "computable_macro", args, facts };
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


/**
 * How the published book was sized.
 *
 * The single most-asked question about a book after "what is in it" is "why that size",
 * and until migration 047 the answer was not in the data at all — ADR-0053 records a book
 * every surface described as conviction-sized while it was in fact hype-sized, because
 * nothing persisted which path had run.
 *
 * Deliberately a SEPARATE tool from `position_detail`, which answers the per-name sizing
 * chain. This answers the book-level question: which model sized it, what the other one
 * would have done, and what the crowding input reached.
 */
const sizingProvenance: ToolSpec = {
  name: "sizing_provenance",
  description:
    "How the published book was sized: which model set the weights (constrained mean-variance optimizer, or the conviction fallback, and why), the expected-return IC it used, what the alternative sizing would have given, the cost of the difference, and how much of the book the crowding input could actually see. Call this for anything about position sizing, weights, why a position is the size it is, the optimizer, or the efficient frontier.",
  args: {},
  async run(args, { db }) {
    const bookRes = await latestBook(db);
    const book = bookRes.rows[0];
    if (!book) {
      return {
        tool: "sizing_provenance",
        args,
        facts: [],
        absence:
          bookRes.error
            ? `research_recommendations could not be read (${bookRes.error}).`
            : "research_recommendations has no rows — no book has been published, so there is no sizing to describe.",
      };
    }
    const runDate = str(book.run_date);
    const method = str(book.sizing_method);
    const reason = str(book.sizing_reason);
    const result = (book.optimizer_result ?? null) as Record<string, unknown> | null;
    const facts: Fact[] = [];
    const notes: Record<string, string | string[]> = {};

    // The method is a STRING fact, not a number, because it is the load-bearing claim here
    // and a guardrail that only checks numerals would let a wrong one through unnoticed.
    if (method) {
      facts.push(f("sizing.method", "Sizing method", method, "research_recommendations.sizing_method", "text", runDate));
    }
    if (reason) notes.why_not_optimizer = reason;

    const feasible = result?.feasible === true;
    if (result) {
      notes.optimizer_status = str(result.status) ?? "unknown";
      if (feasible) {
        for (const [key, label, unit] of [
          ["gross", "Gross deployed", "pct"],
          ["net", "Net exposure", "pct"],
          ["cash", "Held in cash", "pct"],
          ["volatility", "Ex-ante volatility of the sized book (annualised)", "pct"],
          ["expected_return", "Expected return of the sized book (annualised)", "pct"],
          ["turnover", "Turnover versus the conviction book", "pct"],
        ] as const) {
          const v = num(result[key]);
          if (v !== null) {
            facts.push(f(`sizing.${key}`, label, v, `research_recommendations.optimizer_result.${key}`, unit, runDate));
          }
        }
        const ic = num((result.ic as Record<string, unknown> | undefined)?.value);
        if (ic !== null) {
          facts.push(f("sizing.ic", "EdgeScore IC used to build expected returns (after 50% shrinkage)", ic, "research_recommendations.optimizer_result.ic.value", "x", runDate));
        }
        const binding = Array.isArray(result.binding_constraints) ? (result.binding_constraints as string[]) : [];
        if (binding.length) notes.binding_constraints = binding;
        const zeroed = Array.isArray(result.zeroed) ? (result.zeroed as string[]) : [];
        if (zeroed.length) notes.priced_out = zeroed;
      }
    }

    const cost = num((book.rebalance_cost as Record<string, unknown> | null)?.total_cost);
    if (cost !== null) {
      facts.push(f("sizing.rebalance_cost", "Estimated cost of moving from the conviction book to the published one", cost, "research_recommendations.rebalance_cost.total_cost", "usd", runDate));
    }

    // ── Crowding: COVERAGE FIRST, always ─────────────────────────────────────────
    // A verdict without its denominator is the failure ADR-0097 exists to prevent, and it
    // is worse through this surface than on the page: a model told "no position is crowded"
    // with no coverage figure will state the book was checked for crowding when four fifths
    // of it cannot be.
    const crowding = (result?.crowding ?? null) as Record<string, unknown> | null;
    if (crowding) {
      const coverage = num(crowding.coverage_share);
      if (coverage !== null) {
        facts.push(f("sizing.crowding_coverage", "Share of book gross external positioning can observe at all", coverage, "research_recommendations.optimizer_result.crowding.coverage_share", "pct", runDate));
      }
      const crowded = num(crowding.crowded_share);
      if (crowded !== null) {
        facts.push(f("sizing.crowded_share", "Share of book gross sitting with a crowded speculator consensus", crowded, "research_recommendations.optimizer_result.crowding.crowded_share", "pct", runDate));
      }
      const tightened = Array.isArray(crowding.tightened) ? (crowding.tightened as Record<string, unknown>[]) : [];
      facts.push(f("sizing.crowding_tightened_count", "Positions whose single-name cap was tightened for crowding", tightened.length, "research_recommendations.optimizer_result.crowding.tightened[]", "count", runDate));
      if (tightened.length) {
        notes.crowding_tightened = tightened.map(
          (t) => `${str(t.asset)} capped at ${num(t.cap) !== null ? `${(num(t.cap)! * 100).toFixed(1)}%` : "?"} (specs crowded ${str(t.crowded_side)} at ${num(t.cot_index)?.toFixed(0) ?? "?"}; book side in the contract: ${str(t.effective_side)})`,
        );
      } else {
        const why = str(crowding.reason);
        // Why nothing was tightened is the whole finding when nothing was: "we did not
        // look", "nothing maps", and "checked and uncrowded" are three different facts.
        if (why) notes.crowding_not_applied = why;
      }
    }

    const heuristic = (book.heuristic_weights ?? null) as Record<string, number> | null;
    if (heuristic && Object.keys(heuristic).length) {
      notes.conviction_book = Object.entries(heuristic)
        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
        .map(([asset, w]) => `${asset} ${(w * 100).toFixed(2)}%`);
    }

    return {
      tool: "sizing_provenance",
      args,
      facts,
      notes: Object.keys(notes).length ? notes : undefined,
      absence: !method
        ? "This book predates the column that records the sizing method (migration 047), so which model set these weights cannot be read off the row. Do NOT infer it was conviction-sized — say it was not recorded."
        : method === "conviction"
          ? `The optimizer did not size this book${reason ? `: ${reason}` : ", and no reason was recorded"}. Weights are proportional to conviction (|EdgeScore| / volatility), clamped to the published limits.`
          : undefined,
    };
  },
};

/**
 * The research, without this book's mandate on it.
 *
 * Every other tool here returns figures denominated in Andromeda's own mandate —
 * $100M, 20/30/35 caps, gross ≤ 100%. Those constraints belong to one hypothetical
 * fund, so a caller running their own capital base could not use any of it without
 * reverse-engineering back to the research underneath. This is that research: names,
 * sides, EdgeScore, and `conviction = |EdgeScore| / vol`.
 *
 * `conviction` is the field that makes this useful. It is a RATIO, so it is
 * identical at $100M and at $5bn — mandate-free by construction, and the input any
 * sizer wants. It was previously reachable only as a column inside a sizing
 * derivation, denominated in weights that were not the caller's.
 *
 * Reads `book_signal`, which by construction has no weight, notional or capital
 * column (migration 055 / ADR-0148).
 */
const signalTool: ToolSpec = {
  name: "signal",
  description:
    "The research WITHOUT this book's mandate applied: for each name the agent chose, its side, EdgeScore, conviction (|EdgeScore| / vol) and the thesis that argued it — but no weights, notionals or capital base. Call this when you want to size these ideas under a DIFFERENT mandate than Andromeda's $100M / 20-30-35, or when you want the research view rather than the portfolio view. conviction is a ratio, so it is the same at any capital base.",
  args: {},
  async run(args, { db }) {
    // Latest run only. An older vintage would return names that were never in
    // today's book, with no visible marker that the dates differ.
    const { rows, error } = await db.select(
      "book_signal",
      "run_date, asset, direction, theme, edge_score, conviction, vol, thesis, risk, counter_thesis, time_horizon",
      { order: { column: "run_date", ascending: false }, limit: 60 },
    );
    if (!rows.length) {
      return {
        tool: "signal",
        args,
        facts: [],
        absence: error
          ? `book_signal could not be read (${error}). The mandate-free signal is unavailable, so nothing here can be sourced.`
          : "book_signal has no rows. The signal is written by the L5 agent from migration 055 onward; runs published before it have only the sized book.",
      };
    }

    const runDate = str(rows[0].run_date);
    const latest = rows.filter((r) => str(r.run_date) === runDate);

    const facts: Fact[] = [
      f("signal.run_date", "Signal run date", runDate, "book_signal.run_date", "date", runDate),
      f("signal.count", "Names with a signal", latest.length, "book_signal", "count", runDate),
    ];
    for (const row of latest) {
      const asset = str(row.asset);
      if (!asset) continue;
      const edge = num(row.edge_score);
      if (edge !== null) {
        facts.push(f(`signal.${asset}.edge_score`, `${asset} EdgeScore`, edge, "book_signal.edge_score", "x", runDate));
      }
      const conv = num(row.conviction);
      if (conv !== null) {
        facts.push(f(`signal.${asset}.conviction`, `${asset} conviction`, conv, "book_signal.conviction", "x", runDate));
      }
      const vol = num(row.vol);
      if (vol !== null) {
        facts.push(f(`signal.${asset}.vol`, `${asset} daily vol`, vol, "book_signal.vol", "pct", runDate));
      }
    }

    return {
      tool: "signal",
      args,
      facts,
      notes: {
        // Sides and prose are words, and the guardrail adjudicates only numbers.
        names: latest.map(
          (r) =>
            `${str(r.asset)} ${String(str(r.direction) ?? "").toUpperCase()}` +
            `${str(r.theme) ? ` · theme ${str(r.theme)}` : ""}`,
        ),
        mandate_free:
          "These carry no weight, notional or capital base. Size them under your own mandate; " +
          "conviction = |EdgeScore| / vol is a ratio and does not change with capital.",
      },
      // Stated rather than left to inference: a caller seeing no weights might
      // otherwise conclude the book has none.
      absence:
        "This tool deliberately returns no weights or notionals. For Andromeda's own sizing of the same names, call book_summary or sizing_provenance.",
    };
  },
};

/**
 * Size today's signal under the CALLER's mandate.
 *
 * The counterpart to `signal`: that tool hands over the research with no mandate on
 * it, this one turns it into weights under whichever mandate the caller supplies.
 * Together they are what makes Andromeda usable by a portfolio app that runs its own
 * capital base — previously impossible, because every tool emitted a book already
 * denominated in Andromeda's $100M and 20/30/35.
 *
 * It PROXIES to `/api/compute/size` rather than sizing here. That is the whole
 * design: `optimizer.py` is cvxpy, and a TypeScript reimplementation is the failure
 * ADR-0107 records — the source it was read across from clipped every weight at zero
 * and deleted every short on a long-short book. One sizer, three callers.
 */
const sizeBook: ToolSpec = {
  name: "size_book",
  description:
    "Size today's signal under YOUR mandate rather than Andromeda's. Optionally pass any of total_capital, max_single_name, max_sector, max_geo, max_gross as a JSON object; anything you omit falls back to Andromeda's own value ($100M, 20%, 30%, 35%, 100%). Returns signed weights and notionals from the same constrained optimizer that produced the published book. Call this when the question is 'what would this look like at my size' or 'under my limits'. Read-only: nothing is stored and no published book changes.",
  args: {
    mandate:
      'Optional JSON object of mandate overrides, e.g. {"total_capital": 500000000, "max_single_name": 0.10}. Omit for Andromeda\'s own mandate.',
  },
  async run(args, { db }) {
    const { rows, error } = await db.select(
      "book_signal",
      "run_date, asset, direction, conviction, vol",
      { order: { column: "run_date", ascending: false }, limit: 60 },
    );
    if (!rows.length) {
      return {
        tool: "size_book",
        args,
        facts: [],
        absence: error
          ? `book_signal could not be read (${error}), so there is no signal to size.`
          : "book_signal has no rows, so there is no signal to size. Runs published before migration 055 have only the sized book.",
      };
    }

    const runDate = str(rows[0].run_date);
    const signals = rows
      .filter((r) => str(r.run_date) === runDate)
      .map((r) => ({
        asset: str(r.asset),
        direction: str(r.direction),
        conviction: num(r.conviction),
        vol: num(r.vol),
      }));

    // Same-origin: in production the Python function is a sibling route of this one.
    const base =
      process.env.COMPUTE_BASE_URL ??
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3010");

    const unreachable = (why: string): ToolResult => ({
      tool: "size_book",
      args,
      facts: [],
      absence:
        `The sizing service is unavailable (${why}). This does not affect the published ` +
        `book — call book_summary for Andromeda's own weights, or signal for the ` +
        `mandate-free research to size yourself.`,
    });

    let payload: Record<string, unknown>;
    try {
      const res = await fetch(`${base}/api/compute/size`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ signals, mandate: args.mandate ?? {} }),
      });

      // A non-JSON body means the Python function is not serving this origin — in
      // dev, Next.js answers with its HTML 404. Diagnosing that as "not deployed"
      // is actionable; surfacing the JSON parser's complaint about "<!DOCTYPE" is
      // not, and it reads like a bug in the sizer rather than a missing deployment.
      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        return unreachable(
          `no Python function is serving ${base}/api/compute/size — it returned ${res.status} as ${contentType || "an unknown type"}`,
        );
      }

      payload = (await res.json()) as Record<string, unknown>;
      if (!res.ok || payload.ok === false) {
        return {
          tool: "size_book",
          args,
          facts: [],
          // The solver's refusal reaches the caller verbatim. A rejected mandate is
          // information they can act on; a generic failure is not.
          absence: `The sizer refused this request: ${String(payload.error ?? res.status)}`,
        };
      }
    } catch (e) {
      return unreachable(e instanceof Error ? e.message : "unknown error");
    }

    const weights = (payload.signed_weights ?? {}) as Record<string, number>;
    const notional = (payload.notional ?? {}) as Record<string, number>;
    const mandate = (payload.mandate ?? {}) as { values?: Record<string, unknown> };
    const capital = num(mandate.values?.total_capital);

    const facts: Fact[] = [
      f("size_book.run_date", "Signal run date", runDate, "book_signal.run_date", "date", runDate),
      f("size_book.gross", "Gross exposure", num(payload.gross), "api/compute/size", "pct", runDate),
      f("size_book.cash", "Cash", num(payload.cash), "api/compute/size", "pct", runDate),
    ];
    if (capital !== null) {
      facts.push(f("size_book.total_capital", "Capital base used", capital, "caller-supplied mandate", "usd", runDate));
    }
    for (const [asset, w] of Object.entries(weights)) {
      const n = num(w);
      if (n !== null) {
        facts.push(f(`size_book.${asset}.weight`, `${asset} weight`, n, "api/compute/size", "pct", runDate));
      }
      const dollars = num(notional[asset]);
      if (dollars !== null) {
        facts.push(f(`size_book.${asset}.notional`, `${asset} notional`, dollars, "api/compute/size", "usd", runDate));
      }
    }

    const noView = (payload.no_expected_return ?? null) as { assets?: string[] } | null;
    return {
      tool: "size_book",
      args,
      facts,
      notes: {
        basis:
          "These weights are NOT the published book. They are today's signal re-sized " +
          "under the supplied mandate by the same optimizer; nothing was stored.",
        ...(Array.isArray(payload.warnings) && payload.warnings.length
          ? { warnings: payload.warnings as string[] }
          : {}),
      },
      // A name held only for variance reduction is a materially different claim from
      // a name held for return, and the caller cannot see the difference in a weight.
      absence: noView?.assets?.length
        ? `${noView.assets.join(", ")} carry no EdgeScore, so they entered at mu = 0 — held for variance reduction only, never for expected return.`
        : undefined,
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
  structuredFactsTool,
  computableMacroTool,
  pipelineStatus,
  screeningFunnel,
  bookTurnover,
  sizingProvenance,
  signalTool,
  sizeBook,
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
