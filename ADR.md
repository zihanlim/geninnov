# Architecture Decision Records

Documenting the *why* behind major choices — so future maintainers (human or AI) don't undo good decisions.

---

## ADR-001: Supabase over self-hosted PostgreSQL

**Date**: 2026-07-21

**Decision**: Use Supabase (managed PostgreSQL) as the database.

**Alternatives considered**:
- Self-hosted PostgreSQL in Docker Compose → requires VPS management, backups, updates
- SQLite → insufficient for concurrent reads/writes from Vercel frontend

**Rationale**: Supabase eliminates database server operations. The frontend reads directly from it via `@supabase/supabase-js` — no custom API layer needed for Phase 1–3. Free tier (500MB, 1GB storage) is sufficient for MVP.

**Status**: Accepted. Revisit if data volume exceeds Supabase free tier.

---

## ADR-002: Vercel for frontend hosting

**Date**: 2026-07-21

**Decision**: Host the Next.js frontend on Vercel.

**Alternatives considered**:
- Docker Compose on a VPS → adds VPS cost and server management
- AWS Amplify / Cloudflare Pages → Vercel has better Next.js integration

**Rationale**: Zero-configuration deployment. Push to GitHub → Vercel auto-deploys. No server to manage, no cost for moderate traffic. Next.js 14 App Router is natively supported.

**Status**: Accepted.

---

## ADR-003: Daily cron over real-time FastAPI backend

**Date**: 2026-07-21

**Decision**: No FastAPI, no persistent backend server. Daily batch via `cron-job.org` + `daily_refresh.py`.

**Alternatives considered**:
- FastAPI on VPS → reliable but adds $6–20/mo VPS cost and server management
- Railway/Render for FastAPI → cold starts, free tier hours limits, APScheduler breaks on sleeping dynos

**Rationale**: Daily batch is sufficient for the use case. Eliminates an entire service tier. cron-job.org is free. The frontend reads from Supabase directly — no backend server needed for data freshness.

**Status**: Accepted. Real-time (Phase 4) would reintroduce FastAPI + Redis on VPS.

---

## ADR-004: No Redis for caching

**Date**: 2026-07-21

**Decision**: Skip Redis entirely in Phase 1–3.

**Alternatives considered**:
- Redis on VPS alongside FastAPI → useful for rate-limit buffering, unnecessary without FastAPI
- Upstash (hosted Redis) → adds cost and complexity

**Rationale**: Daily batch makes Redis unnecessary. Brave Search limit is 20 req/query — one request per theme per day is well within limits. Reddit PRAW 60 req/min is fine for a daily batch. No repeated API calls requiring cache.

**Status**: Accepted. Redis would be added in Phase 4 if FastAPI backend is introduced.

---

## ADR-005: VADER sentiment over paid sentiment API

**Date**: 2026-07-21

**Decision**: Use NLTK's VADER lexicon for sentiment analysis instead of a paid API (e.g., FinBERT, Bloomberg Sentiment).

**Alternatives considered**:
- FinBERT (financial-specific transformer model) → requires GPU or paid API
- MonkeyLearn / MeaningCloud → paid, rate-limited

**Rationale**: VADER is free, runs locally, and is pre-trained on financial text. No API cost. Sufficient for headline-level sentiment scoring. Swap-in point for FinBERT later if higher accuracy is needed.

**Status**: Accepted. Evaluate against FinBERT during post-prototype review (Section 7.3 of spec).

---

## ADR-006: Min-max normalization over z-scores for HypeScore

**Date**: 2026-07-21

**Decision**: Min-max normalize each HypeScore sub-component across all themes, rather than z-score normalization.

**Rationale**: Pearson correlation is bounded [-1, +1]. Z-scoring a bounded variable distorts the signal — a 0.4 correlation scores high one day and low the next purely due to cross-theme variation. Min-max normalization preserves the signal's natural scale.

Min-max normalization also makes scores more interpretable (0–100 range) and comparable across run dates without re-referencing historical distributions.

**Status**: Accepted. Documented in spec Section 4.6.

---

## ADR-007: Two-method theme discovery (LDA + embedding clustering)

**Date**: 2026-07-21

**Decision**: Use both LDA topic modeling AND sentence embedding clustering (UMAP + HDBSCAN) to discover themes. Only add themes found by both methods to Tier 2.

**Alternatives considered**:
- LDA only → fast but requires k (topic count) to be specified upfront
- Embedding clustering only → no explicit topic interpretability
- Single method → less robust to noise

**Rationale**: Agreement between two independent methods reduces spurious theme discovery. LDA provides interpretable word distributions; embedding clustering provides semantic groupings. The union (themes found by only one method → Tier 3 for human review) surfaces novel signals without noise.

**Status**: Accepted. Revisit after prototype validation (spec Section 7.3) — if one method consistently produces better forward returns, weight it more heavily.

---

## ADR-008: Tier 1 macro anchors defined by practitioner judgment

**Date**: 2026-07-21

**Decision**: 8 macro themes (Fed Policy, Inflation, China Growth, US Dollar, Geopolitical Risk, Corporate Credit, Energy Prices, US Election) are fixed in the taxonomy as Tier 1 anchors — not discovered.

**Alternatives considered**:
- All themes discovered → risks missing obvious macro drivers
- All themes practitioner-defined → misses emergent themes

**Rationale**: These 8 themes are the primary cross-asset macro drivers. They should always be tracked regardless of what the data finds. Data-driven discovery supplements, not replaces, practitioner judgment for macro.

**Status**: Accepted. Review Tier 1 list quarterly.
