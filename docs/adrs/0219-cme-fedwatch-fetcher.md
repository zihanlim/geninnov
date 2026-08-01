# ADR-0219 — CME FedWatch as a derived macro_indicators feed

**Date:** 2026-08-01
**Status:** Accepted
**Relates to:** [0066](0066-runs-late-runs-green-runs-loud.md), [0137](0137-units-are-declared-not-assumed.md), design-goals.md §1, §3, §7

## Context

The L5 reasoning agent on Fed policy needs to cite an *implied* probability, not a hand-curated one. "Sept 57% hike" is a snapshot that changes with every Fed-funds-futures tick. A live feed is the right shape; a row in `structured_facts` (ADR-0218) is the wrong one because that table is hand-curated by design.

CME publishes the implied probabilities behind a public URL (`https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html`). The HTML body embeds a JSON payload whose shape has changed at least twice in 2024.

## Decision

**A new fetcher at `backend/data/fedwatch_fetcher.py`** that:

1. Fetches the public CME page with a `User-Agent` header and a 15s timeout.
2. Tries to extract a JSON payload from a `<script>` tag (two patterns supported: `window.__INITIAL_STATE__ = {...}` and `var data = {...};`).
3. Parses both JSON shapes the CME has used: a flat `meetingProbabilities` array and a nested `meetings[].outrights[]` array.
4. Maps CME action labels to a canonical enum (`hold`, `cut_25`, `cut_50`, `cut_75`, `hike_25`, `hike_50`).
5. Returns a list of `{meeting_date, action, probability_pct}` rows.

**The fetcher never raises.** A network failure, a parse error, or an unrecognised shape returns `[]`. The downstream `daily_refresh` upsert sees no rows and writes nothing — the L5 cites the absence as the absence, not a stale value.

**Output lands in `macro_indicators`** with `series_id` like `FEDWATCH_MEETING_2026-09-17_PROB_HOLD` and `FEDWATCH_MEETING_2026-09-17_PROB_HIKE_25`. The naming convention lets the L5 cite by meeting date without a JOIN.

**A sanity check** runs before upsert: per-meeting probabilities must sum to 100% ± 1%. A row that fails is logged but still written — a CME format change is not a reason to drop data, just a reason to log that the consumer should re-check the parser.

## Consequences

- **Positive**: the L5 can cite `[macro_indicators:FEDWATCH_MEETING_2026-09-17_PROB_HIKE_25]` against a value the system refreshed today. The feed runs alongside L0, so a stale snapshot is unlikely.
- **Positive**: the never-raise contract means a CME outage is a no-op rather than a pipeline failure. The L5 cites "FedWatch unavailable" and reasons from training data with the appropriate epistemic disclaimer.
- **Negative**: the public CME page is unauthenticated and the JSON shape is undocumented. A CME change breaks the parser silently — only the sanity check (probabilities don't sum to 100) catches it. Mitigated by a "warn but write" policy: the L5 still gets data, just with a log warning to update the parser.
- **Negative**: rate limits. The CME has no published rate limit, but a `User-Agent: AndromedaBot/1.0 (research)` header with one request per daily run is a polite use pattern.

## Refused alternatives

- **A row in `structured_facts`**: rejected. The table is hand-curated by design. A daily-fresh snapshot is not a fact a human can defend; it's a published-by-the-CME measurement the system reads.
- **A new `fedwatch_indicators` table**: rejected. `macro_indicators` is the home for any single-time-series measurement, and the FEDWATCH_* series fit that shape. A new table is over-engineered.
- **A polling fetcher that runs every 5 minutes**: rejected. The Q2 test rewards a system that *cites* the implied probability, not one that updates it intraday. Daily is enough; intraday polling is a future optimisation.
- **Authenticating with a CME API key**: rejected. CME does not publish a public API; the JSON embedded in the HTML page is the only documented access path. A paid feed is out of scope for this sprint.
