-- 039_chat_usage.sql
--
-- Spend guard for /ask, the request-time chat agent (ADR-0087).
--
-- WHY THIS EXISTS AT ALL. Every other surface in this product is a read: the
-- frontend holds the anon key, selects from public-read tables, and the worst a
-- stranger can do is read data we publish anyway. /ask is the first surface
-- where a stranger's HTTP request spends *our* money — two MiniMax completions
-- per question, on a quota the nightly book depends on. An unmetered LLM
-- endpoint on a public URL is an open wallet, and the failure mode is not an
-- error page: it is L5 falling back to the deterministic template book the next
-- morning because the quota is gone.
--
-- WHY A TABLE AND NOT AN IN-MEMORY COUNTER. Vercel runs the route handler in
-- however many lambda instances it likes and recycles them freely, so a
-- module-level Map counts one instance's traffic and forgets it on the next cold
-- start. That is not a rate limit, it is a rate suggestion. The counter has to
-- live where every instance can see it, which here means Postgres.
--
-- WHY SECURITY DEFINER AND service_role ONLY. The obvious shape — grant anon
-- EXECUTE so the browser can check its own budget — hands every visitor the
-- ability to increment the *global* counter at will, because the anon key is
-- published in the client bundle by design. Ten seconds of curl would exhaust
-- the daily allowance and deny the feature to everyone: a denial-of-service
-- built out of our own spend guard. So the table carries RLS with NO policies
-- (sealed to anon and authenticated alike) and the function runs as its owner,
-- callable only by service_role — i.e. only from the route handler, which is
-- the only place that can spend anything in the first place.

CREATE TABLE IF NOT EXISTS chat_usage (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- SHA-256 of (client IP + CHAT_IP_SALT), never the address itself. The
    -- counter needs to tell two callers apart; it does not need to know who
    -- they are, and a raw-IP column is a liability with no compensating use.
    ip_hash      TEXT NOT NULL,
    -- UTC, matching the pipeline's own day boundary (daily-refresh.yml runs at
    -- 21:30 UTC). A local-time reset would give some callers two budgets a day.
    usage_date   DATE NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc')::date,
    -- ATTEMPTS, not answers. A caller who trips the cap and keeps hammering
    -- keeps incrementing, so they stay blocked for the rest of the day instead
    -- of getting a fresh allowance every time the count is re-read. A blocked
    -- attempt costs one INSERT and zero LLM tokens, which is the point.
    requests     INT NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (ip_hash, usage_date)
);

CREATE INDEX IF NOT EXISTS idx_chat_usage_date ON chat_usage (usage_date);

ALTER TABLE chat_usage ENABLE ROW LEVEL SECURITY;
-- No policies, deliberately. RLS with zero policies denies everything to anon
-- and authenticated; service_role bypasses RLS, and the function below is
-- SECURITY DEFINER so it runs as the owner regardless. If you ever find
-- yourself adding "Public read" here to debug something, read the header again:
-- the sealing IS the feature.

COMMENT ON TABLE chat_usage IS
    'Per-IP-hash daily request counter for the /ask agent. Sealed: reachable only via chat_rate_limit().';

-- Returns, atomically: whether this attempt is allowed, and the counts that
-- decided it. The caller passes its own caps so the budget lives in one place
-- (the route handler's env) rather than being split between code and schema —
-- safe precisely because only service_role can call this.
CREATE OR REPLACE FUNCTION public.chat_rate_limit(
    p_ip_hash    TEXT,
    p_per_ip_cap INT,
    p_global_cap INT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
-- Pin the schema search path: a SECURITY DEFINER function that resolves objects
-- through a caller-controlled search_path is the classic Postgres privilege
-- escalation.
SET search_path = public, pg_temp
AS $$
DECLARE
    v_today  DATE := (NOW() AT TIME ZONE 'utc')::date;
    v_global INT;
    v_used   INT;
BEGIN
    -- Global ceiling first, and WITHOUT incrementing: once the day's total
    -- budget is gone it is gone for everyone, and letting a blocked caller keep
    -- inflating the shared number would let one client bury the rest.
    SELECT COALESCE(SUM(requests), 0) INTO v_global
      FROM chat_usage WHERE usage_date = v_today;

    IF v_global >= p_global_cap THEN
        RETURN jsonb_build_object(
            'allowed', false,
            'reason', 'global',
            'used', NULL,
            'per_ip_cap', p_per_ip_cap,
            'global_used', v_global,
            'global_cap', p_global_cap
        );
    END IF;

    INSERT INTO chat_usage (ip_hash, usage_date, requests)
    VALUES (p_ip_hash, v_today, 1)
    ON CONFLICT (ip_hash, usage_date)
    DO UPDATE SET requests = chat_usage.requests + 1, updated_at = NOW()
    RETURNING requests INTO v_used;

    RETURN jsonb_build_object(
        'allowed', v_used <= p_per_ip_cap,
        'reason', CASE WHEN v_used <= p_per_ip_cap THEN NULL ELSE 'ip' END,
        'used', v_used,
        'per_ip_cap', p_per_ip_cap,
        'global_used', v_global + 1,
        'global_cap', p_global_cap
    );
END;
$$;

REVOKE ALL ON FUNCTION public.chat_rate_limit(TEXT, INT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.chat_rate_limit(TEXT, INT, INT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_rate_limit(TEXT, INT, INT) TO service_role;

COMMENT ON FUNCTION public.chat_rate_limit(TEXT, INT, INT) IS
    'Atomic per-IP + global daily spend guard for /ask. service_role only — anon executing this could DoS the global budget.';
