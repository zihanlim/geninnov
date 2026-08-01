-- 066_structured_facts.sql
--
-- A hand-curated fact table the L5 reasoning agent cites, with
-- provenance (ADR-0218). Distinct from `macro_indicators` (which is
-- FRED-shaped, automated) and `theme_signals` (which is auto-derived
-- from attention). This table is HUMAN-AUTHORED and is honest about
-- it: source is required, as_of is required, confidence is required.
--
-- Schema rationale:
--   * (entity, metric, as_of) is the natural key. Quarterly updates
--     write a new row rather than overwriting history; the L5 cites
--     the most recent, but a reader can see the trajectory.
--   * value is NUMERIC, never TEXT. The unit column says what the
--     number means ('USD_bn', 'years', 'pct', 'USD_per_million_tokens',
--     'boolean'). The category column groups facts for the L5
--     one-shot read.
--   * confidence is one of 'high' | 'medium' | 'low' — declared at
--     the row level, not at the table level. A "low" fact still
--     travels; the L5 cites it with the confidence attached.
--   * source is required and source_url is optional. The Q2 test
--     rewards candidates whose systems cite from a stored source,
--     not from training data; a row without a source defeats the
--     point of the table.
--
-- RLS: public read (matches macro_indicators). Writes only via
-- service_role (the loader script and the daily_refresh).
--
-- Indexes: (entity, metric, as_of DESC) for the L5's most-recent
-- lookup, and (category, as_of DESC) for the L5's category reads.

BEGIN;

CREATE TABLE IF NOT EXISTS structured_facts (
    id              BIGSERIAL PRIMARY KEY,
    entity          TEXT NOT NULL,
    metric          TEXT NOT NULL,
    value           NUMERIC NOT NULL,
    unit            TEXT NOT NULL,
    as_of           DATE NOT NULL,
    source          TEXT NOT NULL,
    source_url      TEXT,
    confidence      TEXT NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
    category        TEXT NOT NULL,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (entity, metric, as_of)
);

CREATE INDEX IF NOT EXISTS idx_structured_facts_lookup
    ON structured_facts (entity, metric, as_of DESC);
CREATE INDEX IF NOT EXISTS idx_structured_facts_category
    ON structured_facts (category, as_of DESC);

ALTER TABLE structured_facts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read" ON structured_facts;
CREATE POLICY "public read" ON structured_facts
    FOR SELECT USING (true);

COMMENT ON TABLE structured_facts IS
    'Hand-curated facts the L5 reasoning agent cites, with provenance '
    '(ADR-0218). Distinct from macro_indicators (FRED-shaped, automated) '
    'and theme_signals (auto-derived from attention). This table is '
    'human-authored. A row without source or as_of defeats the point. '
    'RLS public read; writes only via service_role.';

COMMENT ON COLUMN structured_facts.entity IS
    'The subject of the fact. Examples: ''MSFT'', ''industry:HBM'', '
    '''macro:erp_jpm_style'', ''study:MIT_2025''. The namespace is open; '
    'a parser would key on the prefix to disambiguate individual '
    'companies (''MSFT''), industries (''industry:HBM''), and external '
    'research findings (''study:MIT_2025'').';

COMMENT ON COLUMN structured_facts.metric IS
    'The quantity measured. Examples: ''capex_fy26_bn'', '
    '''trailing_eps_ttm'', ''hbm_market_share_pct''. Paired with entity, '
    'this is the natural key (ADR-0218).';

COMMENT ON COLUMN structured_facts.value IS
    'The number, in the unit declared. NUMERIC, never text — a fact that '
    'cannot be expressed as a number (e.g. a date) does not belong here.';

COMMENT ON COLUMN structured_facts.unit IS
    'What the number means. Examples: ''USD_bn'' (US dollars in billions), '
    '''years'', ''pct'', ''USD_per_million_tokens'', ''boolean'' (for 0/1 '
    'flags). Decoupling unit from metric is what lets one column hold '
    'different fact types.';

COMMENT ON COLUMN structured_facts.as_of IS
    'The date the fact is true as of. A quarterly update writes a new '
    'row rather than overwriting history; the L5 cites the most recent '
    'row per (entity, metric), but a reader auditing the table can see '
    'the trajectory.';

COMMENT ON COLUMN structured_facts.source IS
    'Where the fact came from. Examples: ''MSFT 10-Q Q1 FY26'', '
    '''TrendForce Q2 2026 report'', ''JPM Equity Strategy 2026-07-15''. '
    'Required: a row without a source defeats the LLM-citation '
    'discipline the table exists to enforce.';

COMMENT ON COLUMN structured_facts.source_url IS
    'Optional canonical link to the source. The L5 cites the source '
    'name; the URL is for a reader who wants to verify.';

COMMENT ON COLUMN structured_facts.confidence IS
    'Row-level confidence: ''high'' (audited, primary source), ''medium'' '
    '(research note, summary stat), ''low'' (estimate, single data point). '
    'Declared per row, not per table; the L5 cites the confidence '
    'alongside the value.';

COMMENT ON COLUMN structured_facts.category IS
    'A grouping the L5 reads in one shot. Values: ''ai_capex'', '
    '''china_ai'', ''macro'', ''valuation''. Open enum — new categories '
    'land by writing rows, not by altering the table.';

COMMENT ON COLUMN structured_facts.notes IS
    'One line of context. Examples: ''FY26 guidance midpoint'', '
    '''Q1 calendar 2026''. Optional but recommended for facts whose '
    'as_of is not self-explanatory.';

COMMIT;
