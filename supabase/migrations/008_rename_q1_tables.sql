-- Rename Q1 tables to research_* to avoid @tasks test naming bleed
-- These tables were created in 006_factor_exposures.sql

ALTER TABLE q1_recommendations RENAME TO research_recommendations;
ALTER POLICY "Public read" ON research_recommendations RENAME TO "Public read research_recommendations";

ALTER TABLE q1_agent_runs RENAME TO research_agent_runs;
ALTER POLICY "Public read" ON research_agent_runs RENAME TO "Public read research_agent_runs";
