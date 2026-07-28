"""POST /api/compute/size — size a set of signals under a caller-supplied mandate.

WHY THIS IS PYTHON AND NOT A ROUTE HANDLER
------------------------------------------
It calls `optimizer.py`, which is cvxpy. There is no browser path to that, and a
JavaScript reimplementation is the thing ADR-0107 exists to prevent: the source
`optimizer.py` was read across from clipped every weight at zero regardless of its
own `long_only` flag and renormalised to sum 1, which on a long-short book deletes
every short. A second sizer is a second instance of that class of bug, found by a
reader rather than by a test.

So this is a thin HTTP shim over `backend.services.compute_api`. All of the logic,
all of the validation and all of the tests live there; this file parses a request,
calls one function, and serialises the answer. That split is deliberate — the sizer
is testable with no Vercel, no network and no deployment.

NAMESPACING
-----------
`/api/compute/*`, not `/api/*`. The Next.js app already owns `/api/chat` and
`/api/mcp` as route handlers, and a root-level Python function competing for the
same prefix is a routing conflict waiting to happen.

WHAT IT MAY NOT DO
------------------
Nothing that changes anything. No table is written, the pipeline cannot be re-run,
and a published book cannot be replaced. That is design goal 5's bar for any
server-side control, and the same bar `/ask` had to clear. The only write in the
request path is the rate-limit counter, in a table that exists for no other purpose.
"""

from __future__ import annotations

import json
import os
import sys
from http.server import BaseHTTPRequestHandler
from pathlib import Path

# The repo root, so `backend.services.*` resolves. This file is at
# <root>/api/compute/size.py, so the root is three parents up.
_ROOT = Path(__file__).resolve().parents[2]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from backend.services.compute_api import (  # noqa: E402
    ComputeError,
    mandate_from_payload,
    size_book,
)

# A solve is CPU-bound and cvxpy is not free. Separate budget from /ask's, because
# exhausting one must not exhaust the other — /ask's cap protects tomorrow's BOOK
# (it shares the MiniMax quota with L5), and this one protects nothing but the CPU.
PER_IP_CAP = int(os.environ.get("COMPUTE_PER_IP_DAILY_CAP", "120"))
GLOBAL_CAP = int(os.environ.get("COMPUTE_GLOBAL_DAILY_CAP", "2000"))

MAX_BODY_BYTES = 512 * 1024


class handler(BaseHTTPRequestHandler):
    def do_POST(self):  # noqa: N802 — the name the runtime dispatches on
        try:
            length = int(self.headers.get("content-length") or 0)
        except ValueError:
            return self._fail(400, "content-length is not a number")
        if length <= 0:
            return self._fail(400, "empty request body")
        if length > MAX_BODY_BYTES:
            return self._fail(413, f"body exceeds {MAX_BODY_BYTES} bytes")

        try:
            body = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            return self._fail(400, f"body is not valid JSON: {exc}")
        if not isinstance(body, dict):
            return self._fail(400, "body must be a JSON object")

        allowed, limit_note = _rate_limit(self._client_ip())
        if not allowed:
            return self._fail(429, limit_note)

        try:
            mandate = mandate_from_payload(body.get("mandate"))
            result = size_book(
                signals=body.get("signals") or [],
                mandate=mandate,
                cov=body.get("cov"),
                sector_map=body.get("sector_map"),
                geo_map=body.get("geo_map"),
                objective=body.get("objective") or "mean_variance",
            )
        except ComputeError as exc:
            # A refusal with a reason the caller can act on, never a silently
            # substituted default: sizing under a mandate the caller did not ask for
            # is worse than not sizing at all.
            return self._fail(400, str(exc))
        except Exception as exc:  # noqa: BLE001 — must not leak a stack trace
            return self._fail(500, f"solve failed ({exc.__class__.__name__})")

        self._ok(result)

    def do_GET(self):  # noqa: N802
        # No server-initiated stream and nothing cacheable; a GET here is a mistake
        # worth naming rather than a 404.
        self._fail(405, "POST a JSON body with {signals, mandate} to this endpoint")

    # ── plumbing ──────────────────────────────────────────────────────────────
    def _client_ip(self) -> str:
        forwarded = self.headers.get("x-forwarded-for") or ""
        return forwarded.split(",")[0].strip() or "unknown"

    def _ok(self, payload: dict) -> None:
        self._send(200, {"ok": True, **payload})

    def _fail(self, status: int, message: str) -> None:
        self._send(status, {"ok": False, "error": message})

    def _send(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        # Read-only and mandate-dependent, so nothing here is publicly cacheable.
        self.send_header("cache-control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):  # noqa: D102 — silence stderr access logging
        return


def _rate_limit(ip: str) -> tuple[bool, str]:
    """Per-IP + global daily cap, via the same sealed RPC `/ask` uses.

    **Fails OPEN when unconfigured, and that is a deliberate asymmetry.** Without
    Supabase credentials this endpoint cannot spend anything that matters — it holds
    no LLM quota and writes no domain table — so refusing every request would break
    a working feature to protect a budget that does not exist. `/ask` fails CLOSED
    because its budget is tomorrow's book.
    """
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        return True, ""

    try:
        import hashlib

        from supabase import create_client

        salt = os.environ.get("CHAT_IP_SALT", "")
        # Salted: an unsalted hash of an IPv4 address is brute-forceable in seconds.
        ip_hash = hashlib.sha256(f"{salt}{ip}".encode()).hexdigest()
        sb = create_client(url, key)
        res = sb.rpc(
            "chat_rate_limit",
            {"p_ip_hash": ip_hash, "p_per_ip_cap": PER_IP_CAP, "p_global_cap": GLOBAL_CAP},
        ).execute()
        data = res.data or {}
        if data.get("allowed") is False:
            return False, (
                "daily compute cap reached. This endpoint is rate limited per IP and "
                "globally; the published book and its MCP tools are unaffected."
            )
        return True, ""
    except Exception:  # noqa: BLE001
        # A rate-limiter that 500s must not take the endpoint with it.
        return True, ""
