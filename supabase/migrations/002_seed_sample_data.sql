-- Seed sample data for Phase 1: working frontend with sample data
-- Run this after 001_initial_schema.sql to populate the frontend with realistic-looking data.

-- Seed themes with sample scores (so the dashboard shows real numbers immediately)
UPDATE themes SET
  hype_score = CASE name
    WHEN 'Fed Policy'        THEN 72.3
    WHEN 'Inflation'         THEN 68.5
    WHEN 'China Growth'      THEN 55.1
    WHEN 'US Dollar'         THEN 61.8
    WHEN 'Geopolitical Risk' THEN 78.4
    WHEN 'Corporate Credit'  THEN 44.2
    WHEN 'Energy Prices'     THEN 59.7
    WHEN 'US Election'       THEN 82.1
  END,
  volume_score = 0.65,
  sentiment_score = 0.52,
  corr_score = 0.48,
  momentum_score = 0.55,
  updated_at = NOW()
WHERE tier = 'anchor';

-- Seed research_output with Q1 long/short rationale
INSERT INTO research_output (section, content) VALUES
('Framework', 'Systematic theme identification framework combining news sentiment, social media attention, and market correlation. Themes ranked by HypeScore (0-100). HypeScore = weighted composite of Volume (30%) + Sentiment (20%) + Market Correlation (30%) + Momentum (20%).')
ON CONFLICT (section) DO UPDATE SET content = EXCLUDED.content;

INSERT INTO research_output (section, content) VALUES
('Top 5 Long', E'1. US Election (82.1 HypeScore): Political uncertainty drives defensive positioning. ETFs: QQQ, XLV.\n2. Geopolitical Risk (78.4): Safe-haven demand for gold and long-duration Treasuries. ETFs: GLD, TLT.\n3. Fed Policy (72.3): Rate-cut expectations boosting rate-sensitive sectors. ETFs: TLT, GLD.\n4. Inflation (68.5): Persistent price pressures support real assets. ETFs: GLD, SLV, TIPS.\n5. China Growth (55.1): Policy stimulus expectations. ETFs: FXI, MCHI.')
ON CONFLICT (section) DO UPDATE SET content = EXCLUDED.content;

INSERT INTO research_output (section, content) VALUES
('Top 5 Short', E'1. Corporate Credit (44.2): Tight spreads signal crowded long positioning. ETFs: HYG, LQD.\n2. Energy Prices (59.7): OPEC+ supply management uncertain; momentum fading. ETFs: XLE, OIH.\n3. US Dollar (61.8): Fed pivot reducing dollar strength. ETFs: UUP, FXE.\n4. China Growth (55.1): Property crisis unresolved despite stimulus. ETFs: BABA, KWEB.\n5. Inflation (68.5): Long positioning crowded after CPI surprise. ETFs: TIPS, SLV.')
ON CONFLICT (section) DO UPDATE SET content = EXCLUDED.content;
