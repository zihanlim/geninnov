"""
L5 — what the turnover costs.

Read from `im-Jarvis/backend/app/services/cost_model.py` (its ADR-0048) and
reimplemented in float.

    cost_per_leg = (commission_bps + half_spread_bps) / 10_000 * |trade_value|

**Why this matters here specifically.** ADR-0045 and ADR-0050 built turnover
measurement — separating agent churn from market churn — and the repo has been able to
say *how much* the book turns over without ever saying what that costs. On a $100M
book at 15bps, a 40% one-way turnover is $60,000. That is not a rounding error against
a signal whose measured IC is +0.03, and it is the number that decides whether a
rebalance is worth doing at all.

It also closes the loop with the optimizer. `optimizer.OptimizerConstraints.max_turnover`
caps `sum|w - w0|`; this prices what the cap is buying, so the constraint can be set
against a number rather than a feeling.

**The model is deliberately linear, and that is its main limitation.** There is no
market-impact term — no square-root law, no participation-rate model — so it will
understate the cost of a large trade in a thin name. For an ETF book at $100M that is
usually acceptable; for the single names ADR-0043 admitted it is less so. The
`MIN_ADV_MILLIONS` liquidity screen in `book_metrics` is the guard that keeps the
approximation honest, not this module.

Defaults are 10bps commission + 5bps half-spread, which is conservative for liquid US
ETFs. They are parameters, not constants, because the right number differs by venue
and by name — and a cost model whose assumptions cannot be varied is a cost assertion.
"""
from __future__ import annotations

from dataclasses import dataclass, field

BPS_DIVISOR = 10_000.0

# Conservative liquid-ETF defaults: explicit commission plus half the quoted spread,
# which is what crossing from mid actually costs.
DEFAULT_COMMISSION_BPS = 10.0
DEFAULT_HALF_SPREAD_BPS = 5.0


@dataclass(frozen=True)
class TradeCost:
    asset: str
    trade_value: float          # absolute, in currency
    weight_delta: float         # signed, for the reader to see direction of the trade
    cost: float

    def to_dict(self) -> dict:
        return {
            "asset": self.asset,
            "trade_value": self.trade_value,
            "weight_delta": self.weight_delta,
            "cost": self.cost,
        }


@dataclass(frozen=True)
class CostEstimate:
    total_cost: float
    total_cost_pct: float       # of capital
    turnover: float             # one-way, sum|delta w|
    commission_bps: float
    half_spread_bps: float
    n_trades: int
    per_trade: list[TradeCost] = field(default_factory=list)

    def to_dict(self, include_per_trade: bool = True) -> dict:
        out = {
            "total_cost": self.total_cost,
            "total_cost_pct": self.total_cost_pct,
            "turnover": self.turnover,
            "commission_bps": self.commission_bps,
            "half_spread_bps": self.half_spread_bps,
            "n_trades": self.n_trades,
            "model": "linear: (commission + half spread) x |trade value|",
            "limitation": "no market-impact term; understates a large trade in a thin name",
        }
        if include_per_trade:
            out["per_trade"] = [t.to_dict() for t in self.per_trade]
        return out


def estimate_trade_cost(
    trade_value: float,
    commission_bps: float = DEFAULT_COMMISSION_BPS,
    half_spread_bps: float = DEFAULT_HALF_SPREAD_BPS,
) -> float:
    """One-way cost of a single leg. `trade_value` is used as an absolute."""
    rate = (commission_bps + half_spread_bps) / BPS_DIVISOR
    return rate * abs(float(trade_value))


def estimate_portfolio_costs(
    weight_delta: dict[str, float],
    total_capital: float,
    commission_bps: float = DEFAULT_COMMISSION_BPS,
    half_spread_bps: float = DEFAULT_HALF_SPREAD_BPS,
) -> CostEstimate:
    """Cost of moving from one weight vector to another.

    `weight_delta` is the optimizer's own `weight_delta` — signed differences in share
    of capital. Zero deltas are skipped rather than listed at zero cost: a position
    that did not move is not a trade, and putting it in the table invites a reader to
    count it as one.

    Deltas are **signed weights**, so a long trimmed from +10% to +6% and a short
    extended from -6% to -10% are both 4% of turnover. Taking the difference of
    unsigned weights would have missed the direction change entirely — the same
    signed/unsigned trap ADR-0101 records.
    """
    per_trade: list[TradeCost] = []
    for asset, delta in sorted(weight_delta.items()):
        try:
            delta_value = float(delta)
        except (TypeError, ValueError):
            continue
        if delta_value == 0.0:
            continue
        trade_value = abs(delta_value) * float(total_capital)
        per_trade.append(
            TradeCost(
                asset=str(asset),
                trade_value=trade_value,
                weight_delta=delta_value,
                cost=estimate_trade_cost(trade_value, commission_bps, half_spread_bps),
            )
        )

    total_cost = sum(t.cost for t in per_trade)
    turnover = sum(abs(t.weight_delta) for t in per_trade)
    return CostEstimate(
        total_cost=total_cost,
        total_cost_pct=(total_cost / float(total_capital)) if total_capital else 0.0,
        turnover=turnover,
        commission_bps=float(commission_bps),
        half_spread_bps=float(half_spread_bps),
        n_trades=len(per_trade),
        per_trade=per_trade,
    )
