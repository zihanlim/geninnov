"""
L5 — expected returns for the optimizer. Constructed from a measured IC, never assumed.

**Why this exists.** A mean-variance optimizer needs an annualised expected-return
vector mu. Andromeda does not have one. It has EdgeScore in [-1, 1], which is a
*ranking* signal: it says QQQ looks better than TLT, not that QQQ will return 8%.
Handing EdgeScore to the optimizer as mu is a units error — the optimizer would be
trading off a dimensionless score against an annualised variance and the risk-aversion
gamma would mean nothing.

**The transform.** Grinold-Kahn's fundamental law, in its forecasting form:

    mu_i = IC * sigma_i * z_i

An information coefficient of `IC` on a signal `z` standardised cross-sectionally,
applied to an asset with annualised volatility `sigma`, implies that expected return.
Each term is doing real work:

  * `IC` is the *measured* correlation between the signal and forward returns. It is
    read from `backtest_results`, which `scripts/backtest_edge.py` populates. It is
    never defaulted — a book sized on an assumed IC is a book sized on a wish.
  * `sigma_i` converts the dimensionless score into return units. A high-vol name gets
    a bigger expected return for the same score, which is what makes the resulting
    weights inverse-vol-like rather than score-like.
  * `z_i` is the cross-sectionally standardised EdgeScore.

**Weak IC is a feature here, not a defect.** Andromeda's measured EdgeScore ICs are
small (Trend +0.03, ADR-0031; ADR-0044 records the carry IC having been measured on a
superseded signal). A small IC shrinks mu toward zero, which makes the mean-variance
objective `max mu'w - (gamma/2) w'Sigma w` lean on the risk term. So a weak signal
produces a book that looks more like minimum-variance and less like a bet — which is
the correct response to weak evidence, and it happens automatically rather than by
anyone's judgement. It is the same instinct as ADR-0033's shrinkage, expressed in the
sizing rather than in the weights.

**We never flip a negative IC.** A composite IC at or below zero means the signal has
no demonstrated predictive power, so there is no return forecast to give: this module
returns `None` and the caller falls back to `allocate_portfolio`. Reading a weak
negative IC as "the signal works, backwards" is fitting the noise, and it would invert
every direction L5 chose.

See ADR-0108.
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass, field

import pandas as pd

# Match `risk_decomposition.TRADING_DAYS` and `risk_engine`. Annualising the same book
# at two different conventions makes it report two different vols (the reason the Euler
# port kept 252 rather than im-Jarvis's 260).
TRADING_DAYS = 252

# A vol estimated from a handful of sessions is not an estimate. Same floor as
# `risk_decomposition.MIN_OBS_FOR_COVARIANCE`, and for the same reason: below it we
# return nothing rather than a fragile number (ADR-0023).
MIN_OBS_FOR_VOL = 60

# ADR-0033 shrinks IC-fitted weights 50% toward their priors on thin/weak evidence.
# The same discipline applies to the IC itself, and here the prior is explicit: an
# unvalidated signal has no alpha, so we shrink toward zero.
IC_SHRINKAGE = 0.5

# The EdgeScore blend weights, mirroring `edge_signals.compute_edge_score`'s defaults
# (ADR-0032 stage 3-4, ADR-0033 stage 5). Kept as a module constant so the composite IC
# is blended with the same weights that built the score it is an IC *of*; a test pins
# them against `compute_edge_score`'s signature so the two cannot drift apart.
EDGE_COMPONENT_WEIGHTS: dict[str, float] = {
    "trend": 0.35,
    "regime": 0.25,
    "carry": 0.20,
    "value": 0.20,
    "sentiment": 0.0,
}


@dataclass(frozen=True)
class IcReading:
    """A composite EdgeScore IC, with everything needed to judge it.

    `value` is already shrunk and is guaranteed > 0 — an unusable reading is returned
    as `None` from the builders rather than as an `IcReading` carrying a zero, so a
    caller cannot accidentally multiply by it.
    """

    value: float
    raw: float                       # before shrinkage — what was actually measured
    shrinkage: float
    components: dict[str, float]     # the measured per-component ICs that went in
    weights: dict[str, float]        # renormalised over the measured components
    n_observations: int              # smallest N across the measured components
    as_of: str | None = None
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "value": self.value,
            "raw": self.raw,
            "shrinkage": self.shrinkage,
            "components": dict(self.components),
            "weights": dict(self.weights),
            "n_observations": self.n_observations,
            "as_of": self.as_of,
            "notes": list(self.notes),
        }


def composite_edge_ic(
    rows: list[dict],
    weights: dict[str, float] | None = None,
    shrinkage: float = IC_SHRINKAGE,
) -> tuple[IcReading | None, str | None]:
    """Blend per-component ICs into one number for EdgeScore. Returns (reading, reason).

    `rows` are `backtest_results` rows as `scripts/backtest_edge.py` writes them:
    `metric_name` is `edge_ic_<component>`, `realized_value` is the Spearman rank IC
    (or `None` when the component was not testable), and `notes` is a JSON blob
    carrying `n`, `p_value` and `testable`.

    Components with no measured IC are **dropped and the weights renormalised over the
    rest**, exactly as `compute_edge_score` handles a not-computable component
    (ADR-0036/ADR-0066). Scoring an unmeasured component as IC 0 is not neutral: it
    would drag the composite toward zero in proportion to how much of our signal we
    have not yet been able to test, penalising the book for a gap in our validation
    rather than for a weakness in the signal.

    Exactly one of the two return slots is populated. On failure the reason is a short
    string suitable for persisting next to the book, because "no expected returns" is
    a fact a reader is owed rather than a silent fallback (ADR-0098).
    """
    if not rows:
        return None, "no backtest_results rows for edge_ic"

    w_all = dict(weights or EDGE_COMPONENT_WEIGHTS)

    measured: dict[str, float] = {}
    counts: list[int] = []
    as_of: str | None = None

    for row in rows:
        name = str(row.get("metric_name") or "")
        if not name.startswith("edge_ic_"):
            continue
        component = name[len("edge_ic_"):]
        if component not in w_all:
            continue

        value = row.get("realized_value")
        if value is None:
            continue
        try:
            ic = float(value)
        except (TypeError, ValueError):
            continue
        if not math.isfinite(ic):
            continue

        measured[component] = ic

        # `notes` is written as a JSON string. A malformed blob costs us the N, not
        # the reading — N is context for the reader, not an input to the arithmetic.
        raw_notes = row.get("notes")
        if isinstance(raw_notes, str):
            try:
                raw_notes = json.loads(raw_notes)
            except (ValueError, TypeError):
                raw_notes = None
        if isinstance(raw_notes, dict) and isinstance(raw_notes.get("n"), int):
            counts.append(int(raw_notes["n"]))

        end_date = row.get("end_date")
        if end_date and (as_of is None or str(end_date) > as_of):
            as_of = str(end_date)

    if not measured:
        return None, "no component of EdgeScore has a measured IC yet"

    # Renormalise the blend weights over the components that were actually measured.
    usable = {k: w_all[k] for k in measured if w_all.get(k, 0.0) > 0.0}
    total_w = sum(usable.values())
    if total_w <= 0:
        return None, (
            "the only components with a measured IC carry zero weight in EdgeScore"
        )
    norm = {k: w / total_w for k, w in usable.items()}

    raw_ic = sum(norm[k] * measured[k] for k in norm)
    value = raw_ic * (1.0 - shrinkage)

    if value <= 0.0:
        # Never flip. See the module docstring.
        return None, (
            f"composite EdgeScore IC is {raw_ic:+.4f} — at or below zero, so there is "
            "no measured return forecast to size on"
        )

    notes: list[str] = []
    unmeasured = [k for k in w_all if k not in measured and w_all[k] > 0.0]
    if unmeasured:
        notes.append(
            "no measured IC, weight renormalised away: " + ", ".join(sorted(unmeasured))
        )

    return (
        IcReading(
            value=value,
            raw=raw_ic,
            shrinkage=shrinkage,
            components=measured,
            weights=norm,
            n_observations=min(counts) if counts else 0,
            as_of=as_of,
            notes=notes,
        ),
        None,
    )


def annualised_vol(
    returns: pd.DataFrame,
    trading_days: int = TRADING_DAYS,
    min_obs: int = MIN_OBS_FOR_VOL,
) -> dict[str, float]:
    """Per-asset annualised realised vol from a daily-return frame.

    Columns with fewer than `min_obs` non-null observations, or a non-finite or
    non-positive result, are **omitted** rather than zeroed. A zero vol would make
    `mu_i` zero for a name we simply could not measure, which is a different claim
    from "we expect nothing from it".
    """
    if returns is None or returns.empty:
        return {}

    out: dict[str, float] = {}
    for column in returns.columns:
        series = returns[column].dropna()
        if len(series) < min_obs:
            continue
        daily = float(series.std(ddof=1))
        if not math.isfinite(daily) or daily <= 0:
            continue
        out[str(column)] = daily * math.sqrt(trading_days)
    return out


def build_mu(
    positions: list[dict],
    returns: pd.DataFrame,
    ic: IcReading | float,
    trading_days: int = TRADING_DAYS,
    min_obs: int = MIN_OBS_FOR_VOL,
) -> tuple[dict[str, float], list[str]]:
    """Annualised expected returns per asset. Returns (mu, dropped_assets).

    Args:
        positions: dicts carrying at least `asset`, `direction` and `edge_score`.
            These are the L5 picks joined to their L1 candidate — `edge_score` lives
            on the candidate, never on the model's own pick dict (ADR-0053).
        returns:   daily returns, date index, one column per asset. The SAME frame
            `decompose_risk` uses, hoisted once by `finalise_book_analytics`.
        ic:        an `IcReading`, or a bare float for testing.

    An asset is dropped when it has no priceable history (no column, or fewer than
    `min_obs` sessions). Dropping is reported rather than silently zeroed, because a
    name the optimizer cannot see still carries real risk and the caller has to be
    able to say so (ADR-0023).

    **z is scaled, not demeaned.** The textbook cross-sectional z-score subtracts the
    mean, which is right when the standardised score also *chooses* the side. Here it
    does not: L5 has already chosen each name's direction and the optimizer pins it.
    Demeaning would give a below-average long a negative mu — pushing the optimizer to
    zero a position for the crime of being less attractive than its book-mates rather
    than because the signal dislikes it. Dividing by the cross-sectional dispersion
    alone standardises the magnitudes and leaves every sign as L5 set it.

    **Direction wins over the sign of the edge.** They agree by construction — L5 is
    constrained to a candidate set whose direction is `sign(edge_score)` — but if a
    fallback or a hand-edit ever breaks that, the position we are about to size is the
    fact, and the score is the commentary.
    """
    ic_value = ic.value if isinstance(ic, IcReading) else float(ic)
    if not positions or not math.isfinite(ic_value) or ic_value <= 0:
        return {}, []

    vols = annualised_vol(returns, trading_days=trading_days, min_obs=min_obs)

    signed_edges: dict[str, float] = {}
    dropped: list[str] = []
    for position in positions:
        asset = position.get("asset")
        if not asset:
            continue
        if asset not in vols:
            dropped.append(str(asset))
            continue
        edge = position.get("edge_score")
        try:
            magnitude = abs(float(edge)) if edge is not None else 0.0
        except (TypeError, ValueError):
            magnitude = 0.0
        sign = -1.0 if position.get("direction") == "short" else 1.0
        signed_edges[str(asset)] = sign * magnitude

    if not signed_edges:
        return {}, sorted(set(dropped))

    # Cross-sectional dispersion of the signed edges. With one name, or with every
    # name carrying an identical edge, there is no cross-section to standardise
    # against — fall back to the raw magnitudes so a single-name book still gets a
    # finite mu instead of a division by zero.
    values = list(signed_edges.values())
    if len(values) > 1:
        mean = sum(values) / len(values)
        variance = sum((v - mean) ** 2 for v in values) / (len(values) - 1)
        dispersion = math.sqrt(variance)
    else:
        dispersion = 0.0
    if not math.isfinite(dispersion) or dispersion <= 0:
        dispersion = 1.0

    mu = {
        asset: ic_value * vols[asset] * (edge / dispersion)
        for asset, edge in signed_edges.items()
    }
    return mu, sorted(set(dropped))


def equalise_signal_within_complexes(
    mu: dict[str, float],
    complex_map: dict[str, str],
    vols: dict[str, float],
) -> tuple[dict[str, float], dict]:
    """One idea, one SIGNAL — rescaled by each member's own vol.

    Kept out of `build_mu`, which is Grinold-Kahn and nothing else. This is a separate
    assertion about what a complex means, and composing them lets each be tested for
    what it claims.

    **Why the signal and not mu.** `mu = IC * sigma * z`. Members of a complex share the
    idea, so what they have in common is `z`, not `mu` — a levered member expressing the
    same view genuinely has a higher expected return, because it also carries the risk
    that earns it. Averaging `mu` directly asserts the opposite: it hands a low-vol
    member a high-vol member's return AT ITS OWN RISK, inventing a Sharpe no instrument
    has. [ADR-0116](../../docs/adrs/0116-the-optimizer-chooses-the-instrument-the-thesis-argues-the-idea.md)
    shipped that and a dry run measured the book jumping from 58.4% to 98.8% gross with
    three substitutes pinned to the single-name cap. Dividing sigma out, averaging, and
    multiplying it back leaves every member on an identical Sharpe, which is what "the
    same bet" actually means.

    **On its own this is not enough, and that is the point.** Equal Sharpe under a
    CAPITAL cap favours the highest-vol member, because that is the one delivering the
    most return per unit of capital. It is only neutral under the risk-denominated
    complex cap in `optimizer.OptimizerConstraints.max_complex_risk_mult`, where holding
    any member alone returns `IC * z * B` regardless of which member it is. The two
    are one change (ADR-0118).

    Assets absent from `complex_map`, or without a usable vol, are untouched and absent
    from the provenance — a name correlated with nothing is not part of an idea.
    """
    provenance: dict = {"applied": False, "complexes": [], "skipped": []}
    if not mu or not complex_map or not vols:
        return dict(mu), provenance

    groups: dict[str, list[str]] = {}
    for asset, complex_id in complex_map.items():
        if asset in mu:
            groups.setdefault(str(complex_id), []).append(str(asset))

    out = dict(mu)
    for complex_id, members in sorted(groups.items()):
        members = sorted(members)
        if len(members) < 2:
            continue
        usable = [
            a for a in members
            if vols.get(a) is not None and math.isfinite(vols[a]) and vols[a] > 0
        ]
        if len(usable) != len(members):
            provenance["skipped"].append({
                "id": complex_id, "members": members,
                "reason": "a member has no usable vol, so signals are not comparable",
            })
            continue
        signals = [mu[a] / vols[a] for a in members]
        # Same-side by construction (`_complex_map` namespaces ids by side, and
        # `correlation_clusters` excludes inverse pairs). If that ever breaks, averaging
        # across a hedge invents a signal neither side holds — refuse and say so.
        if len({s > 0 for s in signals if s != 0.0}) > 1:
            provenance["skipped"].append({
                "id": complex_id, "members": members,
                "reason": "members disagree in sign — not one idea, left untouched",
            })
            continue
        shared = sum(signals) / len(signals)
        for asset in members:
            out[asset] = shared * vols[asset]
        provenance["complexes"].append({
            "id": complex_id,
            "members": members,
            "basis": "signal (mu / sigma), rescaled by each member's own sigma",
            "shared_signal": shared,
            "mu_before": {a: mu[a] for a in members},
            "mu_after": {a: out[a] for a in members},
        })

    provenance["applied"] = bool(provenance["complexes"])
    return out, provenance
