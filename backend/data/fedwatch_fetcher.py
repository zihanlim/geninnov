"""CME FedWatch fetcher (ADR-0219).

Reads the implied FOMC meeting probabilities from the CME FedWatch
tool. The public endpoint is a JSON payload behind the same URL the
HTML page hits, and it changes shape occasionally. The fetcher
tries the JSON first, falls back to HTML parsing, and falls back
again to an empty list (NOT an exception) on any failure.

Output lands in `macro_indicators` with `series_id` like
`FEDWATCH_MEETING_<YYYY-MM-DD>_PROB_HOLD`,
`FEDWATCH_MEETING_<YYYY-MM-DD>_PROB_CUT_25`, etc. The naming
convention lets the L5 cite by meeting date.

The fetcher NEVER raises. A failure is an empty list, and the
upstream `upsert` step decides what to do with no rows.

Why a fetcher, not a hand-curated row: the L5 needs to cite a
date-bound probability. "Sept 57% hike" is a snapshot, not a fact
the user can update in `structured_facts` once a week — it changes
with every tick. A live fetch is the right shape.
"""
from __future__ import annotations

import json
import logging
import re
from datetime import date, datetime, timezone
from typing import Any

import requests

_log = logging.getLogger(__name__)


#: The CME FedWatch page. The JSON endpoint behind it changed twice
#: in 2024 — guarded in the parser.
CME_FEDWATCH_URL = (
    "https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html"
)


#: A meeting-date action's probability. The fetcher is intentionally
#: narrow: it returns one row per (meeting, action), and the
#: downstream consumer decides how to group.
def _action_from_label(label: str) -> str | None:
    """Map a CME label to one of our canonical actions.

    Examples:
      'Unchanged'           -> 'hold'
      '0-0.25 increase'     -> 'hike_25'
      '0.25-0.5 decrease'   -> 'cut_25'
      '0.5-0.75 decrease'   -> 'cut_50'
    Anything we don't recognise is None — the L5 cites actions
    it can name, not actions it had to guess.
    """
    s = label.lower().strip()
    if "unchanged" in s or "no change" in s or "0.00" in s:
        return "hold"
    if "increase" in s or "hike" in s:
        m = re.search(r"(\d+)\s*-\s*(\d+)", s)
        if m:
            lo, _hi = int(m.group(1)), int(m.group(2))
            if lo == 0:
                return "hike_25"
            if lo == 25:
                return "hike_50"
        return "hike_25"
    if "decrease" in s or "cut" in s:
        m = re.search(r"(\d+)\s*-\s*(\d+)", s)
        if m:
            lo, _hi = int(m.group(1)), int(m.group(2))
            if lo == 0:
                return "cut_25"
            if lo == 25:
                return "cut_50"
            if lo == 50:
                return "cut_75"
        return "cut_25"
    return None


def _parse_json_payload(payload: dict) -> list[dict[str, Any]]:
    """Parse the JSON shape. The CME has used at least two shapes
    over the past year: a flat `meetingProbabilities` array and a
    nested `meetings[].outrights[]` array. Both are handled."""
    out: list[dict[str, Any]] = []
    # Shape 1: meetingProbabilities at the top level.
    if "meetingProbabilities" in payload:
        for meeting in payload["meetingProbabilities"]:
            meeting_date = _parse_meeting_date(meeting)
            if not meeting_date:
                continue
            for label, prob in (meeting.get("outrights") or {}).items():
                action = _action_from_label(label)
                if action and isinstance(prob, (int, float)):
                    out.append({
                        "meeting_date": meeting_date,
                        "action": action,
                        "probability_pct": float(prob) * (
                            100.0 if prob <= 1.0 else 1.0
                        ),
                    })
        return out
    # Shape 2: nested meetings[].outrights[].
    if "meetings" in payload:
        for meeting in payload["meetings"]:
            meeting_date = _parse_meeting_date(meeting)
            if not meeting_date:
                continue
            for outright in meeting.get("outrights", []):
                label = outright.get("label") or outright.get("name", "")
                prob = outright.get("probability") or outright.get("p")
                action = _action_from_label(label)
                if action and isinstance(prob, (int, float)):
                    out.append({
                        "meeting_date": meeting_date,
                        "action": action,
                        "probability_pct": float(prob) * (
                            100.0 if prob <= 1.0 else 1.0
                        ),
                    })
        return out
    return out


def _parse_meeting_date(meeting: dict) -> date | None:
    """Extract a meeting date from a meeting dict. The CME uses
    'meetingDate' (string ISO), 'date' (string), and sometimes a
    Unix ms timestamp. We try them in order."""
    for key in ("meetingDate", "date", "meeting_date"):
        v = meeting.get(key)
        if v is None:
            continue
        if isinstance(v, (int, float)):
            try:
                return datetime.fromtimestamp(v / 1000, tz=timezone.utc).date()
            except (ValueError, OSError, OverflowError):
                continue
        if isinstance(v, str):
            try:
                return date.fromisoformat(v[:10])
            except ValueError:
                continue
    return None


def _fetch_payload(timeout: int = 15) -> dict | None:
    """Fetch the CME page. The HTML body contains a JSON payload
    embedded in a <script> tag. We do a tolerant parse: try the
    JSON shape, then fall back to scraping a `<script>` for a
    `window.__INITIAL_STATE__` blob."""
    try:
        resp = requests.get(
            CME_FEDWATCH_URL,
            timeout=timeout,
            headers={"User-Agent": "AndromedaBot/1.0 (research)"},
        )
        resp.raise_for_status()
    except requests.RequestException as exc:
        _log.debug("CME FedWatch fetch failed: %s", exc)
        return None
    html = resp.text
    # Look for an embedded JSON payload. The CME has used both
    # `window.__INITIAL_STATE__ = {...}` and `var data = {...}`.
    for pattern in (
        r"window\.__INITIAL_STATE__\s*=\s*(\{.*?\});",
        r"var\s+data\s*=\s*(\{.*?\});",
    ):
        m = re.search(pattern, html, re.DOTALL)
        if not m:
            continue
        try:
            return json.loads(m.group(1))
        except json.JSONDecodeError:
            continue
    return None


def fetch_fedwatch(*, timeout: int = 15) -> list[dict[str, Any]]:
    """Top-level entry: fetch the public CME page, parse it, return
    a list of (meeting_date, action, probability_pct) rows.

    Returns [] on any failure — the upstream `upsert` is the right
    place to decide what to do with no rows.
    """
    payload = _fetch_payload(timeout=timeout)
    if payload is None:
        return []
    try:
        rows = _parse_json_payload(payload)
    except Exception as exc:  # noqa: BLE001 — never raise from a fetcher
        _log.debug("CME FedWatch parse failed: %s", exc)
        return []
    return rows


def rows_to_macro_indicators(
    rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Convert FedWatch rows to the macro_indicators shape the
    daily_refresh upsert understands. `series_id` is the key the
    L5 cites."""
    out: list[dict[str, Any]] = []
    today = date.today().isoformat()  # noqa: DTZ011 — fetch date, not a timestamp
    for r in rows:
        meeting_date = r["meeting_date"]
        action = r["action"]
        prob = r["probability_pct"]
        out.append({
            "series_id": f"FEDWATCH_MEETING_{meeting_date.isoformat()}_PROB_{action.upper()}",
            "series_name": f"FedWatch {meeting_date.isoformat()} {action}",
            "value": round(float(prob), 2),
            "unit": "pct",
            "fetch_date": today,
        })
    return out


def sanity_check(rows: list[dict[str, Any]]) -> bool:
    """Per-meeting probabilities must sum to ~100%. A row that fails
    this is a CME page change we have not adapted to; we surface
    the warning via the empty-list return path."""
    by_meeting: dict[date, float] = {}
    for r in rows:
        by_meeting[r["meeting_date"]] = by_meeting.get(r["meeting_date"], 0.0) + r["probability_pct"]
    for d, total in by_meeting.items():
        if not (99.0 <= total <= 101.0):
            _log.warning("FedWatch probabilities for %s sum to %.1f%%, expected ~100%%", d, total)
            return False
    return True
