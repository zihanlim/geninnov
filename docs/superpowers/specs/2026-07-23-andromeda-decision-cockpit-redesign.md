# Andromeda — Decision-Cockpit UI/UX Redesign

- Status: in progress
- Date: 2026-07-23
- Supersedes the earlier `2026-07-23-andromeda-uiux-review-and-redesign.md` on the
  decision-surface axis. Grounded in a full service→surface coverage audit.

## Thesis

Andromeda's engine is institutional-grade (4-component EdgeScore, conviction ×
inverse-vol sizing, abstention, VaR/CVaR/scenarios/caps/correlation with
provenance) but the frontend **reports data instead of driving decisions**, and
**surfaces a staler, weaker version of the engine than what exists**. Reframe the
UI from dashboard to **decision cockpit**: one screen per PM question, every
number a decision input, every screen defensible to an investment committee.

The north star, mapped to `task.md`:
- **Themes (`/`)** — what's moving + how crowded (Q2)
- **Book (`/book`)** — what we hold, **why** (full EdgeScore), how much (real sizing) (Q1)
- **Risk (`/risk`)** — what breaks it, against limits, which trade to cut
- **Method (`/method`)** — how it's derived

## The data contract (shipped — migration 025)

The decision block is now persisted so the frontend can render it:
`portfolio_positions` and `trade_candidates` carry
`edge_score, trend_signal, regime_bias, carry_signal, value_signal, conviction, vol`;
`theme_signals_history` carries the same plus `vol`. Frontend read-model in
`frontend/lib/themeSignals.ts`: `ThemeEdge` (4 components + conviction + vol),
`edgeContributions()` (weighted 4-bar decomposition), `edgeRationale()`
(one-line IC rationale), `abstainedThemes()` (the abstention roster). Weights come
from `scoring_config` (`edge_trend_weight` 0.35, `edge_regime_weight` 0.25,
`edge_carry_weight` 0.20, `edge_value_weight` 0.20, `edge_abstain_threshold` 0.15).

## Coverage gaps this closes

1. **EdgeScore shown as 2 of 4 components** (Trend+Regime); Carry+Value invisible;
   `TradeDerivationDrawer` hardcodes the old 0.6/0.4 weights.
2. **Sizing shown as HypeScore/100**, not the conviction × inverse-vol model.
3. **Abstention never surfaced** — the engine's decision *not* to trade is invisible.
4. **No theme ↔ trade round-trip** — attention→idea→position can't be traversed.
5. **Risk is displayed, not actionable** — no limits, no per-position attribution,
   no what-if, no prior-run deltas.
6. **Two disconnected "crowding" notions** — attention-percentile vs position-corr;
   neither answers "is my book leaning into crowded themes?"
7. **Legacy `/trades /portfolio /research` duplicate/contradict** the primary triad
   (and `/trades` bypasses the citation guardrail).
8. **Provenance/mock warnings only on `/method`**, not on `/` where scores are read.

## Prioritized plan + acceptance criteria

### P0 — Truth & the "why" (`/book`, `/method`, drawer)
- **EdgeScore 4-bar decomposition** on every `/book` position: a diverging bar per
  component (Trend/Regime/Carry/Value) showing weighted contribution, summing to
  the EdgeScore, with the resolved side. *Accept:* a PM sees all 4, and the bars
  reconcile to `edge_score`.
- **Real sizing chain**: `conviction = |EdgeScore|/vol → normalized weight → cap
  clamp → final weight → signed weight → notional`. *Accept:* no HypeScore/100
  math; a banner only if `conviction` is null.
- **One-line rationale + conviction chip** always visible per row (from
  `edgeRationale()`). *Accept:* all 10 picks defensible in one scan.
- **Abstention roster** panel (from `abstainedThemes()`): theme, |EdgeScore|, the
  4 components, "why abstained" (e.g. carry vs value conflict). *Accept:* a PM sees
  what was declined and why.
- **Fix `TradeDerivationDrawer`** to 4 components + live weights; **`/method` §4**
  to the 4-component formula + a reconciling worked example.

### P1 — Sizing defensibility & risk-as-action (`/risk`, links)
- **Per-position risk attribution**: marginal contribution to book beta / VaR /
  gross+net, and top correlated sibling, on each `/book` and `/risk` row.
- **Risk-limit board**: limits (VaR/CVaR/drawdown/net/gross/beta/HHI/caps) with
  headroom + ok/near/breached status, sorted breached-first.
- **Theme ↔ trade linkage**: `/book?theme=<id>` from theme cards; position
  `theme_name` links back to the theme drawer on `/`.
- **Unify crowding on `/risk`**: rank themes by attention-percentile-in-own-history,
  flag the ones the book is positioned in ("long AI Infra at 95th-pct → crowded").

### P2 — Depth & interactivity + IA cleanup
- What-if scenario sliders (MKT/rates/USD/credit/VIX) recomputing book P&L live
  from `signed_weight × beta`.
- Prior-run risk deltas (reuse `ScoreDeltaBadge`); full correlation matrix; attention
  -concentration HHI on `/`; raw-headline drill-down (`theme_news`); provenance/mock
  dots on `/`.
- **Redirect legacy `/trades /portfolio /research`** into the `/book`+`/risk`+`/method`
  triad (they duplicate and can bypass the guardrail).

## Conventions

Tailwind + CSS tokens in `frontend/app/globals.css` (`--long`, `--short`, `--accent`,
`--warning`, `--text-*`, `--bg-*`, `--border`). Supabase reads via
`@/lib/supabase`; shared read-models in `frontend/lib/*`. Render "—"/explicit
unavailable states, never a misleading 0. Everything typechecks (`npm run build`).
