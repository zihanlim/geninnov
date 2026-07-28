"""The held book: what a portfolio running this research would actually own.

WHAT WAS WRONG
--------------
`portfolio.compute_daily_return` is:

    sum(weight * price_return for each position)

with no cost term, and `compute_cumulative_return` chains those unmodified. The
published book reconstitutes itself every run and has turned over 50-77% of its
names between consecutive runs. So the curve on `/risk` is what a book would have
earned **if every rebalance were instant and free** — which at that turnover is not
a rounding difference, it is the difference between a strategy and a P&L.

`rebalance_cost` already existed but priced the wrong delta. `tools.ts` describes it
as "the cost of moving from the conviction book to the published one" — the
optimizer's adjustment WITHIN one run, not yesterday's book to today's. Nothing
anywhere measured the cost of actually running this thing.

WHAT A HELD BOOK IS
-------------------
A recommendation has no P&L; a portfolio does. So there is a book that is HELD,
carried forward across runs, and each run moves it toward the day's recommendation
and pays for the move. Its return is net of that payment and its NAV compounds.

WHY IT CURRENTLY HOLDS THE TARGET EXACTLY
-----------------------------------------
`rebalance()` takes a `max_turnover`, and when it is None the held book becomes the
target — a full rebalance, tracking error zero. That is deliberate, and it is the
honest default rather than a placeholder:

A turnover budget is a real portfolio-construction decision that changes what the
book IS, and its value would have to come from somewhere. `OptimizerConstraints`
has carried a `max_turnover` field since ADR-0107 and **nothing has ever set it** —
there is no measured basis in this repo for any particular number. Picking one to
make the held book look more realistic would be fitting a parameter to an
aesthetic, which is exactly what ADR-0047 warns a fitted threshold does: it becomes
a statement about the day's numbers rather than about the rule.

So the defect that is real — a return series that pretends trading is free — is
fixed here, and the modelling choice that would need its own argument is left as a
parameter with no invented value. When someone can justify a budget, it goes in the
mandate and this function already accepts it.

See ADR-0150.
"""

from __future__ import annotations

from typing import Any

from .cost_model import estimate_portfolio_costs


def rebalance(
    target: dict[str, float],
    previous: dict[str, float] | None = None,
    max_turnover: float | None = None,
) -> dict[str, float]:
    """Move the held book toward `target`, optionally capped by a turnover budget.

    Weights are SIGNED shares of capital: a long trimmed from +10% to +6% and a
    short extended from -6% to -10% are both 4% of turnover. Differencing unsigned
    weights would miss a direction change entirely — the trap ADR-0101 records.

    With `max_turnover=None` the book becomes the target exactly. With a budget, each
    name moves the same FRACTION of the way, so the book's shape is preserved rather
    than the first few names by dict order being fully traded and the rest left
    stranded.
    """
    previous = previous or {}
    if max_turnover is None:
        return {a: w for a, w in target.items() if w != 0.0}

    required = turnover(previous, target)
    if required <= max_turnover or required == 0.0:
        return {a: w for a, w in target.items() if w != 0.0}

    # Pro-rata along the path from previous to target. Every name gets the same
    # fraction, so a partial rebalance is a smaller version of the intended move
    # rather than an arbitrary subset of it.
    fraction = max_turnover / required
    out: dict[str, float] = {}
    for asset in set(previous) | set(target):
        start = previous.get(asset, 0.0)
        end = target.get(asset, 0.0)
        moved = start + (end - start) * fraction
        if moved != 0.0:
            out[asset] = moved
    return out


def weight_delta(
    previous: dict[str, float] | None,
    current: dict[str, float] | None,
) -> dict[str, float]:
    """Signed weight change per name, including entries and exits.

    A name present in only one of the two books is a full entry or a full exit, and
    both are trades. Iterating one side's keys alone would price an entry and miss
    every exit — a book that sold everything would report no cost.
    """
    previous = previous or {}
    current = current or {}
    out: dict[str, float] = {}
    for asset in set(previous) | set(current):
        delta = current.get(asset, 0.0) - previous.get(asset, 0.0)
        if delta != 0.0:
            out[asset] = delta
    return out


def turnover(
    previous: dict[str, float] | None,
    current: dict[str, float] | None,
) -> float:
    """One-way turnover as a share of capital: the sum of absolute weight changes."""
    return sum(abs(d) for d in weight_delta(previous, current).values())


def daily_return(
    held: dict[str, float],
    price_returns: dict[str, float],
    cost_pct: float = 0.0,
) -> float | None:
    """Return on the book HELD THROUGH the period, net of the cost of getting there.

    `held` must be the book at the START of the period. Using the end-of-period book
    would credit it with a return it was not positioned for — the look-ahead that
    makes a rebalanced strategy appear to time its own trades.

    Returns None when a held name has no price return, rather than treating the gap
    as a 0% move. A missing price is not a flat day (ADR-0066), and silently
    substituting one understates the book's realised volatility.
    """
    if not held:
        return None
    total = 0.0
    for asset, weight in held.items():
        if weight == 0.0:
            continue
        r = price_returns.get(asset)
        if r is None:
            return None
        total += weight * float(r)
    return total - float(cost_pct)


def step(
    previous_held: dict[str, float] | None,
    target: dict[str, float],
    price_returns: dict[str, float],
    total_capital: float,
    previous_nav: float | None = None,
    max_turnover: float | None = None,
) -> dict[str, Any]:
    """One day of the held book: earn on what was held, then pay to rebalance.

    ORDER MATTERS AND IS THE POINT. The return is earned on `previous_held` — the
    book that was actually owned through the move — and the cost is charged for
    moving to today's book. Computing the return on the NEW book would hand it a day
    of performance from positions it did not hold.
    """
    previous_held = previous_held or {}
    new_held = rebalance(target, previous_held, max_turnover)

    delta = weight_delta(previous_held, new_held)
    costs = estimate_portfolio_costs(delta, total_capital)
    cost_pct = float(costs.total_cost_pct)

    gross = daily_return(previous_held, price_returns, cost_pct=0.0)
    net = None if gross is None else gross - cost_pct

    nav = previous_nav if previous_nav is not None else float(total_capital)
    new_nav = nav if net is None else nav * (1.0 + net)

    return {
        "held": new_held,
        "previous_held": previous_held,
        "turnover": turnover(previous_held, new_held),
        # Both are reported. A reader comparing this to the old series needs to see
        # exactly what the cost term removed, and a single net figure hides it.
        "gross_return": gross,
        "cost_pct": cost_pct,
        "cost_usd": float(costs.total_cost),
        "net_return": net,
        "nav": new_nav,
        # Zero while the book fully rebalances, and reported anyway: a field that
        # appears only when non-zero is a field nobody knows to look for.
        "tracking_error": _tracking_error(new_held, target),
        "return_is_net_of_costs": True,
    }


def _tracking_error(held: dict[str, float], target: dict[str, float]) -> float:
    """How far the held book sits from the recommendation, in weight terms."""
    return sum(abs(d) for d in weight_delta(target, held).values())
