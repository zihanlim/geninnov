"""
L5 — constraint-aware portfolio optimizer for a LONG-SHORT book.

Read from `im-Jarvis/backend/app/services/optimizer_service.py` and reimplemented,
the same way `risk_decomposition` was. It is **not** a port in the copy sense, and the
differences are not stylistic — each one is a defect if omitted:

1. **Signs survive.** The source quantises with `clipped = [max(x, 0.0) for x in raw]`,
   unconditionally, *not* gated on its own `long_only` flag, and then renormalises the
   result to sum to exactly 1. On this repo's data that silently deletes every short
   and returns a long-only, fully-invested book that looks perfectly well-formed. That
   is ADR-0101's trap — code correct in its own repo, confidently wrong on a data shape
   it never saw — so the clip is gone and the renormalisation with it.

2. **Gross <= 1, not sum == 1.** ADR-0037: what the position limits refuse is held as
   cash, and the book is deliberately not renormalised back to 100%. `sum(w) == 1` is
   meaningless for a long-short book anyway — it constrains the *net*, so a book could
   satisfy it at 300% gross.

3. **The caps are solver constraints, not a post-hoc clamp.** `trade_ranker.
   allocate_portfolio` iterates a fixed point: clamp the over-weight names, redistribute,
   re-check, up to 50 times. That reaches *a* feasible point, not the best one. Here the
   single-name, sector and geography limits enter the problem itself, so the solution is
   the best book inside the limits rather than the first one that fits.

4. **Direction is pinned.** L5 chooses the names and the sides; the optimizer chooses
   only the magnitudes. `s_i * w_i >= 0` holds each position on the side L5 put it.

`risk_parity` and `black_litterman` from the source are **not** here. Risk parity's
convex form uses a `log(w)` barrier, which requires `w > 0` and is therefore structurally
long-only — there is no honest long-short version of that formulation. Black-Litterman's
reverse optimisation needs market-capitalisation weights, and Andromeda has no source for
them. Shipping either as a stub that silently degrades is worse than not shipping it.

**The direction pin buys a linear problem.** Because `s_i` is fixed, the magnitude
`m_i = s_i * w_i` is a non-negative *affine* expression rather than `|w_i|`. Gross
exposure, the single-name cap and both group caps are then all linear in `w`, so
mean-variance stays a QP and the two scenario objectives stay LPs. No absolute values,
no integer variables, no non-convexity.

**Cash falls out of the objective.** `max mu'w - (gamma/2) w'Sigma w` under `gross <= 1`
has an interior optimum: the book deploys until the marginal return stops paying for the
marginal variance. A weak signal therefore produces a smaller book rather than the same
book held with less conviction — which is exactly ADR-0037's principle arrived at from
the other direction. `target_gross` pins the deployment instead, for callers that want
the shape without the sizing.

See ADR-0107.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import cvxpy as cp
import numpy as np
import pandas as pd

from .book_metrics import (
    GEO_MAP,
    MAX_GEO_WEIGHT,
    MAX_SECTOR_WEIGHT,
    MAX_SINGLE_NAME_WEIGHT,
    SECTOR_MAP,
)

# Match `risk_decomposition` — the same book must not be annualised two ways.
TRADING_DAYS = 252
MIN_OBS_FOR_COVARIANCE = 60

# Weights are stored as `REAL` and rendered as percentages. Below this a position is
# solver dust, not a trade: on $100M, 1e-6 is $100. Dust is zeroed rather than carried,
# so `zeroed` means "the optimizer declined this name" instead of "there is a $12
# position in the book".
WEIGHT_DUST = 1e-6

# 8dp, matching the source's weight scale. Enough that a rounded book's gross does not
# drift measurably from the solved one.
WEIGHT_PLACES = 8

OBJECTIVES = ("mean_variance", "min_cvar", "mad")


@dataclass(frozen=True)
class OptimizerConstraints:
    """The book's published limits, as solver constraints.

    Defaults are the live limits from `book_metrics` (20/30/35), so the optimizer and
    `cap_utilisation` cannot disagree about what the limits are.
    """

    # A float applies to every name. A dict tightens the names it lists and leaves every
    # other name on `default_single` — absence is neutrality, which is what lets a signal
    # observable on a fifth of the book size that fifth without touching the rest
    # (ADR-0110). It is never used to RAISE a cap: `_cap_vector` takes the min.
    max_single: float | dict[str, float] = MAX_SINGLE_NAME_WEIGHT
    default_single: float = MAX_SINGLE_NAME_WEIGHT
    max_sector: float = MAX_SECTOR_WEIGHT
    max_geo: float = MAX_GEO_WEIGHT
    max_gross: float = 1.0
    # None leaves deployment to the objective (the ADR-0037 reading). A float pins
    # `gross == target_gross`, which the scenario objectives require to be well-posed.
    target_gross: float | None = None
    max_turnover: float | None = None
    risk_aversion: float = 1.0
    cvar_beta: float = 0.95


@dataclass(frozen=True)
class OptimizerInputs:
    """Everything the solve needs, in one frozen object.

    `assets` fixes the ordering for `cov` and every vector derived from it. `directions`
    must cover every asset; a missing one is treated as long and recorded as a warning
    rather than silently flipped.
    """

    assets: list[str]
    directions: dict[str, str]
    mu: dict[str, float]
    cov: np.ndarray
    weights0: dict[str, float] | None = None       # signed, for turnover
    scenarios: np.ndarray | None = None            # T x n daily returns, `assets` order
    sector_map: dict[str, str] | None = None
    geo_map: dict[str, str] | None = None


@dataclass(frozen=True)
class OptimizationResult:
    objective: str
    status: str
    feasible: bool
    signed_weights: dict[str, float]
    weight_delta: dict[str, float]
    expected_return: float | None
    volatility: float | None
    gross: float | None
    net: float | None
    cash: float | None
    turnover: float | None
    binding_constraints: list[str] = field(default_factory=list)
    zeroed: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    reason: str | None = None

    def to_dict(self) -> dict:
        return {
            "objective": self.objective,
            "status": self.status,
            "feasible": self.feasible,
            "signed_weights": dict(self.signed_weights),
            "weight_delta": dict(self.weight_delta),
            "expected_return": self.expected_return,
            "volatility": self.volatility,
            "gross": self.gross,
            "net": self.net,
            "cash": self.cash,
            "turnover": self.turnover,
            "binding_constraints": list(self.binding_constraints),
            "zeroed": list(self.zeroed),
            "warnings": list(self.warnings),
            "reason": self.reason,
        }


def _cap_vector(assets: list[str], constraints: OptimizerConstraints) -> np.ndarray:
    """Per-name single-name limits, in `assets` order.

    A scalar `max_single` applies everywhere. A dict tightens only the names it lists; a name
    it omits keeps `default_single`, unchanged. The `min` is deliberate — a per-name entry may
    only ever tighten. A crowding signal that could *raise* a limit would let an external
    reading loosen this book's published risk policy, which is not a thing a COT print is
    allowed to do.
    """
    per_name = constraints.max_single
    if not isinstance(per_name, dict):
        return np.full(len(assets), float(per_name))
    base = float(constraints.default_single)
    return np.array(
        [min(base, float(per_name.get(asset, base))) for asset in assets],
        dtype=float,
    )


def _infeasible(objective: str, status: str, reason: str,
                warnings: list[str] | None = None) -> OptimizationResult:
    """An unsolvable problem returns a result carrying its reason, never raises.

    The caller falls back to `allocate_portfolio`, and the reason is persisted beside
    the book — an absence has to say which kind of absence it is (ADR-0098).
    """
    return OptimizationResult(
        objective=objective,
        status=status,
        feasible=False,
        signed_weights={},
        weight_delta={},
        expected_return=None,
        volatility=None,
        gross=None,
        net=None,
        cash=None,
        turnover=None,
        warnings=list(warnings or []),
        reason=reason,
    )


def covariance_from_returns(
    returns: pd.DataFrame,
    assets: list[str],
    trading_days: int = TRADING_DAYS,
    min_obs: int = MIN_OBS_FOR_COVARIANCE,
) -> tuple[np.ndarray | None, list[str], list[str]]:
    """Annualised covariance over the assets that have history. (cov, used, dropped).

    Inner-joins on common dates for the same reason `decompose_risk` does: a per-column
    dropna estimates each pair over a different window, and the resulting matrix need
    not be positive semi-definite — which surfaces as a negative variance and a NaN
    volatility rather than as an error.
    """
    if returns is None or returns.empty or not assets:
        return None, [], list(assets or [])

    used = [a for a in assets if a in returns.columns]
    dropped = [a for a in assets if a not in returns.columns]
    if len(used) < 2:
        return None, [], list(assets)

    aligned = returns[used].dropna(how="any")
    if len(aligned) < min_obs:
        return None, [], list(assets)

    cov = aligned[used].cov().to_numpy() * trading_days
    cov = (cov + cov.T) / 2.0          # symmetrise for the PSD assumption
    if not np.all(np.isfinite(cov)):
        return None, [], list(assets)
    return cov, used, dropped


def _round_weights(raw: np.ndarray, assets: list[str], signs: np.ndarray) -> dict[str, float]:
    """Solver output to stored weights. Signs preserved, no renormalisation.

    This is the function the source gets wrong. It rounds, zeroes dust, and clamps any
    sign the solver flipped by a numerical hair back onto the side it was pinned to —
    but it never rescales, because rescaling is what erased the caps in ADR-0037 and
    what would erase the cash here.
    """
    out: dict[str, float] = {}
    for i, asset in enumerate(assets):
        value = float(raw[i])
        if not math.isfinite(value):
            value = 0.0
        # The pin is `s_i * w_i >= 0`; a solver may land a hair the wrong side of it.
        if value * float(signs[i]) < 0:
            value = 0.0
        # FLOOR the magnitude toward zero rather than rounding it.
        #
        # A convex solver satisfies its constraints to its OWN tolerance, around 1e-8 —
        # ten times coarser than `book_metrics.CAP_EPSILON` (1e-9), which decides whether
        # a cap has been breached. Rounding half-up preserved the overshoot, so on the
        # 2026-07-27 run the US geography summed to 0.35000001 against its 0.35 cap and
        # `/risk` reported a violation of "0.00pp over its 35% cap" on a book that had not
        # breached anything. That is exactly what ADR-0068 forbids: a cap breach decided by
        # float error.
        #
        # Flooring guarantees a stored weight never exceeds the solved one in magnitude, so
        # every constraint the solve satisfied — including GROUP sums, which no per-name
        # clamp could protect — still holds in the stored book. The cost is up to 1e-8 of
        # deployment per position, which is $1 on $100M.
        scale = 10 ** WEIGHT_PLACES
        magnitude = math.floor(abs(value) * scale) / scale
        out[asset] = 0.0 if magnitude < WEIGHT_DUST else math.copysign(magnitude, value)
    return out


def optimize(
    inputs: OptimizerInputs,
    objective: str = "mean_variance",
    constraints: OptimizerConstraints | None = None,
) -> OptimizationResult:
    """Solve for signed target weights under the book's published limits."""
    c = constraints or OptimizerConstraints()
    assets = list(inputs.assets)
    n = len(assets)

    if objective not in OBJECTIVES:
        return _infeasible(objective, "unknown_objective",
                           f"unknown objective {objective!r}")
    if n == 0:
        return _infeasible(objective, "empty", "no candidate assets")

    warnings: list[str] = []

    # ── Direction pins ───────────────────────────────────────────────────────────
    signs = np.ones(n)
    for i, asset in enumerate(assets):
        direction = inputs.directions.get(asset)
        if direction == "short":
            signs[i] = -1.0
        elif direction != "long":
            warnings.append(f"{asset}: no direction supplied, pinned long")

    cov = np.asarray(inputs.cov, dtype=float)
    if cov.shape != (n, n):
        return _infeasible(objective, "bad_covariance",
                           f"covariance is {cov.shape}, expected ({n}, {n})")
    cov = (cov + cov.T) / 2.0

    mu = np.array([float(inputs.mu.get(a, 0.0)) for a in assets])
    w0 = np.array([float((inputs.weights0 or {}).get(a, 0.0)) for a in assets])

    w = cp.Variable(n)
    magnitude = cp.multiply(signs, w)      # >= 0 once pinned; linear, not cp.abs

    caps = _cap_vector(assets, c)
    cons: list = [magnitude >= 0, magnitude <= caps]

    if c.target_gross is not None:
        cons.append(cp.sum(magnitude) == c.target_gross)
    else:
        cons.append(cp.sum(magnitude) <= c.max_gross)

    # ── Group caps, binding on the group TOTAL (ADR-0037) ────────────────────────
    # A group cap that acts only on members whose OWN weight exceeds the GROUP cap
    # never fires: two credit names at 20% put the sector at 40% against a 30% limit
    # while neither member breaches 30%. Summing the group is the whole point.
    sector_map = inputs.sector_map or SECTOR_MAP
    geo_map = inputs.geo_map or GEO_MAP
    for group_of, cap, label in (
        (sector_map, c.max_sector, "sector"),
        (geo_map, c.max_geo, "geo"),
    ):
        if cap is None or cap <= 0:
            continue
        members: dict[str, list[int]] = {}
        for i, asset in enumerate(assets):
            key = group_of.get(asset)
            if key is None:
                warnings.append(f"{asset}: no {label} mapping, {label} cap not applied")
                continue
            members.setdefault(key, []).append(i)
        for _key, idx in members.items():
            cons.append(cp.sum(magnitude[idx]) <= cap)

    if c.max_turnover is not None:
        cons.append(cp.norm1(w - w0) <= float(c.max_turnover))

    # ── Objective ────────────────────────────────────────────────────────────────
    if objective == "mean_variance":
        gamma = float(c.risk_aversion)
        problem = cp.Problem(
            cp.Maximize(mu @ w - (gamma / 2.0) * cp.quad_form(w, cp.psd_wrap(cov))),
            cons,
        )
    else:
        # Scenario objectives. Both MINIMISE a risk measure, so without a deployment
        # floor the trivial optimum is the empty book. `target_gross` makes them
        # well-posed; default it to the gross budget when the caller left it open.
        scenarios = inputs.scenarios
        if scenarios is None or len(scenarios) < 2:
            return _infeasible(objective, "no_scenarios",
                               "no return scenarios for the candidate assets", warnings)
        matrix = np.asarray(scenarios, dtype=float)
        if matrix.ndim != 2 or matrix.shape[1] != n:
            return _infeasible(objective, "bad_scenarios",
                               f"scenario matrix is {matrix.shape}, expected (T, {n})",
                               warnings)
        if c.target_gross is None:
            # Both scenario objectives MINIMISE a risk measure, so with no deployment
            # floor the trivial optimum is the empty book. The floor cannot simply be
            # `max_gross`: the sector and geography caps routinely make full deployment
            # unreachable — ADR-0037 records live books at 60% and 30% for precisely
            # that reason — and pinning gross to 1.0 would report those as INFEASIBLE
            # when they are in fact the correct, limit-respecting answer.
            #
            # So ask the constraint set how much it will actually take. This is a cheap
            # LP over the constraints already assembled, and it makes the objective
            # "of the books that deploy as much as the limits allow, take the one with
            # the least tail risk" — which is the question, and is well-posed always.
            reachable = cp.Problem(cp.Maximize(cp.sum(magnitude)), list(cons))
            try:
                reachable.solve()
            except Exception as exc:                   # pragma: no cover - solver
                return _infeasible(objective, "solver_error",
                                   f"deployment probe failed: {exc}", warnings)
            if reachable.status not in ("optimal", "optimal_inaccurate") or reachable.value is None:
                return _infeasible(objective, str(reachable.status),
                                   "the constraint set admits no deployed book", warnings)
            achievable = float(reachable.value)
            if achievable <= WEIGHT_DUST:
                return _infeasible(objective, "no_capacity",
                                   "the limits admit no deployed book", warnings)
            if achievable < c.max_gross - 1e-6:
                warnings.append(
                    f"limits cap deployment at {achievable:.1%} of capital; the "
                    f"remainder is cash"
                )
            cons.append(cp.sum(magnitude) >= achievable - 1e-6)

        t_obs = matrix.shape[0]
        portfolio = matrix @ w

        if objective == "mad":
            # Konno-Yamazaki: minimise mean absolute deviation from the mean.
            mean_portfolio = cp.sum(portfolio) / t_obs
            expression = cp.sum(cp.abs(portfolio - mean_portfolio)) / t_obs
        else:
            # Rockafellar-Uryasev CVaR, loss = -portfolio return.
            beta = float(c.cvar_beta)
            alpha = cp.Variable()
            excess = cp.Variable(t_obs, nonneg=True)
            cons.append(excess >= -portfolio - alpha)
            expression = alpha + cp.sum(excess) / ((1.0 - beta) * t_obs)
        problem = cp.Problem(cp.Minimize(expression), cons)

    try:
        problem.solve()
    except cp.error.SolverError as exc:
        return _infeasible(objective, "solver_error", f"solver error: {exc}", warnings)
    except Exception as exc:                       # pragma: no cover - solver-specific
        return _infeasible(objective, "solver_error",
                           f"{exc.__class__.__name__}: {exc}", warnings)

    status = str(problem.status)
    if status not in ("optimal", "optimal_inaccurate") or w.value is None:
        return _infeasible(objective, status,
                           f"no feasible solution for the constraint set ({status})",
                           warnings)
    if status == "optimal_inaccurate":
        warnings.append("solver returned an inaccurate optimum")

    weights = _round_weights(np.asarray(w.value).ravel(), assets, signs)

    vector = np.array([weights[a] for a in assets])
    gross = float(np.abs(vector).sum())
    net = float(vector.sum())
    variance = float(vector @ cov @ vector)
    volatility = float(np.sqrt(variance)) if variance > 0 else 0.0
    expected_return = float(mu @ vector)
    delta = {a: weights[a] - float((inputs.weights0 or {}).get(a, 0.0)) for a in assets}
    turnover = float(sum(abs(d) for d in delta.values()))

    binding: list[str] = []
    for index, asset in enumerate(assets):
        if abs(abs(weights[asset]) - float(caps[index])) < 1e-4:
            # Name the cap when it is not the book-wide one, so a reader can see that this
            # position was limited by something specific to it rather than by the standing
            # 20% (ADR-0110). A tightened cap that reported itself as "the single-name cap"
            # would be the sizing input going in silently, which is the thing bar 1 forbids.
            tightened = float(caps[index]) < float(c.default_single) - 1e-12
            binding.append(
                f"{asset} at tightened single-name cap ({float(caps[index]):.1%})"
                if tightened else f"{asset} at single-name cap"
            )
    for group_of, cap, label in (
        (sector_map, c.max_sector, "sector"),
        (geo_map, c.max_geo, "geo"),
    ):
        totals: dict[str, float] = {}
        for asset in assets:
            key = group_of.get(asset)
            if key is not None:
                totals[key] = totals.get(key, 0.0) + abs(weights[asset])
        for key, total in totals.items():
            if abs(total - cap) < 1e-4:
                binding.append(f"{key} at {label} cap")
    budget = c.target_gross if c.target_gross is not None else c.max_gross
    if abs(gross - budget) < 1e-4:
        binding.append("gross at budget")
    if c.max_turnover is not None and abs(turnover - c.max_turnover) < 1e-4:
        binding.append("turnover at cap")

    # A name the optimizer declined. ADR-0058: an empty slot owes an explanation, so
    # this travels with the result rather than being inferred from a zero downstream.
    zeroed = sorted(a for a in assets if weights[a] == 0.0)

    return OptimizationResult(
        objective=objective,
        status=status,
        feasible=True,
        signed_weights=weights,
        weight_delta=delta,
        expected_return=expected_return,
        volatility=volatility,
        gross=gross,
        net=net,
        cash=max(0.0, 1.0 - gross),
        turnover=turnover,
        binding_constraints=binding,
        zeroed=zeroed,
        warnings=warnings,
    )


# ─────────────────────────────────────────────────────────────────────────────────
# Efficient frontier
# ─────────────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class FrontierPoint:
    risk_aversion: float | None
    expected_return: float
    volatility: float
    gross: float
    sharpe: float | None
    signed_weights: dict[str, float] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "risk_aversion": self.risk_aversion,
            "expected_return": self.expected_return,
            "volatility": self.volatility,
            "gross": self.gross,
            "sharpe": self.sharpe,
            "signed_weights": dict(self.signed_weights),
        }


@dataclass(frozen=True)
class EfficientFrontier:
    points: list[FrontierPoint]
    current: FrontierPoint | None = None
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "points": [p.to_dict() for p in self.points],
            "current": self.current.to_dict() if self.current else None,
            "warnings": list(self.warnings),
        }


# Geometric grid spanning aggressive to defensive. Geometric because the solution
# responds to the ORDER of magnitude of gamma, not its level — a linear grid spends
# most of its points describing the same portfolio.
GAMMA_GRID: tuple[float, ...] = (0.5, 1.0, 2.0, 5.0, 10.0, 25.0, 50.0, 100.0)


def portfolio_point(
    signed_weights: dict[str, float],
    assets: list[str],
    mu: dict[str, float],
    cov: np.ndarray,
    risk_aversion: float | None = None,
) -> FrontierPoint:
    """Expected return / vol / Sharpe of an ARBITRARY weight vector under the same
    mu and Sigma. This is what puts the published book on the same axes as the
    frontier — comparing a book to a frontier computed from different inputs would
    be a chart of nothing."""
    vector = np.array([float(signed_weights.get(a, 0.0)) for a in assets])
    cov = np.asarray(cov, dtype=float)
    mu_vector = np.array([float(mu.get(a, 0.0)) for a in assets])

    expected_return = float(mu_vector @ vector)
    variance = float(vector @ cov @ vector)
    volatility = float(np.sqrt(variance)) if variance > 0 else 0.0
    return FrontierPoint(
        risk_aversion=risk_aversion,
        expected_return=expected_return,
        volatility=volatility,
        gross=float(np.abs(vector).sum()),
        sharpe=(expected_return / volatility) if volatility > 0 else None,
        signed_weights=dict(signed_weights),
    )


def efficient_frontier(
    inputs: OptimizerInputs,
    constraints: OptimizerConstraints | None = None,
    risk_aversions: tuple[float, ...] | list[float] | None = None,
) -> EfficientFrontier:
    """Trace the frontier by re-solving the QP across a grid of risk aversions.

    `current` is the book as it stands (`inputs.weights0`) scored under the SAME mu and
    Sigma — the "you are here" point. It is the only part of this that answers the
    question a reader actually has, which is not "what is the frontier" but "what did
    the judgement cost".
    """
    base = constraints or OptimizerConstraints()
    grid = list(risk_aversions or GAMMA_GRID)

    points: list[FrontierPoint] = []
    warnings: list[str] = []
    seen: set[tuple[int, int]] = set()

    for gamma in grid:
        result = optimize(
            inputs,
            "mean_variance",
            OptimizerConstraints(
                max_single=base.max_single,
                default_single=base.default_single,
                max_sector=base.max_sector,
                max_geo=base.max_geo,
                max_gross=base.max_gross,
                target_gross=base.target_gross,
                max_turnover=base.max_turnover,
                risk_aversion=float(gamma),
                cvar_beta=base.cvar_beta,
            ),
        )
        if not result.feasible or result.volatility is None or result.expected_return is None:
            continue
        # Dedupe on rounded coordinates: consecutive gammas routinely land on the same
        # corner of the constraint set, and eight identical dots is not a frontier.
        key = (round(result.expected_return, 8), round(result.volatility, 8))
        int_key = (int(key[0] * 1e8), int(key[1] * 1e8))
        if int_key in seen:
            continue
        seen.add(int_key)
        points.append(
            FrontierPoint(
                risk_aversion=float(gamma),
                expected_return=result.expected_return,
                volatility=result.volatility,
                gross=result.gross or 0.0,
                sharpe=(
                    result.expected_return / result.volatility
                    if result.volatility and result.volatility > 0 else None
                ),
                signed_weights=result.signed_weights,
            )
        )

    if not points:
        warnings.append("no feasible frontier point for the constraint set")
    points.sort(key=lambda p: p.volatility)

    current = None
    if inputs.weights0:
        current = portfolio_point(
            inputs.weights0, list(inputs.assets), inputs.mu, np.asarray(inputs.cov, dtype=float)
        )

    return EfficientFrontier(points=points, current=current, warnings=warnings)
