"""
What matters for THIS name — assembled from judgements the repo already encodes.

**Bar 3, from `docs/GOAL.md`:** *"A horizontal model has no domain knowledge... The
`reason_picks` prompt carries macro, regime, theme table, factor table, book metrics,
scenarios, risk, candidates and news. It carries **nothing about what matters for a
specific name or sector.**"*

That is true, and it has a cheaper fix than it looks. The model is not missing knowledge
because nobody has it — this repo is full of per-name domain judgement that simply never
reaches the prompt:

  * `scenario_analysis.SCENARIOS[].base_asset_shocks` — hand-authored, reviewed responses
    per name to six shocks. That ARKK is marked +25% in a melt-up and −25% in a VIX spike
    is a statement that it is a high-beta growth proxy, written by a person.
  * `cot_fetcher.UNMAPPED_REASON` — per-sector prose on why a sector has no futures
    contract. *"Miners are equity claims on a mining business — levered to the metal, but
    carrying operating cost, jurisdiction and financing risk the metal does not have."*
    That is domain knowledge, sitting in a module the prompt never reads.
  * `sanctions_exposure.EXPOSURE_MECHANISM` — the channel by which a jurisdiction bites.
  * `factor_exposures` — a beta vector IS a statement about what drives a name, and `R²`
    says how much of it the model explains.

So this assembles a dossier per candidate out of those, and changes nothing about what is
true. **Every line traces to a persisted value or a reviewed constant.** Nothing here is
generated, inferred, or asked of the model — which is the point: a prompt that invited the
model to supply domain knowledge would be inviting exactly the fabrication the citation
guardrail exists to catch (ADR-0012).

**What it deliberately does NOT do.** It does not tell the model what to conclude. A line
saying "ARKK is a high-beta growth proxy" would be an opinion this repo has not measured;
"+25% under melt-up, −25% under VIX spike, from the reviewed calibration" is the evidence
that supports that reading and leaves the reading to the reasoner.

See ADR-0114.
"""
from __future__ import annotations

from typing import Optional

from ..data.cot_fetcher import COT_CONTRACTS, unmapped_reason
from .book_metrics import GEO_MAP, SECTOR_MAP
from .scenario_analysis import SCENARIOS
from .trade_ranker import _ASSET_CLASS_MAP

# Factor labels a reader can act on. The raw column names say nothing to a model that has
# not read Fama-French; these are the standard readings and they are not opinions.
FACTOR_MEANING: dict[str, str] = {
    "beta_mkt": "market",
    "beta_smb": "size (small minus big)",
    "beta_hml": "value (high minus low book/price)",
    "beta_rmw": "profitability",
    "beta_cma": "investment conservatism",
    "beta_umd": "momentum",
}

# Below this the loading is not worth a line: it is inside the noise of a 252-day
# regression on a single name, and listing it would pad the prompt with non-findings.
MATERIAL_BETA = 0.25

# An R² this low means the factor model explains almost nothing about the name, and its
# betas should be read as decoration rather than as drivers. Same threshold the L5
# candidate screen already uses.
WEAK_FIT_R2 = 0.10


def _scenario_sensitivities(asset: str) -> list[tuple[str, float]]:
    """The reviewed per-name shocks, across every scenario that names this asset.

    These are authored constants (ADR-0074, ADR-0088), not measurements — which is
    precisely why they carry domain content a factor beta does not: someone decided that a
    supply shock hits XLE differently from how it hits ARKK.
    """
    out: list[tuple[str, float]] = []
    for scenario in SCENARIOS:
        shock = (getattr(scenario, "base_asset_shocks", None) or {}).get(asset)
        if isinstance(shock, (int, float)) and not isinstance(shock, bool):
            out.append((scenario.label, float(shock)))
    return out


def _factor_drivers(exposure: Optional[dict]) -> tuple[list[str], Optional[float]]:
    """The material factor loadings, largest first, with the fit that qualifies them."""
    if not exposure:
        return [], None
    r2 = exposure.get("r_squared")
    r2 = float(r2) if isinstance(r2, (int, float)) and not isinstance(r2, bool) else None

    loadings: list[tuple[str, float]] = []
    for column, meaning in FACTOR_MEANING.items():
        value = exposure.get(column)
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            continue          # NOT-COMPUTABLE stays absent, never 0.0 (ADR-0066)
        if abs(float(value)) >= MATERIAL_BETA:
            loadings.append((meaning, float(value)))
    loadings.sort(key=lambda t: -abs(t[1]))
    return [f"{meaning} {value:+.2f}" for meaning, value in loadings], r2


def build_dossier(
    asset: str,
    factor_exposures: Optional[dict[str, dict]] = None,
    sanctions_channels: Optional[dict[str, str]] = None,
) -> dict:
    """Everything the system already knows about what moves this name.

    Returns a dict rather than a string so the assembler can be tested on content and the
    prompt formatting can change without breaking the test.
    """
    exposure = (factor_exposures or {}).get(asset)
    drivers, r2 = _factor_drivers(exposure)
    scenarios = _scenario_sensitivities(asset)

    contract = COT_CONTRACTS.get(asset)
    if contract is not None:
        positioning = (
            f"trades against the {contract.name} futures contract"
            + (" (INVERSE: a long here is short the underlying)" if contract.inverse else "")
        )
    else:
        # The refusal itself is the domain content — see the module docstring.
        positioning = unmapped_reason(asset)

    return {
        "asset": asset,
        "sector": SECTOR_MAP.get(asset),
        "geography": GEO_MAP.get(asset),
        "asset_class": _ASSET_CLASS_MAP.get(asset),
        "factor_drivers": drivers,
        "factor_r_squared": r2,
        "factor_fit_weak": r2 is not None and r2 < WEAK_FIT_R2,
        "scenario_sensitivities": scenarios,
        "positioning_coverage": positioning,
        "sanctions_channel": (sanctions_channels or {}).get(asset),
    }


def format_dossier(dossier: dict) -> str:
    """One compact block per name. Terse on purpose — this repeats per candidate."""
    parts: list[str] = []
    identity = " / ".join(
        p for p in (dossier.get("sector"), dossier.get("geography"), dossier.get("asset_class"))
        if p
    )
    parts.append(f"{dossier['asset']} — {identity or 'unclassified'}")

    drivers = dossier.get("factor_drivers") or []
    if drivers:
        fit = dossier.get("factor_r_squared")
        suffix = f" (R² {fit:.2f}{'; WEAK FIT, treat as decoration' if dossier.get('factor_fit_weak') else ''})" if fit is not None else ""
        parts.append(f"    driven by: {', '.join(drivers)}{suffix}")
    elif dossier.get("factor_r_squared") is not None:
        parts.append(
            f"    no factor loading above {MATERIAL_BETA:.2f} — its moves are largely "
            f"idiosyncratic (R² {dossier['factor_r_squared']:.2f})"
        )

    scenarios = dossier.get("scenario_sensitivities") or []
    if scenarios:
        shown = ", ".join(
            f"{label} {shock:+.0%}" if abs(shock) >= 0.005 else f"{label} ~0%"
            for label, shock in scenarios
        )
        parts.append(f"    reviewed stress response: {shown}")

    parts.append(f"    external positioning: {dossier['positioning_coverage']}")

    if dossier.get("sanctions_channel"):
        parts.append(f"    sanctions channel: {dossier['sanctions_channel']}")

    return "\n".join(parts)


def dossier_block(
    assets: list[str],
    factor_exposures: Optional[dict[str, dict]] = None,
    sanctions_channels: Optional[dict[str, str]] = None,
    limit: int = 24,
) -> str:
    """The prompt section. Capped, because this repeats per name and the context is finite.

    `limit` truncates rather than sampling, and says so — the caller passes candidates in
    decisiveness order, so a truncation drops the least decisive names and a reader can
    see how many were dropped rather than wondering whether the list was complete.
    """
    unique: list[str] = []
    for asset in assets:
        if asset and asset not in unique:
            unique.append(asset)
    if not unique:
        return "No candidates to describe."

    shown, dropped = unique[:limit], unique[limit:]
    blocks = [
        format_dossier(build_dossier(a, factor_exposures, sanctions_channels)) for a in shown
    ]
    if dropped:
        blocks.append(
            f"({len(dropped)} further candidates not described here, least decisive first: "
            f"{', '.join(dropped)})"
        )
    return "\n".join(blocks)
