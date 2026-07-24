-- 035_conviction_vol_floor.sql — ADR-0047
--
-- conviction = |EdgeScore| / vol is the Stage-4 sizing weight (ADR-0032). With no
-- floor under vol, the ratio stops describing the idea and starts describing the
-- denominator. Measured on the 2026-07-25 book:
--
--   BIL   0.19% annualised vol -> conviction 2375.2
--   SHY   1.50%                ->            292.1
--   AGG   4.16%                ->             99.2
--   IEF   5.07%                ->             79.4
--   ... 35 names between 9.1 and 30.1 ...
--   SLV  74.58%                ->              9.1
--
-- That does not say BIL was 260x the better idea than SLV; it says BIL barely
-- moves. And because allocate_portfolio(size_by='conviction') weights by this
-- number, a cash-like instrument absorbs the book until the single-name cap stops
-- it — inverse-vol sizing pushed past the point where it scales risk.
--
-- 0.00315 daily ~= 5% annualised. The basis is economic, not a percentile of the
-- day's names: 5% annualised volatility is the conventional boundary between a
-- cash-like instrument and a risk position. Today's universe corroborates it
-- rather than defines it — BIL (0.19%) and SHY (1.50%) are unambiguously cash
-- proxies, IEF (5.07%) and AGG (4.16%) sit on the line, and everything above is a
-- position someone is taking a view with.
--
-- The floor must stay ABSOLUTE. A percentile floor would make conviction a
-- statement about the day's peer group rather than about the asset, which is the
-- mistake ADR-0042 removed from HypeScore's sub-scores.
--
-- Set to 0 to disable the floor and restore pre-ADR-0047 behaviour.

INSERT INTO scoring_config (param_name, value)
VALUES ('conviction_vol_floor', '0.00315')
ON CONFLICT (param_name) DO UPDATE
  SET value = EXCLUDED.value,
      updated_at = now();
