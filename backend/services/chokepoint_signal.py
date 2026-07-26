"""
Measured maritime-chokepoint disruption, as a scale factor on S6's fixed calibration.

WHY THIS EXISTS. `S6_supply_shock` (ADR-0088) ships a fixed, documented sector-shock map:
Energy +18%, Defense +10%, China Equities -12%, and so on. That calibration is defensible
and auditable, but it is a constant — the stress table says the same thing on a day when
Hormuz is quiet as on a day when transits have collapsed.

WHERE THE DATA COMES FROM, AND WHAT IT COST TO FIND OUT. worldmonitor's REST API is gated
($99.99/mo API Starter). Their **MCP endpoint is not** — `initialize` and `tools/list`
answer unauthenticated, which is how the contract below was read. `tools/call` however
returns `-32001 Authentication required. Use OAuth (/oauth/token) or pass your API key via
X-WorldMonitor-Key header.` So discovery is free and execution is not: the cheapest
credential that unlocks it is the **Pro tier at $39.99/mo**, which lists MCP connectors —
not the $99.99 API tier.

Because `get_chokepoint_status` declares an **outputSchema**, this module is written against
a documented contract rather than a guessed shape. The live path is therefore *implemented
but unverified* — no key was available to call it. Everything that can be tested without
one is tested: the mapping, the bounds, the refusals, and the no-credential fallback.

THE SHAPE WE USE. `data["transit-summaries"]["summaries"][<chokepoint>]` carries
`disruptionPct`, `wowChangePct`, `riskLevel`, `incidentCount7d` and `dataAvailable`, and the
envelope carries `cached_at` and `stale`. Only the slow-moving fields are used: the feed also
publishes 10-minute transit counts, and a once-daily book cannot act on those (see ADR-0088's
closing note on cadence).

THE RULE THIS MODULE ENFORCES: an input we do not trust must never move a published stress
number. `stale`, `dataAvailable: false`, a missing summary, or an out-of-range value all
return the neutral multiplier with a stated reason — never a guess, and never a silent 1.0
that looks like a measurement.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Optional

# The disruption level S6's fixed calibration already represents.
#
# ADR-0088 calibrated S6 as a *material* closure, not an average day, so the baseline is set
# well above zero: at 40% measured disruption the scenario runs exactly as documented and the
# multiplier is 1.0. Below that it damps, above it amplifies. Chosen so the shipped,
# reviewed calibration remains the reference point rather than being silently rescaled.
BASELINE_DISRUPTION_PCT = 40.0

# Hard bounds on the multiplier.
#
# An upstream that reports 100% disruption must not produce a 2.5x shock: at that point the
# scenario stops being the reviewed calibration and becomes an extrapolation nobody signed
# off. Clamping is stated in the scenario description so a reader sees when it bound.
MIN_MULTIPLIER = 0.5
MAX_MULTIPLIER = 1.5

# The neutral value: run S6 exactly as ADR-0088 calibrated it.
NEUTRAL = 1.0


@dataclass(frozen=True)
class ChokepointSignal:
    """A measured disruption reading, or a stated reason there is none."""
    multiplier: float
    disruption_pct: Optional[float]
    chokepoint: Optional[str]
    risk_level: Optional[str]
    wow_change_pct: Optional[float]
    cached_at: Optional[str]
    measured: bool
    reason: str

    @property
    def clamped(self) -> bool:
        """True when the raw reading would have exceeded the bounds."""
        return self.measured and self.multiplier in (MIN_MULTIPLIER, MAX_MULTIPLIER)


def neutral(reason: str) -> ChokepointSignal:
    """No usable reading. S6 runs on its documented calibration and says why."""
    return ChokepointSignal(
        multiplier=NEUTRAL, disruption_pct=None, chokepoint=None, risk_level=None,
        wow_change_pct=None, cached_at=None, measured=False, reason=reason,
    )


def _num(v: Any) -> Optional[float]:
    """A finite number, or None. A bool is not a number — `True` arriving where a percentage
    belongs is upstream corruption, not a disruption of 1%."""
    if isinstance(v, bool) or v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f and f not in (float("inf"), float("-inf")) else None


def signal_from_payload(
    payload: dict,
    *,
    chokepoint: Optional[str] = None,
) -> ChokepointSignal:
    """Map a `get_chokepoint_status` result to a multiplier.

    `chokepoint` selects one summary by case-insensitive substring, matching the upstream
    `chokepoint` filter's own semantics. Omitted, the WORST disruption across all summaries
    is used — a supply shock is a tail scenario, so the binding chokepoint is the relevant
    one, and averaging would let a quiet Panama cancel a closed Hormuz.
    """
    if not isinstance(payload, dict):
        return neutral("Upstream returned no object, so disruption could not be read.")

    # Transport freshness is a separate claim from content freshness, and the upstream
    # states both. A stale cache is not a low-disruption reading.
    if payload.get("stale") is True:
        return neutral(
            "Upstream reported its cache stale, so the reading was not used; S6 ran on its "
            "documented calibration."
        )

    summaries = (
        ((payload.get("data") or {}).get("transit-summaries") or {}).get("summaries")
        if isinstance(payload.get("data"), dict)
        else None
    )
    if not isinstance(summaries, dict) or not summaries:
        return neutral("Upstream returned no transit summaries, so disruption could not be read.")

    cached_at = payload.get("cached_at") if isinstance(payload.get("cached_at"), str) else None

    candidates = []
    for name, s in summaries.items():
        if not isinstance(s, dict):
            continue
        if chokepoint and chokepoint.lower() not in str(name).lower():
            continue
        # `dataAvailable: false` is the upstream saying it has no observation. Treating that
        # as zero disruption would turn "we cannot see" into "all clear" — the exact
        # conflation ADR-0066 forbids.
        if s.get("dataAvailable") is False:
            continue
        d = _num(s.get("disruptionPct"))
        if d is None or not (0.0 <= d <= 100.0):
            continue
        candidates.append((d, str(name), s))

    if not candidates:
        which = f" matching {chokepoint!r}" if chokepoint else ""
        return neutral(
            f"No chokepoint{which} reported a usable disruption reading, so S6 ran on its "
            f"documented calibration."
        )

    disruption, name, s = max(candidates, key=lambda c: c[0])

    raw = disruption / BASELINE_DISRUPTION_PCT if BASELINE_DISRUPTION_PCT > 0 else NEUTRAL
    multiplier = min(MAX_MULTIPLIER, max(MIN_MULTIPLIER, raw))

    bound = ""
    if multiplier != raw:
        bound = f" Clamped to {multiplier:.2f}x from {raw:.2f}x."

    return ChokepointSignal(
        multiplier=multiplier,
        disruption_pct=disruption,
        chokepoint=name,
        risk_level=str(s.get("riskLevel")) if s.get("riskLevel") is not None else None,
        wow_change_pct=_num(s.get("wowChangePct")),
        cached_at=cached_at,
        measured=True,
        reason=(
            f"Scaled by measured disruption at {name}: {disruption:.0f}% against a "
            f"{BASELINE_DISRUPTION_PCT:.0f}% baseline, so shocks run at "
            f"{multiplier:.2f}x the ADR-0088 calibration.{bound}"
        ),
    )


def scale_sector_shocks(shocks: dict[str, float], multiplier: float) -> dict[str, float]:
    """Apply the multiplier to every sector shock, preserving sign.

    Scales magnitude only — a supply shock that is twice as severe hurts importers more and
    helps producers more, it does not reverse anyone. Direction is the calibration's claim
    about transmission and a disruption reading has no authority to flip it.
    """
    return {k: v * multiplier for k, v in shocks.items()}


def fetch_signal(chokepoint: Optional[str] = None, timeout: float = 20.0) -> ChokepointSignal:
    """Read live disruption over worldmonitor's MCP endpoint, or return neutral.

    UNVERIFIED AGAINST THE LIVE ENDPOINT: `tools/call` requires a credential
    (`-32001 Authentication required`) and none was available, so this path has never
    returned real data. It is written against the tool's declared `outputSchema`, and it
    fails to `neutral()` on anything unexpected — so the worst case is that S6 keeps its
    documented calibration, which is exactly today's behaviour.

    Set `WORLDMONITOR_API_KEY` to enable. Absent, no request is made at all.
    """
    key = os.environ.get("WORLDMONITOR_API_KEY")
    if not key:
        return neutral(
            "WORLDMONITOR_API_KEY is not set, so no disruption reading was requested; S6 ran "
            "on its documented calibration."
        )

    try:
        import json as _json
        import urllib.request

        body = _json.dumps({
            "jsonrpc": "2.0", "id": 1, "method": "tools/call",
            "params": {
                "name": "get_chokepoint_status",
                "arguments": {
                    "dataset": ["transit-summaries"],
                    # Server-side projection: the full bundle is large and only the
                    # summaries are used. Their own instructions advertise 80-95% token
                    # reduction from this, and it keeps the parse surface small.
                    "jmespath": "summaries",
                    **({"chokepoint": chokepoint} if chokepoint else {}),
                },
            },
        }).encode()

        req = urllib.request.Request(
            "https://www.worldmonitor.app/mcp",
            data=body,
            headers={
                "content-type": "application/json",
                "accept": "application/json, text/event-stream",
                "mcp-protocol-version": "2025-06-18",
                "X-WorldMonitor-Key": key,
            },
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", "replace")
    except Exception as exc:  # noqa: BLE001 — any failure means "no reading", never a guess
        return neutral(
            f"Disruption reading unavailable ({exc.__class__.__name__}); S6 ran on its "
            f"documented calibration."
        )

    # Their transport answers SSE, so the JSON-RPC object arrives on a `data:` line.
    for line in raw.splitlines():
        line = line[5:].strip() if line.startswith("data:") else line.strip()
        if not line.startswith("{"):
            continue
        try:
            msg = _json.loads(line)
        except ValueError:
            continue
        if "error" in msg:
            return neutral(
                f"Upstream refused the disruption request ({msg['error'].get('message', 'no message')}); "
                f"S6 ran on its documented calibration."
            )
        result = msg.get("result") or {}
        structured = result.get("structuredContent")
        if isinstance(structured, dict):
            return signal_from_payload(structured, chokepoint=chokepoint)
        for block in result.get("content") or []:
            if isinstance(block, dict) and block.get("type") == "text":
                try:
                    return signal_from_payload(_json.loads(block.get("text") or ""), chokepoint=chokepoint)
                except ValueError:
                    continue
    return neutral("Upstream response carried no readable disruption payload; S6 ran on its documented calibration.")
