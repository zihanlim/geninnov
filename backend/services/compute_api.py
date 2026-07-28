"""Request-time compute: size a book, price an unscored ticker.

WHY THIS EXISTS
---------------
The published book is one instantiation of the signal under ONE mandate. A reader
with a different capital base, or one who wants to drop a name and see what the
sizer does, needs the sizer itself — and the sizer is `cvxpy`, which cannot run in a
browser.

A JavaScript reimplementation is not an option. ADR-0107 exists because the source
`optimizer.py` was read across from clipped every weight at zero regardless of its
own `long_only` flag and renormalised to sum 1, which on a long-short book deletes
every short. A second sizer is a second set of that class of bug, discovered by a
reader rather than by a test. So this module calls THE optimizer — the same function
`q1_agent.size_positions` calls, under the same `Mandate` object.

WHAT IT IS ALLOWED TO DO
------------------------
Nothing that changes anything. It reads, it computes, it returns. It writes to no
table, cannot re-run the pipeline, and cannot republish a book. That is the bar
design goal 5 sets for any server-side control, and the bar `/ask` had to clear.

THE LINE ON UNSCORED TICKERS
----------------------------
`price_asset` will estimate volatility and factor betas for ANY ticker with price
history, because those derive from prices alone. It will never return an EdgeScore or
a conviction for a name outside the candidate pool: those require a theme, news
mentions and a HypeScore, which an arbitrary ticker has none of. The absence is
returned with its cause (design goal 2), never as a zero — and `mu = 0` in the
optimizer for such a name is a statement that we have NO VIEW, which means it can be
held only for variance reduction and never for expected return. ADR-0108 refuses to
default a μ; this is the same refusal, said out loud.

See ADR-0149.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from .mandate import DEFAULT_MANDATE, Mandate
from .optimizer import OptimizerConstraints, OptimizerInputs, optimize

# A book this large is not a portfolio, it is a denial-of-service. The solve is
# O(n^2) in the covariance and cvxpy is not free.
MAX_ASSETS = 60

# Below this, a covariance estimate is noise. Mirrors optimizer.MIN_OBS_FOR_COVARIANCE
# rather than restating a second threshold.
from .optimizer import MIN_OBS_FOR_COVARIANCE  # noqa: E402


class ComputeError(ValueError):
    """A request that cannot be served, with a reason a caller can act on."""


def mandate_from_payload(payload: dict[str, Any] | None) -> Mandate:
    """Build a `Mandate` from a caller-supplied JSON object.

    Absent fields fall back to Andromeda's own mandate, so a caller who wants "your
    book but at $500M" sends one field rather than nine. Every value is validated:
    a negative cap or a gross budget of 40 is a request this refuses rather than a
    book it sizes.
    """
    payload = payload or {}
    fields = {
        "total_capital": (1_000.0, 1e13),
        "max_single_name": (0.0001, 1.0),
        "max_sector": (0.0001, 1.0),
        "max_geo": (0.0001, 1.0),
        "max_gross": (0.0001, 10.0),
        "max_complex": (0.0001, 1.0),
        "crowded_multiplier": (0.0, 1.0),
    }
    kwargs: dict[str, Any] = {}
    for name, (lo, hi) in fields.items():
        if name not in payload or payload[name] is None:
            continue
        try:
            value = float(payload[name])
        except (TypeError, ValueError):
            raise ComputeError(f"{name} must be a number, got {payload[name]!r}")
        if not (lo <= value <= hi) or value != value:
            raise ComputeError(
                f"{name} must be between {lo} and {hi}, got {value}"
            )
        kwargs[name] = value

    lens = payload.get("lens")
    if isinstance(lens, str) and lens:
        kwargs["lens"] = lens

    base = DEFAULT_MANDATE
    return Mandate(
        total_capital=kwargs.get("total_capital", base.total_capital),
        max_single_name=kwargs.get("max_single_name", base.max_single_name),
        max_sector=kwargs.get("max_sector", base.max_sector),
        max_geo=kwargs.get("max_geo", base.max_geo),
        max_gross=kwargs.get("max_gross", base.max_gross),
        max_complex=kwargs.get("max_complex", base.max_complex),
        crowded_multiplier=kwargs.get("crowded_multiplier", base.crowded_multiplier),
        max_longs=base.max_longs,
        max_shorts=base.max_shorts,
        lens=kwargs.get("lens", base.lens),
        # Every field came from the request, so none of it came from scoring_config.
        # Saying so keeps the provenance contract intact for a caller-sized book.
        sources={k: "code_default" for k in kwargs},
    )


def size_book(
    signals: list[dict[str, Any]],
    mandate: Mandate,
    cov: np.ndarray | None = None,
    sector_map: dict[str, str] | None = None,
    geo_map: dict[str, str] | None = None,
    objective: str = "mean_variance",
) -> dict[str, Any]:
    """Size a set of signals under a mandate, using the real optimizer.

    `signals` are rows shaped like `book_signal`: asset, direction, and either a
    `mu` or the `conviction`/`vol` to derive one from.

    **A name with no expected return enters at `mu = 0`.** That is not a neutral
    default dressed as a measurement — it is the correct encoding of "no view" in a
    mean-variance problem, and it has a consequence the caller must be told: such a
    name can be held only for variance reduction, never for expected return. The
    returned payload names every asset this applied to.
    """
    if not signals:
        raise ComputeError("no signals supplied")
    if len(signals) > MAX_ASSETS:
        raise ComputeError(
            f"{len(signals)} assets exceeds the {MAX_ASSETS}-name limit for a single solve"
        )

    assets: list[str] = []
    directions: dict[str, str] = {}
    mu: dict[str, float] = {}
    no_view: list[str] = []

    for row in signals:
        asset = row.get("asset")
        direction = row.get("direction")
        if not asset or direction not in ("long", "short"):
            raise ComputeError(
                f"each signal needs an asset and a direction of long|short, got {row!r}"
            )
        if asset in directions:
            raise ComputeError(f"{asset} appears twice")
        assets.append(asset)
        directions[asset] = direction

        value = _mu_for(row)
        if value is None:
            # No EdgeScore => no μ. ADR-0108 never defaults one, and neither does
            # this: 0.0 here MEANS no view, and the caller is told which names it
            # applied to so the zero cannot be read as a measurement.
            mu[asset] = 0.0
            no_view.append(asset)
        else:
            mu[asset] = value

    n = len(assets)
    if cov is None:
        # No covariance supplied: fall back to a diagonal built from each name's own
        # vol, which assumes zero correlation. That assumption is WRONG and is
        # returned as a caveat rather than buried — a diagonal covariance
        # systematically understates the risk of a concentrated book.
        vols = np.array([_vol_for(r) for r in signals], dtype=float)
        cov_matrix = np.diag(vols**2)
    else:
        cov_matrix = np.asarray(cov, dtype=float)
        if cov_matrix.shape != (n, n):
            raise ComputeError(
                f"covariance is {cov_matrix.shape}, expected ({n}, {n}) for {n} assets"
            )

    result = optimize(
        OptimizerInputs(
            assets=assets,
            directions=directions,
            mu=mu,
            cov=cov_matrix,
            sector_map=sector_map,
            geo_map=geo_map,
        ),
        objective,
        OptimizerConstraints.from_mandate(mandate),
    )

    payload = result.to_dict()
    payload["mandate"] = mandate.to_dict()
    payload["notional"] = {
        asset: weight * mandate.total_capital
        for asset, weight in (result.signed_weights or {}).items()
    }
    if no_view:
        payload["no_expected_return"] = {
            "assets": sorted(no_view),
            "note": (
                "These names carry no EdgeScore, so they entered the solve at mu = 0. "
                "That is 'no view', not 'zero expected return measured': the optimizer "
                "can hold them for variance reduction only, never for return."
            ),
        }
    if cov is None:
        payload.setdefault("warnings", []).append(
            "covariance not supplied: a diagonal was built from each name's own "
            "volatility, which assumes ZERO correlation and understates the risk of "
            "a concentrated book"
        )
    return payload


def _mu_for(row: dict[str, Any]) -> float | None:
    """Expected return for one signal row, or None when there is no view.

    Prefers an explicit `mu`. Otherwise derives the Grinold-Kahn shape from
    conviction and vol — `conviction = |edge| / vol`, so `edge = conviction * vol`,
    and the direction supplies the sign. Returns None rather than 0.0 when neither is
    available, so the caller can distinguish "no view" from "a measured zero".
    """
    explicit = row.get("mu")
    if explicit is not None:
        try:
            value = float(explicit)
        except (TypeError, ValueError):
            return None
        return value if value == value else None

    conviction = row.get("conviction")
    vol = row.get("vol")
    if conviction is None or vol is None:
        return None
    try:
        conviction_f = float(conviction)
        vol_f = float(vol)
    except (TypeError, ValueError):
        return None
    if conviction_f != conviction_f or vol_f != vol_f:
        return None

    edge = abs(conviction_f) * abs(vol_f)
    return -edge if row.get("direction") == "short" else edge


def _vol_for(row: dict[str, Any]) -> float:
    """Daily vol for the diagonal fallback. A missing vol gets the book median-ish
    0.02 rather than 0, because a zero-variance asset would absorb the entire book."""
    vol = row.get("vol")
    try:
        value = float(vol)
    except (TypeError, ValueError):
        return 0.02
    if value != value or value <= 0:
        return 0.02
    return value


def factor_betas(
    asset_returns: np.ndarray,
    factor_returns: np.ndarray,
) -> dict[str, float | None]:
    """OLS betas of one asset on the FF5+UMD factors, plus R².

    Plain least squares rather than a statsmodels dependency: the quantity is a
    projection, and adding 30MB to a serverless bundle to compute one is not a
    trade worth making.

    Returns None for every beta when the sample is too short to estimate — a beta
    from ten observations is a number, not an estimate.
    """
    names = ["beta_mkt", "beta_smb", "beta_hml", "beta_rmw", "beta_cma", "beta_umd"]
    y = np.asarray(asset_returns, dtype=float).ravel()
    x = np.asarray(factor_returns, dtype=float)
    if x.ndim == 1:
        x = x.reshape(-1, 1)

    if len(y) < MIN_OBS_FOR_COVARIANCE or len(y) != len(x):
        return {name: None for name in names[: x.shape[1]]} | {
            "r_squared": None,
            "observations": int(len(y)),
            "insufficient": True,
        }

    design = np.column_stack([np.ones(len(x)), x])
    coef, *_ = np.linalg.lstsq(design, y, rcond=None)
    fitted = design @ coef
    resid = y - fitted
    ss_tot = float(((y - y.mean()) ** 2).sum())
    r2 = 1.0 - float((resid**2).sum()) / ss_tot if ss_tot > 0 else None

    out: dict[str, float | None] = {
        name: float(coef[i + 1]) for i, name in enumerate(names[: x.shape[1]])
    }
    out["r_squared"] = r2
    out["observations"] = int(len(y))
    out["insufficient"] = False
    return out
