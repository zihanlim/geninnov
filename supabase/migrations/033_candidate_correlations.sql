-- 033_candidate_correlations.sql
--
-- Store, per run, how correlated each UNHELD candidate is with its closest held
-- position.
--
-- /book answers "why isn't X in the book?" with a `ClearedNotTaken` table. It first
-- answered it with theme overlap, which is close to worthless as evidence: one theme
-- routinely holds four positions across four sectors and both directions, so overlap
-- says almost nothing about whether a name would duplicate a held bet. That column
-- had to be demoted to "a hint, not a verdict".
--
-- Correlation answers it directly. Measured on 2026-07-24, the two shorts the agent
-- passed over score GDX -> SLV +0.82 and GLD -> SLV +0.84 — the same precious-metals
-- bet already held through SLV, which is precisely why the short side is three
-- independent ideas rather than five. Against that, BIL -> TLT -0.18 is genuinely
-- independent and its absence needs a different explanation.
--
-- Shape: {"GDX": {"closest": "SLV", "corr": 0.82}, ...}. A candidate with no usable
-- return history is OMITTED rather than stored as 0.0 — an unmeasurable correlation
-- is not an absent one, and this codebase has repeatedly been bitten by silent zeros.

ALTER TABLE research_recommendations
    ADD COLUMN IF NOT EXISTS candidate_correlations JSONB;

COMMENT ON COLUMN research_recommendations.candidate_correlations IS
    'Per unheld candidate: closest held position by |correlation| over 252d. '
    'Shape {asset: {closest, corr}}. Omits candidates with no return history.';
