-- 042_theme_news_url.sql
--
-- Gives every persisted headline the link it was already fetched with.
--
-- `theme_news` has stored the headline TEXT since migration 018 and nothing
-- else a reader could follow. The drawer on the frontend renders those
-- headlines as the evidence behind a HypeScore — as plain, unclickable text.
-- Design goal 1 calls a citation the reader cannot follow back worse than no
-- citation at all, because it spends credibility we then cannot rebuild, and
-- an unlinked headline is exactly that shape: it looks like provenance and
-- cannot be checked.
--
-- The link was never missing from the pipeline. `brave_client.fetch_news_for_theme`
-- has always returned `{headline, date, url}` and `reddit_client` has always
-- returned `post.url`; `daily_refresh.build_theme_signals` then rebuilt each item
-- as `{source, text, date}` and dropped the URL on the floor before
-- `persist_theme_news` ever saw it. So this is not a new data source, a new
-- fetch, or a new external dependency — it is one column and two lines of
-- plumbing for a field already crossing the wire.
--
-- NULLABLE, deliberately, and it will stay populated-going-forward only:
--
--   * Every row written before this migration keeps `url IS NULL` permanently.
--     There is no backfill available — the fetch responses were never stored,
--     so the URLs are simply gone, and inventing one from the headline text
--     (a search query, a publisher guess) would manufacture provenance, which
--     is the precise failure this column exists to fix.
--   * `mock_brave` / `mock_reddit` fallback rows carry no real URL either. Mock
--     news already carries a placeholder and the mock Reddit fixtures have no
--     url key at all, so those persist NULL rather than a link to nowhere.
--   * The frontend therefore MUST render a null url as today's plain text with
--     a stated cause (goal 2 — absence is stated, never filled), not as a dead
--     anchor and not by hiding the row.
--
-- Written by scripts/daily_refresh.persist_theme_news; read by
-- frontend/components/ThemeDerivationDrawer.tsx. The L5 agent
-- (q1_agent._load_recent_headlines) reads headline text only and is unaffected.
--
-- See docs/adrs/0089-a-citation-the-reader-can-follow.md

BEGIN;

ALTER TABLE theme_news
    ADD COLUMN IF NOT EXISTS url TEXT;

COMMENT ON COLUMN theme_news.url IS
    'Source link for the headline, as returned by the fetcher. NULL for every '
    'row written before migration 042 (unbackfillable — the responses were '
    'never stored) and for mock fallback rows. Render NULL as plain text with '
    'a stated cause, never as a dead link.';

COMMIT;
