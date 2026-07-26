// frontend/app/llms.txt/route.ts
//
// A machine-readable index of this site, served at /llms.txt.
//
// The case for it is empirical: reviewing worldmonitor.app, its /docs/llms.txt let one
// fetch enumerate ~200 documented operations across 37 service groups, where crawling the
// HTML would have taken many. An agent pointed at Andromeda currently has to guess which
// pages exist and what a number on them means.
//
// GENERATED, not authored, for the part that can drift: the tool list comes from the same
// `TOOLS` registry `/ask` and the MCP endpoint use, so a tool added tomorrow appears here
// without anyone remembering to edit a text file. The prose around it is hand-written
// because it states the reading contract, and that is a decision rather than an inventory.

import { TOOLS } from "@/lib/chat/tools";

export const dynamic = "force-static";
export const revalidate = 3600;

const BODY = () =>
  `# Andromeda

> Systematic market-theme identification that publishes a $100M long-short book once per
> weekday, after the US close, with every numeric claim traceable to the row it came from.

## What this is

Andromeda ingests news and social data daily, scores themes by attention x sentiment x
market correlation x momentum (HypeScore), ranks trade candidates (EdgeScore), and has an
LLM agent synthesise the deterministic L0-L4 inputs into a sized book with a per-trade
thesis. The LLM is invoked at exactly one point in that pipeline; everything before it is
a pure function, and every figure it writes is checked against the inputs before it is
published.

## The reading contract (read this before quoting any number)

- **Every figure traces to a source.** Numbers on the site carry the \`table.column\` they
  were read from, or are labelled as a browser-side estimate. A number you cannot follow
  back is not one we published.
- **An absence is stated, never filled.** A missing value renders as an em dash plus the
  reason. It is never 0.00 and never a plausible substitute. "No data" and "zero" are
  different claims here.
- **Do not recompute.** Combining two published figures produces a third that traces to
  nothing. If you need a derived value, say that you derived it.
- **The cadence is daily, not live.** There is no intraday data. A figure is as of the
  most recent published run; the run date is on every page and in every tool result.
- **Direction is a glyph or a word, not a colour.** Long and short are marked with an
  arrow or the words LONG / SHORT, because the two inks are indistinguishable
  desaturated.

## Pages

- \`/book\` — the published book: one row per position with thesis, counter-thesis,
  catalysts, the full sizing chain, factor tilts, per-scenario stress, cap utilisation,
  and the screening funnel that rejected everything else.
- \`/risk\` — stress scenarios (six calibrated shocks, worst first), correlation matrix,
  cap headroom, factor tilt, Euler risk decomposition, realised drawdown.
- \`/method\` — how each number is built: HypeScore, TradeScore, EdgeScore, the FF5+UMD
  factor model, conviction sizing, worked examples.
- \`/method/evidence\` — whether it ran and who checked it: per-stage pipeline health,
  data-source provenance, the LLM citation-guardrail audit, and the forward track record
  of published picks.
- \`/ask\` — ask a question about the published book in natural language. Every numeral in
  the answer is adjudicated cited / quoted / unverified.
- \`/\` — themes overview.

\`/trades\`, \`/portfolio\` and \`/research\` are retired and redirect to \`/book\`.

## Programmatic access

### MCP (Model Context Protocol)

Endpoint: \`POST /api/mcp\` — Streamable HTTP transport, protocol \`2025-06-18\`
(\`2025-03-26\` also accepted). Stateless: no session id is issued. \`GET\` returns 405
because there is no server-initiated stream. Methods: \`initialize\`, \`ping\`,
\`tools/list\`, \`tools/call\`.

Read-only by construction. The tools cannot write, re-run, re-size, re-rank or re-publish
anything, and they read with the public anon key — the same rows the pages already serve.
No API key is required and there is no LLM cost, because you bring your own model.

Each result returns \`structuredContent.facts\`: an array of
\`{key, label, value, source, unit, runDate}\`. \`value: null\` means not computable — it
does not mean zero. When \`facts\` is empty and \`absence\` is set, the absence is the
answer.

### Tools (${TOOLS.length})

${TOOLS.map((t) => {
  const args = Object.entries(t.args);
  const sig = args.length === 0 ? "no arguments" : args.map(([k, v]) => `${k} — ${v}`).join("; ");
  return `- \`${t.name}\` — ${t.description}\n  args: ${sig}`;
}).join("\n")}

## Where the numbers live

- \`research_recommendations\` — the published book: picks, book_view, book_metrics,
  scenario_results, correlation_pairs, cap_utilisation, screening_funnel, lens,
  risk_decomposition.
- \`pick_outcomes\` — the forward track record: one row per published pick per resolution
  horizon, written \`pending\` at publication so the denominator precedes the outcome.
- \`portfolio_risk\`, \`portfolio_positions\`, \`portfolio_cumulative_return\` — realised
  risk and performance on the book of record.
- \`themes\`, \`theme_signals_history\`, \`theme_assets\`, \`theme_news\` — the L1 signal layer.
- \`macro_indicators\`, \`factor_exposures\`, \`regime_classifications\` — L0/L2/L3 inputs.
- \`pipeline_runs\` — per-stage execution audit for every run.
- \`backtest_results\` — signal validation (HypeScore IC, EdgeScore component IC,
  book replication, L5 eval battery).

All are read-only to the public anon role.

## Design decisions

Architecture decision records live in the repository under \`docs/adrs/\`. The ones that
most change how you should read a number:

- ADR-0010 — citation footnotes on every numeric claim.
- ADR-0012 — the citation guardrail as the primary defence against LLM-invented figures.
- ADR-0040 — the published book is the book of record; risk and returns are recomputed on it.
- ADR-0066 — a value that is not computable persists as null, never as zero.
- ADR-0085 — direction cannot be carried by hue alone.
- ADR-0087 — the request-time agent cannot do arithmetic; it may only quote fetched facts.
- ADR-0088 — a stress scenario that transmits through sector dependency, not market beta.
- ADR-0090 — a published pick must be falsifiable; the forward track record and its spec.

## Limits

- One run per weekday, after the US close. Nothing here is intraday or real-time.
- Positions are model output, not investment advice, and the site says so.
- Scenario P&L figures are model estimates from historical betas, not forecasts.
- The forward track record resolves at 21 trading days, so early runs read as pending
  rather than as a hit rate.
`;

export function GET() {
  return new Response(BODY(), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
