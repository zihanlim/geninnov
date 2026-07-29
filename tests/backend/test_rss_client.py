"""RSS is worth having for exactly one property: its dates are real.

Everything here defends that property or the failure-visibility rule ADR-0156
established. Parsing is tested against literal feed XML rather than the network, so
these run in CI.
"""
from __future__ import annotations

import urllib.error

import pytest

from backend.data.rss_client import (
    FEEDS,
    RSS_SOURCE,
    fetch_market_rss,
    parse_feed,
)

RSS_XML = b"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>Example Business</title>
    <item>
      <title>Fed holds rates steady</title>
      <link>https://example.com/fed</link>
      <pubDate>Wed, 29 Jul 2026 04:12:00 GMT</pubDate>
    </item>
    <item>
      <title><![CDATA[Oil climbs on <b>supply</b> fears]]></title>
      <link>https://example.com/oil</link>
      <pubDate>Tue, 28 Jul 2026 21:23:00 +0000</pubDate>
    </item>
    <item>
      <title>Undated filler</title>
      <link>https://example.com/undated</link>
    </item>
  </channel>
</rss>
"""

ATOM_XML = b"""<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Treasury yields slip</title>
    <link href="https://example.com/atom-yields"/>
    <published>2026-07-29T01:50:00Z</published>
  </entry>
</feed>
"""


class TestTheFalsyElementRegression:
    """An ElementTree Element with no subelements is FALSY.

    `node.find("title") or node.find("atom:title")` therefore discards every title
    in every feed — a <title> has text and no children. The first live run of this
    module returned **0 items from 14 healthy feeds**, with no error anywhere: the
    exact silent-emptiness shape ADR-0156 is about, reproduced inside the fix for it.
    """

    def test_a_childless_title_is_parsed(self):
        items = parse_feed(RSS_XML, "example")
        assert [i["headline"] for i in items][:1] == ["Fed holds rates steady"]

    def test_a_healthy_feed_never_yields_zero_items(self):
        assert len(parse_feed(RSS_XML, "example")) > 0
        assert len(parse_feed(ATOM_XML, "example")) > 0


class TestDatesAreTheWholePoint:
    def test_every_returned_item_carries_a_date(self):
        for xml in (RSS_XML, ATOM_XML):
            items = parse_feed(xml, "example")
            assert items
            assert all(i["date"] for i in items)

    def test_an_undated_item_is_DROPPED_not_stamped_with_today(self):
        """The failure mode ADR-0066 names: an unknown date must not become 'today'.

        Keeping the item would spend this provider's one advantage for one extra
        headline, and would put an unknown-age document into a daily bucket.
        """
        heads = [i["headline"] for i in parse_feed(RSS_XML, "example")]
        assert "Undated filler" not in heads

    def test_rfc822_and_iso8601_both_parse(self):
        assert parse_feed(RSS_XML, "e")[0]["date"] == "2026-07-29"
        assert parse_feed(ATOM_XML, "e")[0]["date"] == "2026-07-29"

    def test_offset_form_parses(self):
        """+0000 and GMT are both live in the configured feeds."""
        assert parse_feed(RSS_XML, "e")[1]["date"] == "2026-07-28"


class TestParsing:
    def test_cdata_and_inline_markup_are_stripped(self):
        assert parse_feed(RSS_XML, "e")[1]["headline"] == "Oil climbs on supply fears"

    def test_links_survive_both_dialects(self):
        assert parse_feed(RSS_XML, "e")[0]["url"] == "https://example.com/fed"
        assert parse_feed(ATOM_XML, "e")[0]["url"] == "https://example.com/atom-yields"

    def test_items_are_source_tagged(self):
        """A corpus is defined by naming its providers, which needs the tag."""
        assert all(i["source"] == RSS_SOURCE for i in parse_feed(RSS_XML, "e"))

    def test_feed_name_travels(self):
        assert parse_feed(RSS_XML, "cnbc-top")[0]["feed"] == "cnbc-top"


class TestADeadFeedIsReportedNotAbsorbed:
    """Fourteen feeds silently becoming three is ADR-0156 with more steps."""

    def test_one_dead_feed_does_not_lose_the_others(self, monkeypatch):
        def fake(req, timeout=None):
            if "dead" in req.full_url:
                raise urllib.error.URLError("no route to host")
            return _Resp(RSS_XML)

        monkeypatch.setattr("backend.data.rss_client.urllib.request.urlopen", fake)
        r = fetch_market_rss({"good": "https://ok/feed", "bad": "https://dead/feed"})
        assert r.feeds_ok == 1
        assert "bad" in r.failures
        assert len(r.items) == 2  # the undated one is dropped
        assert not r.all_failed

    def test_total_failure_is_distinguishable_from_a_quiet_day(self, monkeypatch):
        """`items == []` alone cannot tell those apart — that merge is the bug."""
        def fake(req, timeout=None):
            raise urllib.error.URLError("down")

        monkeypatch.setattr("backend.data.rss_client.urllib.request.urlopen", fake)
        r = fetch_market_rss({"a": "https://x/feed", "b": "https://y/feed"})
        assert r.items == []
        assert r.all_failed
        assert len(r.failures) == 2

    def test_a_quiet_feed_is_not_a_failure(self, monkeypatch):
        empty = b'<?xml version="1.0"?><rss version="2.0"><channel/></rss>'
        monkeypatch.setattr(
            "backend.data.rss_client.urllib.request.urlopen",
            lambda req, timeout=None: _Resp(empty),
        )
        r = fetch_market_rss({"a": "https://x/feed"})
        assert r.items == []
        assert r.failures == {}
        assert not r.all_failed

    def test_malformed_xml_is_a_failure_not_a_crash(self, monkeypatch):
        monkeypatch.setattr(
            "backend.data.rss_client.urllib.request.urlopen",
            lambda req, timeout=None: _Resp(b"<rss><channel><item>"),
        )
        r = fetch_market_rss({"a": "https://x/feed"})
        assert r.all_failed and "a" in r.failures


class TestDedupe:
    def test_the_same_headline_across_two_feeds_is_kept_once(self, monkeypatch):
        monkeypatch.setattr(
            "backend.data.rss_client.urllib.request.urlopen",
            lambda req, timeout=None: _Resp(RSS_XML),
        )
        r = fetch_market_rss({"a": "https://x/feed", "b": "https://y/feed"})
        assert len(r.items) == 2
        assert r.feeds_ok == 2


class TestTheConfiguredFeeds:
    def test_every_feed_is_https(self):
        assert all(u.startswith("https://") for u in FEEDS.values())

    def test_feed_names_are_unique_and_nonempty(self):
        assert all(FEEDS.values()) and len(set(FEEDS.values())) == len(FEEDS)


class _Resp:
    """Minimal stand-in for the urlopen context manager."""

    def __init__(self, body: bytes):
        self._body = body

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def read(self) -> bytes:
        return self._body
