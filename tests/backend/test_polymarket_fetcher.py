"""Polymarket categorisation must match whole words, not substrings.

'eth' (Ethereum) matched inside 'Ethiopia', so 'Next Prime Minister of Ethiopia?'
was filed under Crypto and — because any categorised event clears the `Other`
filter in fetch_macro_markets — surfaced on the homepage as a macro market the
book supposedly cited. These pin the whole-word behaviour so it cannot regress.
"""
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from backend.data.polymarket_fetcher import _categorize


def test_eth_does_not_match_inside_ethiopia():
    # The exact 2026-07-25 offender: highest-volume event, wrongly surfaced.
    assert _categorize("Next Prime Minister of Ethiopia?") == "Other"


def test_eth_as_a_whole_word_still_matches_crypto():
    assert _categorize("What price will ETH hit in 2026?") == "Crypto"


def test_legitimate_macro_markets_still_categorise():
    assert _categorize("Fed decision in July?") == "Fed"
    assert _categorize("How many Fed rate cuts in 2026?") == "Fed"
    assert _categorize("What will WTI Crude Oil hit in July 2026?") == "Oil"
    assert _categorize("What price will Bitcoin hit in 2026?") == "Bitcoin"
    assert _categorize("Will China invade Taiwan by end of 2026?") == "Geopolitics"


def test_plural_rate_cuts_matches_rates_family():
    # 'rate cut' must still match 'rate cuts' — the plural is the common phrasing.
    assert _categorize("How many rate cuts before 2027?") == "Rates"


def test_unrelated_event_is_other():
    assert _categorize("Who wins Best Picture at the Oscars?") == "Other"
