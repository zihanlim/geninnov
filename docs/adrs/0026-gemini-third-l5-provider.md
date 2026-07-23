# ADR-0026 — Google Gemini as a third L5 LLM provider

- Status: accepted
- Date: 2026-07-23
- Tags: llm, provider, ops

## Context

L5 (`reason_picks`, `classify_news`) needs an LLM. `_llm_complete` supported MiniMax (preferred) → Anthropic (fallback). Neither has a free tier that makes it easy to just *run* the Q1 agent for development/assessment, and without a working key `run_q1_agent` returns `None` (no book). ADR-0013 already established that the LLM lives only at L5 and is a **constrained synthesizer** — the citation guardrail (ADR-0012) and candidate hard-filter (ADR-0014) bound whatever model answers — so the provider is swappable without weakening the L5 contract.

## Decision

Add **Google Gemini** (AI Studio) as a third provider in `_llm_complete`, priority **MiniMax > Anthropic > Gemini** (`GEMINI_API_KEY`, `GEMINI_MODEL_ID`). Default model is **`gemini-flash-latest`**, not a pinned version: the newer `AQ.`-format AI Studio keys reject pinned `gemini-2.5-flash` for new users (`404 no longer available to new users`) and hit per-model `429` quota on some 2.x pins, while the `-latest` alias resolves to a currently-serveable flash model. Gemini's JSON responses are un-fenced with the same `​```json``` stripping already used for MiniMax.

## Consequences

### Positive
- The Q1 agent runs on Gemini's free tier — no paid key required to produce a book.
- Three-provider resilience; the winning provider is still bound by the guardrail + candidate filter, so output quality/safety is provider-independent.

### Negative
- Free-tier **per-model quotas** apply (`429` on several pinned 2.x models); `gemini-flash-latest` / `gemini-flash-lite-latest` are the reliable free choices. A heavy `classify_news` day could brush the rate limit.
- Model identity drifts under the `-latest` alias — acceptable at temperature 0 for this use, and pinnable via `GEMINI_MODEL_ID` if exact reproducibility is needed.

## Alternatives considered

- **Pin `gemini-2.5-flash`.** Rejected — `404` for the new key format.
- **Require paid MiniMax/Anthropic.** Rejected — defeats the "just run it" goal.
- **NewsAPI / X (Twitter).** Out of scope here — those are *data sources*, not LLM providers; evaluated separately and deferred (X is read-restricted/costly; NewsAPI redundant with Brave).

## Links
- `backend/services/q1_agent.py` (`_llm_complete`, Gemini branch), ADR-0012, ADR-0013, ADR-0014
