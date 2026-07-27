"""
Bar 3: what matters for a specific name.

The property under test is not "the text is nice" — it is that **nothing here is
invented**. Every line must trace to a persisted value or a reviewed constant, because a
prompt section that invited the model to supply domain knowledge would be inviting the
fabrication the citation guardrail exists to catch.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.services.position_dossier import (  # noqa: E402
    MATERIAL_BETA,
    build_dossier,
    dossier_block,
    format_dossier,
)


def test_it_carries_the_reviewed_stress_response_a_factor_beta_cannot():
    """The scenario shocks are authored judgements — someone decided a supply shock hits
    XLE differently from ARKK. That is the domain content the prompt was missing."""
    d = build_dossier("SVXY")
    labels = dict((label, shock) for label, shock in d["scenario_sensitivities"])
    assert labels, "SVXY is named in several scenarios and they should reach the dossier"
    spike = next((v for k, v in labels.items() if "VIX Spike" in k), None)
    melt = next((v for k, v in labels.items() if "Melt-up" in k), None)
    assert spike is not None and spike < 0, "a vol spike destroys a short-vol position"
    assert melt is not None and melt > 0, "short-vol rips when vol collapses"


def test_the_inverse_warning_survives_into_the_prose():
    """Long SVXY is short VIX. A dossier that said "trades against VIX futures" without
    the flip would let a reader draw the sign backwards — the failure ADR-0097 names."""
    text = format_dossier(build_dossier("SVXY"))
    assert "INVERSE" in text
    assert "short the underlying" in text


def test_a_no_contract_reason_is_domain_content_not_an_apology():
    """`unmapped_reason` explains WHY miners are not the metal. That sentence is exactly
    the kind of sector knowledge bar 3 says the prompt lacks, and it already existed."""
    text = format_dossier(build_dossier("GDX"))
    assert "Miners are equity claims" in text
    assert "manufacture coverage" in text


def test_immaterial_loadings_are_omitted_rather_than_listed_at_noise_level():
    d = build_dossier("ARKK", {"ARKK": {"beta_mkt": 1.49, "beta_smb": 0.01, "r_squared": 0.77}})
    assert any("market" in s for s in d["factor_drivers"])
    assert not any("size" in s for s in d["factor_drivers"]), (
        f"a {0.01} loading is inside the regression's noise and must not be presented as a driver"
    )


def test_a_weak_fit_is_labelled_so_its_betas_are_not_read_as_drivers():
    d = build_dossier("GDX", {"GDX": {"beta_mkt": 0.55, "r_squared": 0.05}})
    assert d["factor_fit_weak"] is True
    assert "WEAK FIT" in format_dossier(d)


def test_a_not_computable_beta_is_absent_never_zero():
    """ADR-0066. `beta_umd` is null for every asset today; rendering it as 0.00 would
    assert no momentum exposure was found where none was measured."""
    d = build_dossier("QQQ", {"QQQ": {"beta_mkt": 1.17, "beta_umd": None, "r_squared": 0.94}})
    assert not any("momentum" in s for s in d["factor_drivers"])


def test_the_block_truncates_loudly_rather_than_silently():
    """Candidates arrive in decisiveness order, so a cap drops the least decisive — but a
    reader must be able to see that it happened and how many went."""
    assets = ["SPY", "QQQ", "GLD", "SLV", "TLT", "IEF"]
    text = dossier_block(assets, None, None, limit=2)
    assert "4 further candidates not described here" in text
    assert "GLD" in text and "IEF" in text, "the dropped names are still named"


def test_an_unknown_ticker_degrades_instead_of_raising():
    """`classify` raises on an unmapped ticker by design. This is prompt garnish and must
    never be the thing that costs a book."""
    d = build_dossier("NOTATICKER")
    assert d["sector"] is None
    assert "NOTATICKER" in format_dossier(d)


def test_empty_input_says_so():
    assert dossier_block([]) == "No candidates to describe."


def test_it_reaches_the_prompt():
    """ADR-0099: a capability with no caller is not implemented. The section must be in
    the template AND bound, or this module is decoration."""
    source = (
        Path(__file__).resolve().parents[2] / "backend" / "services" / "q1_agent.py"
    ).read_text(encoding="utf-8")
    assert "{position_dossiers}" in source, "the prompt template must carry the section"
    assert '"position_dossiers": dossier_block(' in source, "and it must be bound"
    assert "WHAT MOVES EACH NAME" in source
