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
from typing import Any

import cvxpy as cp
import numpy as np
import pandas as pd

# `mandate` imports nothing from services, so this cannot cycle.
from .mandate import Mandate

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

# ── Covariance shrinkage (ADR-0173) ───────────────────────────────────────────
# `covariance_from_returns` used to return the raw sample estimate, symmetrised and
# annualised, nothing else. Two things follow from that which were true and
# undisclosed:
#
#   1. This SAME estimate is minimised (as w'Sigma w) by `optimize()` AND handed to
#      `monte_carlo_var`/`compute_var_forecast` as the reporting covariance
#      (`q1_agent.py` calls `covariance_from_returns` at both sites). Minimising a
#      quadratic form under a noisy sample Sigma systematically favours the
#      directions where Sigma UNDERSTATES true covariance — Markowitz's classic
#      error-maximisation. So the risk figure on an optimised book was biased low
#      by the same estimator that sized it, and nothing said so.
#   2. The asymmetry was the tell: `expected_returns.py` shrinks mu 50% toward zero
#      (ADR-0033, IC_SHRINKAGE) because an unvalidated signal has no alpha. Sigma
#      received no equivalent treatment — the return side was treated as
#      untrustworthy and the risk side as exact, with no argument for the
#      difference.
#
# The fix shrinks toward a CONSTANT-CORRELATION target: keep each asset's own
# sample VARIANCE (the diagonal), replace every pairwise correlation with the
# sample's own average off-diagonal correlation (Ledoit & Wolf 2003's target
# matrix). Variances are kept because `size_positions` and the VaR/MC path both
# read per-asset risk contributions off this matrix, and a target that flattened
# variances too would move single-name risk for no diversification reason —
# shrinkage should quiet the noisiest part of the estimate (pairwise correlation,
# O(n^2) parameters from the same O(n) observations) without touching the part
# that is directly measured (variance, O(n) parameters).
#
# `COV_SHRINKAGE_INTENSITY` is a FIXED constant, not Ledoit-Wolf's
# asymptotically-optimal intensity. Deriving that needs the paper's pi-hat/rho-hat
# estimators — a second nontrivial thing to get right for a marginal gain over a
# stated operator choice, and this repo already has a nearby precedent for the
# fixed-constant answer: IC_SHRINKAGE is 50%, chosen and stated, not fitted. 0.25
# is smaller than that because a covariance estimated from MIN_OBS_FOR_COVARIANCE
# (60) sessions carries more information per degree of freedom than a single IC
# reading — the sample is closer to trustworthy, so it is shrunk less.
COV_SHRINKAGE_INTENSITY = 0.25

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
    # A CORRELATION COMPLEX IS ONE IDEA, so it may hold at most what one name may.
    # Named separately from `max_single` rather than aliased, so the two can diverge
    # later with an argument rather than by accident.
    max_complex: float = MAX_SINGLE_NAME_WEIGHT
    # ...AND at most one name's worth of RISK. Added to the weight cap above, never
    # substituted for it, so this can only ever tighten (ADR-0110's rule).
    #
    # A cap denominated in CAPITAL is not neutral between the instruments that express
    # one idea. At equal Sharpe, the member delivering the most expected return per unit
    # of capital is the highest-vol one, so a weight cap silently rewards leverage; and
    # equalising mu instead to dodge that rewards the lowest-vol member with a Sharpe no
    # instrument has. Both are corners, and ADR-0116 shipped one of them.
    #
    # In risk units the bias disappears. Holding member i alone at budget B takes weight
    # B/sigma_i and returns (IC*sigma_i*z)*(B/sigma_i) = IC*z*B — the SAME for every
    # member. The optimizer is then genuinely indifferent, which is the truth, and the
    # residual correlation decides: spreading beats concentrating, by more the less
    # correlated the members are. That is the basket ADR-0115 wanted, arrived at without
    # a table of which instruments are sound.
    #
    # None disables it. See ADR-0118.
    max_complex_risk_mult: float | None = MAX_SINGLE_NAME_WEIGHT
    max_gross: float = 1.0
    # None leaves deployment to the objective (the ADR-0037 reading). A float pins
    # `gross == target_gross`, which the scenario objectives require to be well-posed.
    target_gross: float | None = None
    max_turnover: float | None = None
    risk_aversion: float = 1.0
    cvar_beta: float = 0.95

    @classmethod
    def from_mandate(
        cls,
        mandate: "Mandate",
        *,
        max_single: float | dict[str, float] | None = None,
        **overrides: Any,
    ) -> "OptimizerConstraints":
        """Build the solver's constraints from a `Mandate`.

        THE POINT OF THIS CONSTRUCTOR is that the mandate is a parameter, not an
        ambient fact. The nightly run, a re-size under a different capital base and a
        caller-supplied mandate all reach the same solver through here, so they
        cannot disagree about what a limit is — the failure that let the risk board
        publish a 200% gross ceiling against a sizer enforcing 100%.

        `max_single` overrides only the per-name cap, for the crowding map (ADR-0110),
        which tightens named positions and leaves every other name on the mandate's
        `default_single`. It may only ever tighten: `_cap_vector` takes the min.
        """
        return cls(
            max_single=mandate.max_single_name if max_single is None else max_single,
            default_single=mandate.max_single_name,
            max_sector=mandate.max_sector,
            max_geo=mandate.max_geo,
            max_complex=mandate.max_complex,
            max_complex_risk_mult=mandate.max_complex,
            max_gross=mandate.max_gross,
            max_turnover=mandate.max_turnover,
            **overrides,
        )


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
    # Signed. The CONVICTION book of this same run — weight_delta and the frontier's
    # "you are here" point are both scored against it. NOT the turnover baseline.
    weights0: dict[str, float] | None = None
    # Signed. YESTERDAY'S published book (book_holdings.signed_weight) — the ONLY
    # baseline the turnover constraint uses. Distinct from `weights0` on purpose: see
    # the comment at the constraint site in `optimize()` for why conflating the two
    # caps the wrong quantity (ADR-0173).
    weights_held: dict[str, float] | None = None
    scenarios: np.ndarray | None = None            # T x n daily returns, `assets` order
    sector_map: dict[str, str] | None = None
    geo_map: dict[str, str] | None = None
    # {asset: complex_id} from `book_metrics.independent_ideas`. Names correlated at or
    # above 0.70 share an id; a name correlated with nothing is absent, and is therefore
    # governed by the single-name cap alone.
    complex_map: dict[str, str] | None = None


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
    # Intra-run: this solve's weights vs `weights0` (the conviction book). What the
    # optimizer changed relative to its own starting point — unrelated to how much
    # the PUBLISHED book moves day over day. Unchanged meaning; kept for
    # `weight_delta`/frontier consumers that already read it.
    turnover: float | None
    # Day-over-day: this solve's weights vs `weights_held` (yesterday's published
    # book). None when `weights_held` was not supplied — e.g. no prior book exists —
    # which is a different claim from 0.0 (a book that moved nothing). THIS is the
    # figure the mandate's `max_turnover` actually governs (ADR-0173).
    realised_turnover: float | None = None
    # The cap that was IN FORCE for this solve, echoed so a reader never has to
    # cross-reference the mandate to know whether today's number was constrained.
    # None when no cap applied — either the mandate carries none, or there was no
    # prior book to measure against.
    turnover_cap: float | None = None
    # The share of `realised_turnover` that came from names held YESTERDAY but not
    # among today's candidates at all — a full exit the solver never had as a
    # decision variable, so no constraint on `w` could have prevented it. Live
    # evidence it can dominate: on the 2026-07-30 run this was 34.5 of 94.5 points.
    # Named separately because folding it into `realised_turnover` silently would
    # repeat the exact defect this field exists to fix (ADR-0174).
    forced_exit_turnover: float | None = None
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
            "realised_turnover": self.realised_turnover,
            "turnover_cap": self.turnover_cap,
            "forced_exit_turnover": self.forced_exit_turnover,
            "binding_constraints": list(self.binding_constraints),
            "zeroed": list(self.zeroed),
            "warnings": list(self.warnings),
            "reason": self.reason,
        }


def _psd_sqrt(matrix: np.ndarray) -> np.ndarray:
    """A symmetric square root of a covariance block, via eigendecomposition.

    Cholesky is the obvious choice and the wrong one here: a correlation complex is
    NEAR-SINGULAR by construction — its members are correlated at 0.70 or above, and on
    the live book at 0.99 — so `np.linalg.cholesky` raises on the exact input this is
    always given. `eigh` is stable on a symmetric matrix and lets the negative
    eigenvalues that floating-point noise produces be clipped to zero rather than
    crashing or producing a complex root.
    """
    sym = (np.asarray(matrix, dtype=float) + np.asarray(matrix, dtype=float).T) / 2.0
    eigenvalues, eigenvectors = np.linalg.eigh(sym)
    eigenvalues = np.clip(eigenvalues, 0.0, None)
    return eigenvectors @ np.diag(np.sqrt(eigenvalues)) @ eigenvectors.T


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


def _shrink_to_constant_correlation(cov: np.ndarray, intensity: float) -> np.ndarray:
    """Shrink a sample covariance toward a constant-correlation target.

    Target keeps the SAMPLE variances (the diagonal) and replaces every pairwise
    correlation with the sample's own average off-diagonal correlation. See
    `COV_SHRINKAGE_INTENSITY`'s module-level comment for why variances are kept and
    why the intensity is a stated constant rather than an asymptotically-derived one.

    `intensity <= 0` or fewer than 2 assets returns `cov` unchanged rather than
    raising — a shrinkage helper that fails closed on a degenerate matrix is safer
    than one that has to be guarded at every call site.
    """
    n = cov.shape[0]
    if n < 2 or intensity <= 0:
        return cov
    std = np.sqrt(np.diag(cov))
    # A zero-variance asset (constant price over the window) would divide by zero
    # forming the correlation matrix; its row/column of the TARGET is then built
    # from a placeholder std of 1.0, which the outer product below immediately
    # rescales back to variance 0 via `np.outer(std, std)` using the REAL std — so
    # the placeholder only prevents the division, it never leaks into the target.
    std_safe = np.where(std > 0, std, 1.0)
    corr = cov / np.outer(std_safe, std_safe)
    off_diag_sum = corr.sum() - np.trace(corr)
    n_pairs = n * (n - 1)
    avg_corr = float(off_diag_sum / n_pairs) if n_pairs > 0 else 0.0
    target_corr = np.full((n, n), avg_corr)
    np.fill_diagonal(target_corr, 1.0)
    target = target_corr * np.outer(std, std)
    shrunk = (1.0 - intensity) * cov + intensity * target
    return (shrunk + shrunk.T) / 2.0


def covariance_from_returns(
    returns: pd.DataFrame,
    assets: list[str],
    trading_days: int = TRADING_DAYS,
    min_obs: int = MIN_OBS_FOR_COVARIANCE,
    shrinkage: float = COV_SHRINKAGE_INTENSITY,
) -> tuple[np.ndarray | None, list[str], list[str]]:
    """Annualised, SHRUNK covariance over the assets that have history.

    (cov, used, dropped). Shrunk toward constant correlation at `shrinkage` —
    see the module-level comment on `COV_SHRINKAGE_INTENSITY` for why. Every
    caller inherits it automatically: the optimizer and the VaR/Monte-Carlo report
    both call this same function, so they cannot diverge on which Sigma is "the"
    covariance (ADR-0173).

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
    cov = _shrink_to_constant_correlation(cov, shrinkage)
    if not np.all(np.isfinite(cov)):
        return None, [], list(assets)
    return cov, used, dropped


def _project_group_caps(
    weights: dict[str, float],
    groupings: list[tuple[dict[str, str], float | None, str]],
) -> tuple[dict[str, float], list[str]]:
    """Scale any group whose total overshoots its cap back onto it.

    `_round_weights` FLOORS each magnitude, which absorbs the ~1e-8 a solver leaves on a
    SINGLE name. It cannot fix a GROUP: flooring three weights removes at most 3e-8,
    while the solver satisfies a summed constraint to its own feasibility tolerance —
    measured at **3.3e-6** over a 20% complex cap on the 2026-07-27 book, three hundred
    times what flooring can reach and three orders above `CAP_EPSILON` (1e-9), which is
    what `exceeds_cap` uses to decide a breach.

    So `/risk` could report a governance violation on a book the optimizer had solved
    correctly, and [ADR-0068](../../docs/adrs/0068-a-cap-breach-must-not-be-decided-by-float-error.md)
    forbids exactly that. **Loosening `CAP_EPSILON` to swallow it was rejected**: that
    turns a representation-error guard into a fitted economic tolerance, which is the
    thing its own comment warns against. Project the weights instead, so the stored book
    genuinely satisfies the limit rather than being declared close enough.

    Each name takes the STRICTEST scale any of its groups demands. Scaling down can only
    reduce every other group's total, so one pass is sufficient and conservative — it may
    land a little under a cap, never over. Magnitudes only shrink, so single-name caps and
    the gross budget stay satisfied and no sign moves.
    """
    scale: dict[str, float] = {}
    binding: list[str] = []
    for group_of, cap, label in groupings:
        if cap is None or cap <= 0 or not group_of:
            continue
        totals: dict[str, float] = {}
        for asset, weight in weights.items():
            key = group_of.get(asset)
            if key is not None:
                totals[key] = totals.get(key, 0.0) + abs(weight)
        for key, total in totals.items():
            if total <= cap or total <= 0:
                continue
            factor = cap / total
            binding.append(
                f"{key}: {label} total {total:.8f} projected onto its {cap:.2%} cap"
            )
            for asset in weights:
                if group_of.get(asset) == key:
                    scale[asset] = min(scale.get(asset, 1.0), factor)
    if not scale:
        return weights, []
    return (
        {a: w * scale.get(a, 1.0) for a, w in weights.items()},
        binding,
    )


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
    complex_members: dict[str, list[int]] = {}
    for group_of, cap, label, sparse in (
        (sector_map, c.max_sector, "sector", False),
        (geo_map, c.max_geo, "geo", False),
        # A complex is one idea expressed across several tickers. Without this the
        # single-name cap is trivially evaded: three names correlated at 0.9 can hold 60%
        # of gross between them while each reports comfortable headroom. Same failure the
        # SECTOR cap exists for (ADR-0037), on a grouping the correlation matrix defines
        # rather than the taxonomy.
        #
        # SPARSE, unlike the other two. An unclassified SECTOR is a taxonomy gap and must
        # be reported; a name in no complex is simply correlated with nothing, which is
        # the common case. Warning on it buried the real gaps under one line per
        # standalone name — `trade_ranker._apply_group_cap` already carries the same
        # distinction, for the same reason.
        (inputs.complex_map or {}, c.max_complex, "correlation complex", True),
    ):
        if cap is None or cap <= 0:
            continue
        members: dict[str, list[int]] = {}
        for i, asset in enumerate(assets):
            key = group_of.get(asset)
            if key is None:
                if not sparse:
                    warnings.append(
                        f"{asset}: no {label} mapping, {label} cap not applied"
                    )
                continue
            members.setdefault(key, []).append(i)
        for _key, idx in members.items():
            cons.append(cp.sum(magnitude[idx]) <= cap)
        if sparse:
            complex_members = members

    # ── The complex's RISK budget, on top of its capital budget ──────────────────
    # `||Sigma_C^(1/2) w_C|| <= B` — the sub-portfolio's standalone volatility. A second-
    # order cone, so mean-variance stays a QCQP and the two scenario LPs become SOCPs;
    # cvxpy handles both. Deliberately NOT an Euler contribution, which divides by the
    # whole book's sigma and is not convex.
    #
    # B scales with the BOOK's median vol, not the complex's own. Scaling it with the
    # complex's members would hand a complex of levered instruments a bigger risk budget
    # for being volatile, which is precisely backwards.
    complex_risk_budget: float | None = None
    if c.max_complex_risk_mult and complex_members:
        variances = np.diag(cov)
        vols_all = np.sqrt(np.clip(variances, 0.0, None))
        usable = vols_all[np.isfinite(vols_all) & (vols_all > 0)]
        if usable.size:
            complex_risk_budget = float(c.max_complex_risk_mult) * float(np.median(usable))
            for _key, idx in complex_members.items():
                if len(idx) < 2:
                    # A one-member complex is already governed by the single-name cap;
                    # adding a risk cap would silently tighten a standalone name for the
                    # accident of being clustered with nothing.
                    continue
                sub = cov[np.ix_(idx, idx)]
                root = _psd_sqrt(sub)
                cons.append(cp.norm(root @ w[idx], 2) <= complex_risk_budget)

    # `weights_held`, NOT `w0`/`weights0`. `weights0` is the CONVICTION book of this
    # same run — `weight_delta` and the frontier's "you are here" both need that
    # baseline (size_positions' own comment says so), so binding turnover to it would
    # cap the optimizer's intra-run adjustment rather than day-over-day churn. That
    # was ADR-0150's finding about `rebalance_cost` one layer along: the measurement
    # was fixed, the optimiser was never re-pointed. `weights_held` is yesterday's
    # PUBLISHED book (`book_holdings.signed_weight`), fetched once in `run_q1_agent`
    # and carried on `state["weights_held"]` (ADR-0173).
    #
    # Applied only when BOTH sides are present: a cap with no prior book to measure
    # from would either silently do nothing (weights_held defaults to zeros, which
    # is a full-rebalance-from-cash claim no run has ever made) or block the very
    # first book. Absence of a prior book is not evidence the book should not move.
    w_held = (
        np.array([float((inputs.weights_held or {}).get(a, 0.0)) for a in assets])
        if inputs.weights_held is not None
        else None
    )
    # A name held YESTERDAY that is not among TODAY's candidates at all is not a
    # decision `w` can make — it is not a variable in this problem, so no constraint
    # on `w` can see it exiting. `cp.norm1(w - w_held)` over `assets` alone is
    # exactly "iterating one side's keys", the trap `held_book.weight_delta`'s own
    # docstring names: it prices every entry and reweight but misses every exit of a
    # name the candidate screen dropped. Live evidence: the 2026-07-30 run's solver
    # bound itself to exactly 60.0% over `assets` while five prior holdings it never
    # saw (TLT/VRT/GDX/PDD/NOC) added another 34.5 points the constraint could not
    # have prevented — `book_holdings_performance.turnover` measured 94.5% (ADR-0174).
    #
    # Fixed by treating those exits as a FORCED, non-negotiable cost paid before the
    # solver gets a budget: it is not a choice `w` makes, so it is subtracted from
    # `max_turnover` up front rather than added to the constraint on `w`, which has
    # no term that could represent it.
    assets_set = set(assets)
    forced_exit_turnover = (
        float(sum(
            abs(v) for a, v in (inputs.weights_held or {}).items() if a not in assets_set
        ))
        if inputs.weights_held is not None
        else None
    )
    if c.max_turnover is not None and w_held is not None:
        remaining_budget = max(0.0, float(c.max_turnover) - (forced_exit_turnover or 0.0))
        cons.append(cp.norm1(w - w_held) <= remaining_budget)
        if (forced_exit_turnover or 0.0) > float(c.max_turnover) + 1e-9:
            warnings.append(
                f"turnover budget already exhausted by candidate exits alone "
                f"({forced_exit_turnover:.1%} vs a {float(c.max_turnover):.1%} cap) — "
                "the solver was left 0% remaining, not a negative budget"
            )

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
    # A group cap is satisfied to the SOLVER's tolerance, not to CAP_EPSILON's.
    # Project rather than loosen the epsilon — see `_project_group_caps`.
    weights, projected = _project_group_caps(
        weights,
        [
            (sector_map, c.max_sector, "sector"),
            (geo_map, c.max_geo, "geo"),
            (inputs.complex_map or {}, c.max_complex, "correlation complex"),
        ],
    )
    if projected:
        # Re-floor after scaling: the multiply reintroduces digits past the 8dp
        # the stored book is meant to carry.
        weights = _round_weights(
            np.array([weights[a] for a in assets]), assets, signs
        )
        warnings.extend(projected)

    vector = np.array([weights[a] for a in assets])
    gross = float(np.abs(vector).sum())
    net = float(vector.sum())
    variance = float(vector @ cov @ vector)
    volatility = float(np.sqrt(variance)) if variance > 0 else 0.0
    expected_return = float(mu @ vector)
    delta = {a: weights[a] - float((inputs.weights0 or {}).get(a, 0.0)) for a in assets}
    turnover = float(sum(abs(d) for d in delta.values()))
    # Day-over-day, against yesterday's PUBLISHED book — see the field docstring on
    # OptimizationResult. None (not 0.0) when there was no prior book to measure
    # from; the two are different claims. Includes `forced_exit_turnover` so this
    # matches what `book_holdings_performance.turnover` independently measures over
    # the FULL union of yesterday's and today's names — not just what `w` could see.
    realised_turnover = (
        float(sum(abs(weights[a] - w_held[i]) for i, a in enumerate(assets)))
        + (forced_exit_turnover or 0.0)
        if w_held is not None
        else None
    )
    turnover_cap = float(c.max_turnover) if (c.max_turnover is not None and w_held is not None) else None

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
        (inputs.complex_map or {}, c.max_complex, "correlation complex"),
    ):
        totals: dict[str, float] = {}
        for asset in assets:
            key = group_of.get(asset)
            if key is not None:
                totals[key] = totals.get(key, 0.0) + abs(weights[asset])
        for key, total in totals.items():
            if abs(total - cap) < 1e-4:
                binding.append(f"{key} at {label} cap")
    # The risk budget binds silently otherwise: the complex would sit visibly BELOW its
    # capital cap while being the thing that stopped the book, and a reader would read
    # the headroom as slack. Report it in the same vocabulary as the weight caps.
    if complex_risk_budget:
        for key, idx in complex_members.items():
            if len(idx) < 2:
                continue
            sub_w = np.array([vector[i] for i in idx])
            standalone = float(np.sqrt(max(0.0, sub_w @ cov[np.ix_(idx, idx)] @ sub_w)))
            if abs(standalone - complex_risk_budget) < 1e-4:
                binding.append(
                    f"{key} at correlation complex RISK cap "
                    f"({standalone:.1%} vol vs {complex_risk_budget:.1%} budget)"
                )
    budget = c.target_gross if c.target_gross is not None else c.max_gross
    if abs(gross - budget) < 1e-4:
        binding.append("gross at budget")
    # Checked against REALISED turnover, not the intra-run figure — the constraint
    # itself binds `w - w_held`, so this must test the same quantity it constrains.
    # Testing `turnover` (vs weights0/conviction) here would report the wrong
    # distance as "at cap" whenever the two diverge, which they routinely do.
    #
    # Two distinct outcomes, not one: the solver can land exactly on its (possibly
    # reduced) remaining budget, which is an ordinary bind; or forced exits alone can
    # already exceed the cap before the solver made a single choice, which is a
    # breach the turnover constraint had no power to prevent and must not be
    # reported as merely "at cap" — that phrase claims control that was not there.
    if turnover_cap is not None and realised_turnover is not None:
        if abs(realised_turnover - turnover_cap) < 1e-4:
            binding.append("turnover at cap")
        elif realised_turnover > turnover_cap + 1e-4:
            binding.append(
                f"turnover cap breached by candidate exits alone "
                f"({(forced_exit_turnover or 0.0):.1%} of a {turnover_cap:.1%} budget, "
                "before any solver choice)"
            )

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
        realised_turnover=realised_turnover,
        turnover_cap=turnover_cap,
        forced_exit_turnover=forced_exit_turnover,
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
                max_complex=base.max_complex,
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
