"""The third news provider, and the only one that needs neither a key nor a host.

WHY A THIRD PROVIDER AT ALL
---------------------------
[ADR-0094](../../docs/adrs/0094-no-corroboration-gate-over-a-single-source.md) has
said since it was written that HypeScore rests on **one** provider. On 2026-07-29
that stopped being a theoretical exposure: Brave's quota died mid-run, three themes
collected zero documents, and each was published with a fabricated
`hype_score = 28.5714` (ADR-0156). One provider failing is currently indistinguishable
from a quiet market until you look at the run log.

WHY RSS RATHER THAN A SECOND SEARCH API
---------------------------------------
Measured on 2026-07-29, against the alternatives that were actually on the table:

    provider          date present    host?   key?   quota
    RSS (this)        388/388 = 100%  no      no     none
    SearXNG (news)    360/429 =  84%  YES     no     none
    SearXNG (general)   0/194 =   0%  YES     no     none
    Brave             (dated)         no      YES    $ per 1000

`pubDate` is REQUIRED by the RSS 2.0 spec and is emitted by the publisher. Every
other option infers a date from a search-result page, which is why SearXNG's general
category returns none at all. Publication date is the field that buckets a document
into a day, so a provider that guesses it cannot carry a share-of-voice series
(ADR-0155) and cannot count a `mention_count_1d`.

Self-hosted metasearch was measured and rejected on three further grounds: it is MORE
recency-skewed than the provider ADR-0144 already rejected for that (52.1% of a 45-day
window in the last 7 days, vs Brave 48% and GDELT 18%), one engine carried 200 of 250
results so a single block collapses the corpus, and public instances returned
429/403 on the first request.

WHAT THIS IS NOT
----------------
**It is not a replacement for Brave.** A general-news pool cannot be interrogated
per theme. Filtering the pooled 388 headlines through `THEME_KEYWORDS` on 2026-07-29:

    Geopolitical Risk 23 · Fed Policy 18 · Inflation 7 · AI Capex 6
    Energy Prices 3 · US Election 2 · China Growth 0 · US Dollar 0 · Corporate Credit 0

Three themes matched **nothing**. Brave returns ~40 per theme on demand because you
can ask it a question. This supplements that; it does not substitute for it.

**It is not an archive.** A feed holds only its most recent items — typically 10-50.
There is no backfill and no history: what you did not collect yesterday is gone.
GDELT remains the only source of history (ADR-0144).

**It is SHADOW on arrival.** These rows are persisted and source-tagged, and no
published number reads them. Including a new provider in a scored corpus changes a
denominator, and ADR-0155 is precisely about what a silently changed denominator does
to a series. That inclusion is a separate, deliberate decision, taken once there is
enough parallel history to answer whether RSS and Brave agree about which themes are
loud — which is the corroboration ADR-0094 asks for and which cannot be measured
before two providers have run side by side.

A DEAD FEED IS REPORTED, NOT ABSORBED
-------------------------------------
`fetch_market_rss` returns the items AND the per-feed failures. Fourteen feeds
silently becoming three is the ADR-0156 failure mode with more steps: the corpus
would shrink, every share would move, and nothing would look wrong.
"""
from __future__ import annotations

import email.utils
import re
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from datetime import datetime, timezone

#: Broad financial/business feeds. Chosen to be ABOUT THE MARKET rather than about
#: any theme — the same rule `MARKET_SEED_QUERIES` follows (ADR-0141), and the reason
#: this corpus can contain a narrative nobody named in advance.
#:
#: Two regulator feeds (Fed, SEC) are included deliberately: they are primary sources
#: whose items are not selected by an editor chasing traffic, which is a different
#: bias from the newswires and not a smaller one.
FEEDS: dict[str, str] = {
    "cnbc-top": "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114",
    "cnbc-finance": "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664",
    "cnbc-economy": "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258",
    "marketwatch-top": "https://feeds.content.dowjones.io/public/rss/mw_topstories",
    "marketwatch-pulse": "https://feeds.content.dowjones.io/public/rss/mw_marketpulse",
    "yahoo-finance": "https://finance.yahoo.com/news/rssindex",
    "investing-com": "https://www.investing.com/rss/news.rss",
    "federal-reserve": "https://www.federalreserve.gov/feeds/press_all.xml",
    "sec-press": "https://www.sec.gov/news/pressreleases.rss",
    "nyt-business": "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml",
    "bbc-business": "https://feeds.bbci.co.uk/news/business/rss.xml",
    "guardian-business": "https://www.theguardian.com/uk/business/rss",
    "seeking-alpha": "https://seekingalpha.com/market_currents.xml",
    "ft-companies": "https://www.ft.com/companies?format=rss",
}

#: The provider tag written to `market_news.source`. One value, so a corpus can be
#: defined by naming its providers rather than by taking whatever is in the table.
RSS_SOURCE = "rss"

REQUEST_TIMEOUT_S = 25.0
#: A courtesy UA. Several publishers 403 an unidentified client.
_UA = "Mozilla/5.0 (compatible; AndromedaResearch/1.0; +https://andromeda-analytics.vercel.app)"

#: Atom and RSS spell everything differently, and dc:date appears in both.
_NS = {
    "atom": "http://www.w3.org/2005/Atom",
    "dc": "http://purl.org/dc/elements/1.1/",
}
_TAG = re.compile(r"<[^>]+>")


@dataclass
class RssFetch:
    """Items, and — equally load-bearing — what failed to arrive (ADR-0156)."""

    items: list[dict] = field(default_factory=list)
    failures: dict[str, str] = field(default_factory=dict)
    feeds_ok: int = 0

    @property
    def all_failed(self) -> bool:
        return self.feeds_ok == 0


def _parse_date(raw: str | None) -> datetime | None:
    """RFC-822 (RSS) or ISO-8601 (Atom). Naive datetimes are assumed UTC.

    Returns None rather than guessing. An undated item is dropped by the caller —
    the entire argument for this provider is that its dates are real, so keeping an
    undated one would spend that property for one extra headline.
    """
    if not raw:
        return None
    raw = raw.strip()
    try:
        d = email.utils.parsedate_to_datetime(raw)
        if d is not None:
            return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        pass
    try:
        d = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _text(el) -> str:
    """Element text with any embedded markup stripped. ElementTree already
    resolves CDATA, but several feeds put <b>/<em> inside a title."""
    if el is None:
        return ""
    return _TAG.sub("", "".join(el.itertext())).strip()


def _first(node, *paths):
    """First matching child, or None.

    NOT `a or b`. An ElementTree Element with no subelements is **falsy**, so
    `node.find("title") or node.find("atom:title")` throws away a perfectly good
    <title> that happens to have text and no children — which is every title in
    every feed. That bug returned 0 items from 14 healthy feeds.
    """
    for p in paths:
        el = node.find(p, _NS) if ":" in p else node.find(p)
        if el is not None:
            return el
    return None


def _entries(root) -> list:
    """RSS <item> and Atom <entry>, whichever the feed uses.

    `or` is safe here and only here: findall returns a LIST, whose truthiness is
    ordinary."""
    return root.findall(".//item") or root.findall(".//atom:entry", _NS)


def _entry_date(node) -> datetime | None:
    for path in ("pubDate", "dc:date", "atom:published", "atom:updated", "updated"):
        el = _first(node, path)
        if el is not None:
            d = _parse_date(_text(el))
            if d:
                return d
    return None


def _entry_link(node) -> str:
    el = _first(node, "link")
    if el is not None and _text(el):
        return _text(el)
    el = _first(node, "atom:link")
    if el is not None:
        return (el.get("href") or "").strip()
    return ""


def parse_feed(xml_bytes: bytes, feed_name: str) -> list[dict]:
    """One feed's XML to items. Pure — no network, so it is testable."""
    root = ET.fromstring(xml_bytes)
    out: list[dict] = []
    for node in _entries(root):
        headline = _text(_first(node, "title", "atom:title"))
        if not headline:
            continue
        published = _entry_date(node)
        if published is None:
            # See _parse_date: an undated item spends this provider's one advantage.
            continue
        out.append({
            "headline": headline,
            "date": published.date().isoformat(),
            "url": _entry_link(node),
            "source": RSS_SOURCE,
            "feed": feed_name,
        })
    return out


def fetch_market_rss(feeds: dict[str, str] | None = None) -> RssFetch:
    """Every configured feed, deduplicated by headline.

    Never raises for a single dead feed — with fourteen of them, one publisher
    changing a URL should not cost the whole corpus. It never HIDES one either:
    `failures` names each and `all_failed` distinguishes "the feeds were quiet"
    from "we have no network", which is the distinction ADR-0156 exists for.
    """
    feeds = FEEDS if feeds is None else feeds
    result = RssFetch()
    seen: set[str] = set()

    for name, url in feeds.items():
        try:
            req = urllib.request.Request(url, headers={"User-Agent": _UA})
            with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_S) as r:
                body = r.read()
            items = parse_feed(body, name)
        except (urllib.error.URLError, ET.ParseError, OSError, ValueError) as exc:
            result.failures[name] = f"{exc.__class__.__name__}: {exc}"[:200]
            continue

        result.feeds_ok += 1
        for it in items:
            key = it["headline"].strip().lower()
            if key in seen:
                continue
            seen.add(key)
            result.items.append(it)

    return result
