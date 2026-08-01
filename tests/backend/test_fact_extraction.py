"""Tests for the fact_extraction service (ADR-0222 Tier 1).

The service re-shapes data the pipeline already produces (macro_indicators,
regime_classifications, themes) into the structured_facts table so the L5
can cite it. These tests assert on the SHAPE of the rows each pass
produces, not on a database round-trip — the persistence test is the
loader / auto_derive_facts script in production.

The two interesting cases per pass are:
  1. A real input row produces a real output row (the happy path)
  2. An empty / missing input produces no row, never a zero (ADR-0098)

NaN and NaN-like values are NOT citable. The function returns None for
these, and the upsert step is skipped — same discipline as the L5 cite
path: absence is honest, a zero is fabrication.
"""
import sys
from datetime import date

# Only the project root on sys.path — NOT backend/services/.
# With project-root in sys.path, fact_extraction loads as
# backend.services.fact_extraction (proper package), so its
# `from backend.services import news_fact_extractor` resolves to the
# SAME sys.modules key that the test's `import news_fact_extractor`
# uses. Patching news_fact_extractor._TEST_HOOK in the test then
# reaches _derive_news_facts correctly.
sys.path.insert(0, ".")

from backend.services.fact_extraction import _safe_num  # noqa: E402


# ── _safe_num: the one function with real edge-case behavior ──────────

class TestSafeNum:
    """Every value that isn't a real number must round-trip to None.
    The function is the gate; a single 0 leaking through here would
    become a citable row, which the L5 would happily cite as a
    'measured zero'."""

    def test_none(self):
        assert _safe_num(None) is None

    def test_nan_string(self):
        assert _safe_num("nan") is None

    def test_nan_float(self):
        assert _safe_num(float("nan")) is None

    def test_positive_infinity(self):
        assert _safe_num(float("inf")) is None

    def test_negative_infinity(self):
        assert _safe_num(float("-inf")) is None

    def test_integer(self):
        assert _safe_num(42) == 42.0

    def test_float(self):
        assert _safe_num(3.14) == 3.14

    def test_numeric_string(self):
        """Pandas leaves '4.32' as a string in some frames; the
        macro_indicators snapshot sometimes has these."""
        assert _safe_num("4.32") == 4.32

    def test_non_numeric_string(self):
        """'N/A' and the like must NOT slip through as a 0."""
        assert _safe_num("N/A") is None
        assert _safe_num("") is None
        assert _safe_num("—") is None

    def test_zero_is_zero(self):
        """A real zero IS citable (e.g. socgen_flip_active=0 is a
        measured state). The function must not filter it."""
        assert _safe_num(0) == 0.0
        assert _safe_num(0.0) == 0.0

    def test_negative(self):
        """Negative numbers (correlations, ERP) are valid."""
        assert _safe_num(-0.793) == -0.793

    def test_list_or_dict_returns_none(self):
        """A pandas cell that came back as a Series/dict (rare but
        happens with .apply) must not crash the row, and must not
        coerce to 0."""
        assert _safe_num({"value": 4.32}) is None


# ── Shape tests for the four derivation passes ─────────────────────────
#
# These don't run a full pipeline (no Supabase). They construct
# minimal fake inputs to assert the per-pass shape, so a future
# schema change to macro_indicators / regime_classifications /
# themes is caught here, not in production.

class _FakeSupabase:
    """Minimal Supabase client stand-in. Each `table(name)` call gets
    its own chained query; the query's terminal `.execute()` returns
    the configured rows. Tests construct one of these, point it at a
    table, and pass the wrapper to the function under test."""

    def __init__(self, by_table: dict[str, list[dict]] | None = None):
        self._by_table = by_table or {}

    def table(self, name: str):
        outer = self

        class _Q:
            def __init__(self):
                self._chain: list = []
                self._rows = list(outer._by_table.get(name, []))

            def select(self, *a, **kw):
                self._chain.append(("select", a, kw))
                return self

            def lte(self, col, val):
                self._chain.append(("lte", (col, val), {}))
                self._rows = [r for r in self._rows if str(r.get(col, "")) <= str(val)]
                return self

            def gte(self, col, val):
                self._chain.append(("gte", (col, val), {}))
                self._rows = [r for r in self._rows if str(r.get(col, "")) >= str(val)]
                return self

            def in_(self, col, vals):
                self._chain.append(("in_", (col, list(vals)), {}))
                vals_set = set(vals)
                self._rows = [r for r in self._rows if r.get(col) in vals_set]
                return self

            def order(self, col, desc=False, **_):
                self._chain.append(("order", (col, desc), {}))
                if col in self._rows[0] if self._rows else False:
                    self._rows.sort(key=lambda r: r.get(col, ""), reverse=desc)
                return self

            def limit(self, n):
                self._chain.append(("limit", (n,), {}))
                self._rows = self._rows[:n]
                return self

            def execute(self):
                return type("R", (), {"data": self._rows})()

        return _Q()


class TestDeriveMacroIndicatorsShape:
    """_derive_macro_indicators re-shapes today's macro snapshot.
    The shape contract:
      - one row per (series_id, latest fetch_date)
      - entity = 'macro:<series_id>'
      - metric = 'value'
      - confidence = 'medium'
      - category = 'auto_macro'
      - source = 'auto-derived: macro_indicators'
    """

    def test_empty_macro_indicators_produces_no_rows(self):
        """A read failure is logged but produce NO rows — never
        a fabricated zero."""
        import backend.services.fact_extraction as fact_extraction

        supabase = _FakeSupabase({"macro_indicators": []})
        rows = fact_extraction._derive_macro_indicators(
            supabase, as_of=date(2026, 7, 31)
        )
        assert rows == []

    def test_one_row_per_series_id(self):
        """A snapshot with two FRED series becomes two auto_macro rows.
        The first occurrence per series wins (the latest fetch_date)."""
        import backend.services.fact_extraction as fact_extraction

        supabase = _FakeSupabase({
            "macro_indicators": [
                {"series_id": "DGS10", "value": 4.32, "unit": "pct",
                 "fetch_date": "2026-07-30"},
                {"series_id": "^VIX", "value": 15.99, "unit": "index",
                 "fetch_date": "2026-07-31"},
            ]
        })
        rows = fact_extraction._derive_macro_indicators(
            supabase, as_of=date(2026, 7, 31)
        )
        assert len(rows) == 2
        by_entity = {r["entity"]: r for r in rows}
        assert by_entity["macro:DGS10"]["value"] == 4.32
        assert by_entity["macro:DGS10"]["unit"] == "pct"
        assert by_entity["macro:DGS10"]["confidence"] == "medium"
        assert by_entity["macro:DGS10"]["category"] == "auto_macro"
        assert by_entity["macro:^VIX"]["value"] == 15.99


class TestDeriveComputableMacroShape:
    """_derive_computable_macro mirrors the regime row's JSONB.
    Only `status == "measured"` produces a row — `unknown` and
    `absent` are deliberately NOT written (the L5 cites absence
    as absence, ADR-0098)."""

    def test_unknown_metric_produces_no_row(self):
        import backend.services.fact_extraction as fact_extraction

        supabase = _FakeSupabase({
            "regime_classifications": [{
                "run_date": "2026-07-31",
                "computable_macro": {
                    "erp": {"status": "unknown", "reason": "missing_input"},
                    "equity_bond_corr": {
                        "status": "measured", "value": -0.27,
                        "socgen_flip_active": 1, "unit": "correlation",
                    },
                },
            }]
        })
        rows = fact_extraction._derive_computable_macro(
            supabase, as_of=date(2026, 7, 31)
        )
        # Only equity_bond_corr should produce a row, NOT erp.
        assert len(rows) == 1
        assert "equity_bond_corr" in rows[0]["entity"]
        assert rows[0]["confidence"] == "medium"
        assert rows[0]["category"] == "auto_computable"
        assert rows[0]["value"] == -0.27


class TestDeriveRegimeRowShape:
    """_derive_regime_row re-shapes the regime row's scalar
    numeric columns. Categorical columns (cycle, sentiment,
    fed_posture) are NOT written — the L5 cites those directly
    from regime_classifications, not via structured_facts."""

    def test_only_numeric_columns_become_rows(self):
        import backend.services.fact_extraction as fact_extraction

        supabase = _FakeSupabase({
            "regime_classifications": [{
                "run_date": "2026-07-31",
                "cycle": "late",            # categorical — skip
                "sentiment": "neutral",     # categorical — skip
                "fed_posture": "neutral",   # categorical — skip
                "yield_curve_slope": -0.42,
                "hy_oas": 3.8,
                "vix_level": 15.99,
                "real_rate": 2.10,
                "spx_breadth": 55.0,
            }]
        })
        rows = fact_extraction._derive_regime_row(
            supabase, as_of=date(2026, 7, 31)
        )
        # 5 numeric cols, 3 categorical — only numeric become rows
        assert len(rows) == 5
        entities = {r["entity"] for r in rows}
        assert "regime:cycle" not in entities
        assert "regime:sentiment" not in entities
        assert "regime:fed_posture" not in entities
        assert "regime:vix_level" in entities
        assert "regime:yield_curve_slope" in entities


class TestDeriveThemeSignalsShape:
    """_derive_theme_signals writes one row per (theme, sub_score).
    The (entity, metric) pair becomes the cite target the L5 types
    and the guardrail verifies."""

    def test_one_row_per_score_column(self):
        import backend.services.fact_extraction as fact_extraction

        supabase = _FakeSupabase({
            "themes": [{
                "id": "abc-123",
                "name": "AI Capex",
                "hype_score": 0.65,
                "volume_score": 0.96,
                "sentiment_score": 0.53,
                "corr_score": 0.48,
                "momentum_score": 0.56,
                "updated_at": "2026-07-31T22:00:00+00:00",
            }]
        })
        rows = fact_extraction._derive_theme_signals(
            supabase, as_of=date(2026, 7, 31)
        )
        assert len(rows) == 5
        assert {r["metric"] for r in rows} == {
            "hype_score", "volume_score", "sentiment_score",
            "corr_score", "momentum_score",
        }
        for r in rows:
            assert r["entity"] == "theme:abc-123"
            assert r["confidence"] == "medium"
            assert r["category"] == "auto_themes"
            assert r["as_of"] == "2026-07-31"  # date part only
        # Hype_score carries the actual value, others are float-passthrough
        hype = next(r for r in rows if r["metric"] == "hype_score")
        assert hype["value"] == 0.65


class TestDeriveIndustryAggregatesShape:
    """_derive_industry_aggregates computes sum/mean/min/max over the
    hyperscaler set. The auto-derive is a transform on top of the
    curated/auto company rows — same input, deterministic output.

    Two contracts:
      1. If a metric has zero rows in the input, the function produces
         zero output for that metric (never a zero-row of "sum=0").
      2. Each aggregate cites its source as 'auto-derived: structured_facts
         [ai_capex]' so a reader knows it's a derived reading, not a
         curated one."""

    def test_zero_inputs_produces_zero_rows(self):
        """No curated rows for any of the 5 hyperscalers → no output."""
        import backend.services.fact_extraction as fact_extraction

        supabase = _FakeSupabase({"structured_facts": []})
        rows = fact_extraction._derive_industry_aggregates(
            supabase, as_of=date(2026, 7, 31)
        )
        assert rows == []

    def test_four_aggregates_per_metric(self):
        """For each metric with inputs, write sum/mean/min/max."""
        import backend.services.fact_extraction as fact_extraction

        supabase = _FakeSupabase({
            "structured_facts": [
                {"entity": "MSFT", "metric": "capex_fy26_bn",
                 "value": 80, "unit": "USD_bn", "as_of": "2026-06-30"},
                {"entity": "META", "metric": "capex_fy26_bn",
                 "value": 64, "unit": "USD_bn", "as_of": "2026-06-30"},
                {"entity": "GOOGL", "metric": "capex_fy26_bn",
                 "value": 75, "unit": "USD_bn", "as_of": "2026-06-30"},
                {"entity": "AMZN", "metric": "capex_fy26_bn",
                 "value": 105, "unit": "USD_bn", "as_of": "2026-06-30"},
                {"entity": "ORCL", "metric": "capex_fy26_bn",
                 "value": 25, "unit": "USD_bn", "as_of": "2026-06-30"},
            ]
        })
        rows = fact_extraction._derive_industry_aggregates(
            supabase, as_of=date(2026, 7, 31)
        )
        by_metric = {r["metric"]: r for r in rows}
        assert "capex_fy26_bn_sum" in by_metric
        assert "capex_fy26_bn_mean" in by_metric
        assert "capex_fy26_bn_min" in by_metric
        assert "capex_fy26_bn_max" in by_metric
        assert by_metric["capex_fy26_bn_sum"]["value"] == 349.0
        assert by_metric["capex_fy26_bn_mean"]["value"] == 69.8
        assert by_metric["capex_fy26_bn_min"]["value"] == 25.0
        assert by_metric["capex_fy26_bn_max"]["value"] == 105.0
        for r in rows:
            assert r["category"] == "auto_industry"
            assert r["confidence"] == "medium"
            assert r["entity"] == "industry:hyperscaler:top5_hyperscaler"

    def test_skips_metric_with_no_inputs(self):
        """If only 1 of 3 metrics has data, only that metric gets rows.
        The other two produce nothing — never a fabricated zero."""
        import backend.services.fact_extraction as fact_extraction

        supabase = _FakeSupabase({
            "structured_facts": [
                {"entity": "MSFT", "metric": "capex_fy26_bn",
                 "value": 80, "unit": "USD_bn", "as_of": "2026-06-30"},
            ]
        })
        rows = fact_extraction._derive_industry_aggregates(
            supabase, as_of=date(2026, 7, 31)
        )
        # Only capex_fy26_bn (4 rows: sum/mean/min/max). The other
        # two metrics have zero inputs and produce zero rows.
        assert all("capex_fy26_bn" in r["metric"] for r in rows)
        assert len(rows) == 4

    def test_picks_latest_per_entity_metric(self):
        """A trajectory of MSFT capex rows: only the most recent
        as_of counts toward the aggregate. Same discipline as the
        L5 cite path."""
        import backend.services.fact_extraction as fact_extraction

        supabase = _FakeSupabase({
            "structured_facts": [
                {"entity": "MSFT", "metric": "capex_fy26_bn",
                 "value": 70, "unit": "USD_bn", "as_of": "2025-12-31"},
                {"entity": "MSFT", "metric": "capex_fy26_bn",
                 "value": 80, "unit": "USD_bn", "as_of": "2026-06-30"},
                {"entity": "META", "metric": "capex_fy26_bn",
                 "value": 64, "unit": "USD_bn", "as_of": "2026-06-30"},
            ]
        })
        rows = fact_extraction._derive_industry_aggregates(
            supabase, as_of=date(2026, 7, 31)
        )
        # The stale MSFT=70 row is superseded; sum = 80 + 64 = 144.
        sum_row = next(r for r in rows if r["metric"] == "capex_fy26_bn_sum")
        assert sum_row["value"] == 144.0


class TestDeriveNewsFacts:
    """_derive_news_facts is OFF by default. The env var
    ANDROMEDA_NEWS_EXTRACTION=1 must be set for the pass to run.
    When off, it returns [] without calling Gemini. This is the
    safety discipline — a hallucinated value would land in the
    fact table and the L5 would cite it. The first production
    run should be small and audited.

    The tests cover:
      1. Off-by-default (the safety switch)
      2. The opt-in produces rows from the LLM extractor
      3. Dedupe by (source, headline) — the same article on two
         themes produces one row, not two
    """

    def test_off_by_default(self, monkeypatch):
        import backend.services.fact_extraction as fact_extraction
        monkeypatch.delenv("ANDROMEDA_NEWS_EXTRACTION", raising=False)
        # Even with a populated theme_news, the pass returns [].
        supabase = _FakeSupabase({
            "theme_news": [
                {"headline": "NVDA drops $600B", "source": "Yahoo",
                 "theme_id": "t1", "run_date": "2026-07-31",
                 "published_date": "2026-07-31"},
            ]
        })
        rows = fact_extraction._derive_news_facts(
            supabase, as_of=date(2026, 7, 31)
        )
        assert rows == []

    def test_opt_in_produces_low_confidence_rows(self, monkeypatch):
        """With the env var set, the pass calls the extractor
        and writes rows with confidence='low', category='auto_news'.
        The fake extractor returns a known good claim."""
        import backend.services.fact_extraction as fact_extraction
        import backend.services.news_fact_extractor as news_fact_extractor

        monkeypatch.setenv("ANDROMEDA_NEWS_EXTRACTION", "1")
        monkeypatch.setattr(
            news_fact_extractor, "GEMINI_API_KEY", "test-key"
        )
        # Inject a deterministic extractor response. The function
        # under test calls the LLM; we substitute a hook that
        # returns one valid claim.
        def _hook(title, url, body):
            return [
                {"entity": "NVDA", "metric": "mkt_cap_drop_bn",
                 "value": 600, "unit": "USD_bn", "as_of": "2025-01-27"},
            ]
        monkeypatch.setattr(news_fact_extractor, "_TEST_HOOK", _hook)

        supabase = _FakeSupabase({
            "theme_news": [
                {"headline": "NVDA plunges on DeepSeek V3",
                 "source": "Yahoo", "theme_id": "t1",
                 "run_date": "2026-07-31",
                 "published_date": "2026-07-31"},
            ]
        })
        rows = fact_extraction._derive_news_facts(
            supabase, as_of=date(2026, 7, 31)
        )
        assert len(rows) == 1
        r = rows[0]
        assert r["entity"] == "NVDA"
        assert r["metric"] == "mkt_cap_drop_bn"
        assert r["value"] == 600
        assert r["confidence"] == "low"
        assert r["category"] == "auto_news"
        assert "Yahoo" in r["source"]

    def test_dedupes_articles_across_themes(self, monkeypatch):
        """The same (source, headline) on two themes → one
        extraction, one row. The dedupe is on the (source,
        headline) pair, not on the theme_id."""
        import backend.services.fact_extraction as fact_extraction
        import backend.services.news_fact_extractor as news_fact_extractor

        monkeypatch.setenv("ANDROMEDA_NEWS_EXTRACTION", "1")
        monkeypatch.setattr(
            news_fact_extractor, "GEMINI_API_KEY", "test-key"
        )
        call_count = {"n": 0}

        def _hook(title, url, body):
            call_count["n"] += 1
            return [{
                "entity": "MSFT", "metric": "capex_fy26_bn",
                "value": 80, "unit": "USD_bn", "as_of": "2026",
            }]
        monkeypatch.setattr(news_fact_extractor, "_TEST_HOOK", _hook)

        supabase = _FakeSupabase({
            "theme_news": [
                {"headline": "MSFT capex 80bn", "source": "Yahoo",
                 "theme_id": "t1", "run_date": "2026-07-31"},
                {"headline": "MSFT capex 80bn", "source": "Yahoo",
                 "theme_id": "t2", "run_date": "2026-07-31"},
                {"headline": "MSFT capex 80bn", "source": "Yahoo",
                 "theme_id": "t3", "run_date": "2026-07-31"},
            ]
        })
        rows = fact_extraction._derive_news_facts(
            supabase, as_of=date(2026, 7, 31)
        )
        # Three rows in theme_news for the same article — but only
        # ONE extraction (call_count==1) and ONE fact row, not three.
        assert call_count["n"] == 1
        assert len(rows) == 1

    def test_validator_drops_bad_extractions(self, monkeypatch):
        """If the LLM returns a row with a non-permitted unit
        or missing entity, the row is dropped silently. A bad
        claim must not poison the table."""
        import backend.services.fact_extraction as fact_extraction
        import backend.services.news_fact_extractor as news_fact_extractor

        monkeypatch.setenv("ANDROMEDA_NEWS_EXTRACTION", "1")
        monkeypatch.setattr(
            news_fact_extractor, "GEMINI_API_KEY", "test-key"
        )
        def _hook(title, url, body):
            return [
                # Good
                {"entity": "NVDA", "metric": "drop",
                 "value": 600, "unit": "USD_bn", "as_of": "2025-01-27"},
                # Bad unit — dropped by validator
                {"entity": "X", "metric": "weight",
                 "value": 100, "unit": "kg", "as_of": "2026"},
                # Missing entity — dropped
                {"metric": "x", "value": 1,
                 "unit": "USD_bn", "as_of": "2026"},
            ]
        monkeypatch.setattr(news_fact_extractor, "_TEST_HOOK", _hook)

        supabase = _FakeSupabase({
            "theme_news": [
                {"headline": "test", "source": "Y",
                 "theme_id": "t1", "run_date": "2026-07-31"},
            ]
        })
        rows = fact_extraction._derive_news_facts(
            supabase, as_of=date(2026, 7, 31)
        )
        assert len(rows) == 1
        assert rows[0]["entity"] == "NVDA"
