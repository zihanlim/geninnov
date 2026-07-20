# ADR-0005 — VADER over paid sentiment API

- Status: accepted
- Date: 2026-07-21
- Tags: data, dependencies

## Context

Sentiment scoring for news headlines and social posts requires either a paid API (Bloomberg Sentiment, FinBERT, MonkeyLearn) or a local model. The platform budget is zero for paid APIs. A local model must run without a GPU.

## Decision

Use NLTK's VADER lexicon for sentiment analysis. VADER is pre-trained on financial text, runs entirely locally (no API, no cost), and is sufficient for headline-level scoring.

## Consequences

### Positive
- Zero API cost
- Runs locally — no network dependency, no rate limits
- Pre-trained on financial news

### Negative
- Less accurate than transformer-based models (FinBERT) for nuanced financial text
- Rule-based lexicon misses context and sarcasm

### Neutral
- Swap-in point for FinBERT if higher accuracy is required post-prototype

## Alternatives considered

### FinBERT
What it was: A financial-specific transformer model.
Why we ruled it out: Requires GPU for inference speed or a paid API. Cost-prohibitive for MVP.

### Bloomberg Sentiment / MonkeyLearn
What it was: Paid sentiment APIs.
Why we ruled them out: Budget for this project is zero for API costs.

## Links
- Spec: `docs/superpowers/specs/2026-07-21-andromeda-market-theme-platform-design.md`
