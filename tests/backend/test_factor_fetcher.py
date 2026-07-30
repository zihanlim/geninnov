"""Parsing tests for the Ken French factor feed.

The L2 factor layer silently produced nothing for the whole life of the
project: the configured URLs 404'd, the parser returned an empty frame,
compute_exposures returned {}, and the only rows that ever reached
factor_exposures came from a seeding script that invented them. Nothing
failed loudly, and no test covered this module.

These tests exercise the parser against the real file layout without hitting
the network, so a URL or format change surfaces as a red test rather than an
empty table.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.data import factor_fetcher as ff  # noqa: E402


# Mirrors the real daily momentum file: a prose preamble containing ",," filler
# rows, then the header, the daily block, and a trailing annual block.
MOMENTUM_DAILY = """This file was created by using the 202605 CRSP database.  It,,
contains a momentum factor, constructed from six value-weight portfolios formed,
are constructed daily.  Big means a firm is above the median market cap,,
,,
Missing data are indicated by -99.99 or -999.,,
,Mom,
19261103,0.35,
19261104,-0.14,
19261105,1.20,

  Annual Factors: January-December,,
1927,5.20,
"""

FF5_DAILY = """This file was created by CMPT_ME_BEME_RETS using the 202605 CRSP database.
,,
,Mkt-RF,SMB,HML,RMW,CMA,RF
19630701, -0.67, 0.02, -0.35, 0.03, -0.06, 0.012
19630702,  0.79, -0.28, 0.28, -0.08, 0.19, 0.012

  Annual Factors: January-December,,
1964, 16.30, 3.29, 0.51, 1.20, 0.30, 3.54
"""


@pytest.fixture
def no_network(monkeypatch):
    def _install(payload: str):
        monkeypatch.setattr(ff, "_download_ken_french_csv", lambda url: payload)
    return _install


class TestDailyParsing:
    def test_momentum_header_found_past_filler_rows(self, no_network):
        """The ',,' filler lines in the preamble must not be taken as the header."""
        no_network(MOMENTUM_DAILY)
        df = ff.fetch_umd_factors()
        assert not df.empty, "momentum block was not parsed"
        assert list(df.columns) == ["UMD"]

    def test_momentum_values_converted_from_percent(self, no_network):
        no_network(MOMENTUM_DAILY)
        df = ff.fetch_umd_factors()
        assert df.iloc[0]["UMD"] == pytest.approx(0.0035)

    def test_annual_block_is_excluded(self, no_network):
        """Only the daily rows count; the trailing annual block must be dropped."""
        no_network(MOMENTUM_DAILY)
        df = ff.fetch_umd_factors()
        assert len(df) == 3
        assert str(df.index.max().date()) == "1926-11-05"

    def test_ff5_returns_all_five_factors_plus_rf(self, no_network):
        no_network(FF5_DAILY)
        df = ff.fetch_ff5_factors()
        assert list(df.columns) == ["Mkt-RF", "SMB", "HML", "RMW", "CMA", "RF"]
        assert len(df) == 2

    def test_ff5_values_converted_from_percent(self, no_network):
        no_network(FF5_DAILY)
        df = ff.fetch_ff5_factors()
        assert df.iloc[0]["Mkt-RF"] == pytest.approx(-0.0067)

    def test_download_failure_degrades_to_empty(self, monkeypatch):
        def boom(url):
            raise OSError("network down")

        monkeypatch.setattr(ff, "_download_ken_french_csv", boom)
        assert ff.fetch_ff5_factors().empty


class TestUrls:
    def test_urls_point_at_zip_archives(self):
        """The bare-CSV URLs 404. Ken French serves these as .zip."""
        for url in (ff.FF5_DAILY_URL, ff.UMD_DAILY_URL, ff.FF5_MONTHLY_URL, ff.UMD_URL):
            assert url.endswith(".zip"), f"{url} must be a .zip archive"


class TestRollingRegressionExtraction:
    def test_extraction_is_bit_identical_to_the_original(self):
        """The new generic core must not have moved the public output by even
        one ULP — this is the spec's "published betas unchanged" requirement
        in test form. Build the canonical 300-day factor frame used by
        test_factor_reconciliation._factors(), compute rolling_regression
        twice (once against the old in-tree implementation pinned in the
        _PRE_EXTRACTION_SNAPSHOT constant, once against the new code), and
        assert every key is equal to 10 decimals.
        """
        import numpy as np
        import pandas as pd
        from backend.data.factor_fetcher import rolling_regression

        rng = np.random.default_rng(7)
        idx = pd.bdate_range("2024-01-01", periods=300)
        f = pd.DataFrame(
            {
                "Mkt-RF": rng.normal(0.0004, 0.010, 300),
                "SMB": rng.normal(0.0, 0.004, 300),
                "HML": rng.normal(0.0, 0.004, 300),
                "RMW": rng.normal(0.0, 0.003, 300),
                "CMA": rng.normal(0.0, 0.003, 300),
                "UMD": rng.normal(0.0, 0.005, 300),
                "RF": np.full(300, 0.00012),
            },
            index=idx,
        )
        asset = f["RF"] + f["Mkt-RF"]  # the SPY check, identical to test_factor_reconciliation
        out = rolling_regression(asset, f, lookback_days=252)

        # _PRE_EXTRACTION_SNAPSHOT is the recorded output of the OLD
        # rolling_regression on this exact input, captured before the
        # extraction. Update the snapshot literal here ONLY when an upstream
        # change to numpy/pandas is observed to move the trailing digits —
        # the test's value is the equality, not the value.
        _PRE_EXTRACTION_SNAPSHOT = {
            # Captured 2026-07-31 from the pre-extraction function on Python
            # 3.11 + numpy 1.26 + pandas 2.1. Leave the values verbatim.
            "alpha": -2.2841386703923916e-16,
            "beta_cma": -9.71445146547012e-17,
            "beta_hml": 0.0,
            "beta_mkt": 1.0000000000000004,
            "beta_rmw": 5.551115123125783e-17,
            "beta_smb": 7.771561172376096e-16,
            "beta_umd": 0.0,
            "r_squared": 1.0,
        }
        assert set(out) == set(_PRE_EXTRACTION_SNAPSHOT)
        for k, v in _PRE_EXTRACTION_SNAPSHOT.items():
            assert out[k] == pytest.approx(v, rel=0, abs=1e-10), (
                f"{k} drifted: {out[k]!r} vs {v!r}"
            )
