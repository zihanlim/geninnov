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
- \`/mandate\` — what this book is allowed to be: capital base, single-name/sector/geo
  caps, correlation-complex and crowded-name limits, each with its source, and the limit
  board that measures the published book against them.
- \`/risk\` — stress scenarios (six calibrated shocks, worst first), per-position risk
  attribution, correlation matrix, attention crowding, cap headroom, factor tilt.
- \`/execution\` — OUT OF SCOPE, deliberately. The book is a recommendation, not a held
  position, so no fill, borrow cost or slippage exists anywhere in this system. The page
  names what the phase would need rather than reporting figures that do not exist.
- \`/attribution\` — realised drawdown and the return path, against the ex-ante figures.
  The only backward-looking surface.
- \`/scenario\` — retired; redirects to \`/risk\`, which is phase 3.
- \`/method\` — the process map: the six phases of the investment process (mandate,
  alpha sourcing, risk/scenario, construction, execution, attribution) and the
  surface performing each. Execution is out of scope and says why.
- \`/method/build\` — how each number is built: HypeScore, TradeScore, EdgeScore, the FF5+UMD
  factor model, conviction sizing, worked examples.
- \`/method/evidence\` — whether it ran and who checked it: per-stage pipeline health,
  data-source provenance, the LLM citation-guardrail audit, and the forward track record
  of published picks.
- \`/ask\` — ask a question about the published book in natural language. Every numeral in
  the answer is adjudicated cited / quoted / unverified.
- \`/\` — themes overview.

\`/trades\`, \`/portfolio\` and \`/research\` are retired and redirect to \`/book\`; \`/scenario\` redirects to \`/risk\`.

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
- ADR-0147 — the mandate is a parameter of sizing, not an ambient constant.
- ADR-0148 — the signal is published separately from the book it was sized into.
- ADR-0149 — request-time sizing calls the same optimizer the nightly run calls.
- ADR-0150 — a recommendation has no P&L; the held book pays for its own trading.

## The method, end to end

The daily theme-and-hype process is written up in full at
docs/theme-hype-methodology.md in the repository: data gathering, processing, the
quantification framework, and how one output serves both idea generation and risk
monitoring. It is written against the live system with real figures and is explicit
about what is not yet measurable.

The short version:

- Two corpora, deliberately. Per-theme keyword queries measure the nine named themes.
  A SEPARATE market-wide corpus, which names no theme, feeds a frequency tracker that
  can find narratives nobody asked about. The first is circular on its own; the second
  is what stops it being a mirror.
- HypeScore = 0.30 volume + 0.20 sentiment + 0.30 cross-asset correlation + 0.20
  momentum, weights from scoring_config. Every component is an ABSOLUTE sub-score on
  its own documented scale, never min-maxed across themes: a cross-sectional score is
  a statement about the day's peer group, not about the theme, and cannot be compared
  across time.
- A missing component is DROPPED and the rest renormalised, never scored zero. With a
  0.30 correlation weight, a zero would silently deduct 30 points and be
  indistinguishable from a measured absence.
- Attention alone is not a theme. The brief defines a theme as a narrative driving
  cross-asset moves, so correlation is a term in the score and a separate gate refuses
  to call a link real below 20 sessions.
- Idea generation and risk monitoring read the same number differently: ranked
  HypeScore gates which themes are in scope; percentile-within-own-history plus book
  position flags a crowded long.

## Sizing this yourself

If you run your own capital base and your own limits, do NOT use the published
weights: they are denominated in the mandate above and are not yours.

- signal — returns the research with no mandate on it: names, sides, EdgeScore and
  conviction = |EdgeScore| / vol. Conviction is a ratio, so it is the same number at
  $100M and at $5bn, and it is what any sizer takes as input.
- size_book — sizes that signal under a mandate YOU supply. Pass any of
  total_capital, max_single_name, max_sector, max_geo, max_gross; anything omitted
  falls back to Andromeda's own value. It runs the same constrained optimizer that
  produced the published book, stores nothing, and changes no published figure.

The $100M book is one instantiation of the signal under one mandate, not the answer.

## The mandate

The book is sized under constraints stated in full at /mandate. They are read
from the scoring_config table and mirrored in backend/services/mandate.py; a drift
test fails the build if the two disagree.

Enforced — entered into the optimizer as constraints, so a published book cannot
breach one:

- Capital base $100M. Whatever the limits refuse is held as CASH, not redeployed,
  so a book routinely deploys less than $100M (ADR-0037).
- Single name <= 20%, sector <= 30%, geography <= 35%, with no minimum group size.
- Gross (long + short) <= 100%. This is a ceiling approached from below, not a
  target, and NOT 200% — the sizer cannot produce leverage.
- A correlation complex (pairwise > 0.70) shares one name's 20% allowance.
- A crowded name gets half its single-name cap; every other name is unaffected.

Monitored — reported but constraining nothing. There is no net-exposure constraint
and no beta target anywhere in the sizer, so the book can and does cross these:
VaR 6%, CVaR 9%, drawdown 15%, net exposure 30%, |beta| 0.50, HHI 2000.

Book shape (at most 5 long and 5 short) is enforced during selection, not by the
sizer. The lens is a per-run argument (ADR-0015), not a standing limit.

The mandate is operator-set and takes effect on the next scheduled run. No control
on this site can change it, and none pretends to.

## Limits

- One run per weekday, after the US close. Nothing here is intraday or real-time.
- Positions are model output, not investment advice, and the site says so.
- Scenario P&L figures are model estimates from historical betas, not forecasts.
- The forward track record resolves at 21 trading days, so early runs read as pending
  rather than as a hit rate.
- The realised return curve on /attribution is GROSS OF TRANSACTION COSTS. The book
  reconstitutes itself each run at 50-77% turnover, so that series is what a book
  would have earned had every rebalance been instant and free. pick_outcomes is the
  forward record that does not carry this assumption.
`;

export function GET() {
  return new Response(BODY(), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
