"""Basis points reconcile against percentage points, for spreads only (ADR-0137).

The live failure, 2026-07-28: "Cited value 279.0 does not match source
'BAMLH0A0HYM2'=2.79". The model was right -- 279bp IS the high-yield spread --
and the prompt's own worked example asks for exactly that form while the verifier
demanded percentage points. Instruction and check contradicted each other.
"""
import pytest

from backend.services.q1_agent import (
    BPS_QUOTED_SOURCES,
    _citation_value_matches,
    bps_reconciles,
)


class TestTheLiveFailure:
    def test_279bps_reconciles_against_a_stored_2_79(self):
        assert _citation_value_matches(279.0, 2.79, "BAMLH0A0HYM2") is True

    def test_the_prompts_own_example_now_verifies(self):
        """The prompt shows {"source": "BAMLH0A0HYM2", "value": 380.0}. A model
        following it precisely must not produce an ungrounded citation."""
        assert _citation_value_matches(380.0, 3.80, "BAMLH0A0HYM2") is True

    def test_citing_the_source_unit_still_works(self):
        assert _citation_value_matches(2.79, 2.79, "BAMLH0A0HYM2") is True


class TestItIsNotABlanketHundredfoldTolerance:
    """The whole risk of this change: accepting x100 everywhere would swallow a
    genuine order-of-magnitude error on every series in the snapshot."""

    def test_a_yield_LEVEL_does_not_reconcile(self):
        # Nobody quotes the ten-year as "469bps". 4.69% is the level.
        assert _citation_value_matches(469.0, 4.69, "DGS10") is False
        assert _citation_value_matches(433.0, 4.33, "DGS2") is False

    def test_a_real_inflation_yield_does_not_reconcile(self):
        assert _citation_value_matches(243.0, 2.43, "DFII10") is False

    def test_a_breakeven_does_not_reconcile(self):
        assert _citation_value_matches(221.0, 2.21, "T10YIE") is False

    def test_an_unknown_source_does_not_reconcile(self):
        assert _citation_value_matches(1867.0, 18.67, "VIXCLS") is False
        assert _citation_value_matches(100.0, 1.0, None) is False

    def test_a_genuine_error_on_a_spread_still_fails(self):
        # 500 is not 279 in any unit.
        assert _citation_value_matches(500.0, 2.79, "BAMLH0A0HYM2") is False


class TestWhichSourcesAreDeclared:
    def test_only_spreads_are_listed(self):
        """A spread is a difference between two yields and is quoted in bps; a
        level is quoted in percent. That distinction is the rule."""
        assert "BAMLH0A0HYM2" in BPS_QUOTED_SOURCES   # HY OAS
        assert "T10Y2Y" in BPS_QUOTED_SOURCES         # curve slope
        for level in ("DGS10", "DGS2", "DFII10", "T10YIE", "VIXCLS", "SP500"):
            assert level not in BPS_QUOTED_SOURCES, f"{level} is a level, not a spread"

    def test_every_entry_states_why(self):
        """The map is a set of domain claims, so each must carry its reason -- a
        bare ticker list invites a careless addition."""
        for src, reason in BPS_QUOTED_SOURCES.items():
            assert reason.strip(), f"{src} has no stated reason"
            assert len(reason) > 20, f"{src}'s reason is too thin to argue with"

    def test_the_regime_classifier_alias_is_covered(self):
        # `hy_oas` is the label the regime layer uses for the same series.
        assert bps_reconciles(279.0, 2.79, "hy_oas") is True


class TestBoundaries:
    def test_a_non_numeric_source_value_is_not_a_match(self):
        assert _citation_value_matches(279.0, "n/a", "BAMLH0A0HYM2") is False

    def test_a_null_source_value_is_not_a_match(self):
        assert _citation_value_matches(279.0, None, "BAMLH0A0HYM2") is False

    def test_tolerance_still_applies_after_conversion(self):
        # 279 -> 2.79 exactly; 2% relative band around 2.79 is ~0.056.
        assert _citation_value_matches(280.0, 2.79, "BAMLH0A0HYM2") is True
        assert _citation_value_matches(400.0, 2.79, "BAMLH0A0HYM2") is False


class TestThePromptStatesTheConvention:
    def test_the_model_is_told_the_units(self):
        """The defect was an instruction contradicting a check. Fixing only the
        check leaves the model guessing."""
        from backend.services import q1_agent
        with open(q1_agent.__file__, encoding="utf-8") as fh:
            text = fh.read()
        assert "the FRED series are served in PERCENTAGE POINTS" in text
        assert "For yield\n  LEVELS cite the percent figure: 4.69, never 469" in text
