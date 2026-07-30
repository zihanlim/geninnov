"""Doc sync: the four doc surfaces must mention L2b after the
implementation lands. If a future change removes the layer, this
test fails and forces a deliberate decision rather than silent drift.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

ROOT = Path(__file__).resolve().parents[2]


def _read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def test_adrs_readme_indexes_0190():
    body = _read("docs/adrs/README.md")
    assert "0190" in body
    assert "credit-rates-exposures" in body


def test_adr_0190_file_exists_with_required_sections():
    body = _read("docs/adrs/0190-credit-rates-exposures-shadow-on-arrival.md")
    for heading in ("Context", "Decision", "Consequences"):
        assert heading in body, f"ADR-0190 missing required section: {heading}"


def test_architecture_mentions_l2b_in_all_four_surfaces():
    body = _read("ARCHITECTURE.md")
    assert "L2b" in body
    assert "credit_rates_exposures" in body
    assert "credit-rates" in body or "credit rates" in body
    # Feature checklist item
    assert "credit" in body.lower()


def test_progress_records_l2b_completion():
    body = _read("PROGRESS.md")
    assert "credit_rates_exposures" in body or "credit-rates exposures" in body or "L2b" in body


def test_claude_md_lists_credit_rates_exposures_module():
    body = _read("CLAUDE.md")
    assert "credit_rates_exposures" in body
    assert "backfill_macro" in body
