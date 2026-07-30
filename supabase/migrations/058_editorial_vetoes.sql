-- 058_editorial_vetoes.sql
--
-- Editorial judgment: a human may refuse a candidate the pipeline would otherwise
-- offer, and must say why.
--
-- Everything else in this system is deterministic by construction (ADR-0013), and
-- that is deliberate. What it did NOT have is the step a portfolio manager
-- actually performs — "this short is news noise, not signal; take the next name
-- instead." The pipeline could rank, size, cap and stress a candidate, but nobody
-- could decline one.
--
-- WHY A FORWARD VETO AND NOT AN EDIT TO A PUBLISHED BOOK.
-- `pick_outcomes` sets `entry = the close on run_date` (ADR-0090). Substituting a
-- name into an already-published book without moving `run_date` would score the
-- substitute from a close that PRECEDED the decision — one day of free hindsight —
-- and `scripts/resolve_outcomes.py` re-derives its claim set from the current
-- `picks` on every run, so the replaced name would silently stop being resolved.
-- Together that is a track record a PM could launder by editing history. A veto
-- therefore acts on the NEXT run and never mutates a published row.
--
-- WHY ROWS ARE REVOKED AND NEVER DELETED.
-- Same reasoning as `book_revisions`: a veto that can be deleted is a decision
-- that can be un-made without trace, and "why is this name absent from the book?"
-- must stay answerable months later. `revoked_at` retires a veto; nothing removes it.

CREATE TABLE IF NOT EXISTS editorial_vetoes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The name being refused. Not a theme: the unit of a veto is the thing that
    -- would appear in the book, and a theme-level refusal is the attention gate's
    -- job (HypeScore threshold), which already exists.
    asset           TEXT NOT NULL CHECK (length(trim(asset)) > 0),

    -- NULL means both sides. A PM who thinks a name is untradeable at all is
    -- making a different claim from one who thinks the SHORT is crowded, and
    -- collapsing the two would make the veto over-broad in one direction and
    -- unenforceable in the other.
    direction       TEXT CHECK (direction IN ('long', 'short')),

    -- NOT NULL by constraint, for the reason book_revisions.reason is: an
    -- unexplained veto is indistinguishable from a bug in the screen, and it is
    -- the only part of this table that carries the editorial judgment itself. The
    -- rest is bookkeeping.
    reason          TEXT NOT NULL CHECK (length(trim(reason)) > 0),

    -- Who decided. Free text rather than an FK: this system has no user table and
    -- inventing one to hold a single operator would be schema for its own sake.
    decided_by      TEXT NOT NULL CHECK (length(trim(decided_by)) > 0),
    decided_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Optional expiry, because most editorial objections are about a MOMENT — a
    -- crowded tape, a pending print — not about a name forever. A veto with no
    -- expiry is permanent until revoked, which is the right default for a
    -- structural objection and the wrong one for a tactical objection; the column
    -- lets the author say which they meant.
    expires_on      DATE,

    -- Retirement, not deletion. See the header.
    revoked_at      TIMESTAMPTZ,
    revoked_reason  TEXT CHECK (revoked_at IS NULL OR length(trim(revoked_reason)) > 0),

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- A revocation must explain itself too, or the audit trail has a hole exactly
    -- where a reader would ask "so why is it back?".
    CONSTRAINT revoked_requires_reason
        CHECK (revoked_at IS NULL OR revoked_reason IS NOT NULL),

    -- An expiry before the decision is a typo that would silently produce a veto
    -- which never applies to anything.
    CONSTRAINT expiry_after_decision
        CHECK (expires_on IS NULL OR expires_on >= decided_at::date)
);

-- The screen reads this on every run, filtered to active rows.
CREATE INDEX IF NOT EXISTS idx_editorial_vetoes_active
    ON editorial_vetoes (asset, direction)
    WHERE revoked_at IS NULL;

COMMENT ON TABLE editorial_vetoes IS
    'Human refusals of candidates the pipeline would otherwise offer. Read by '
    'q1_agent.screen_candidates() on each run and surfaced as a screening-funnel '
    'stage. FORWARD-ACTING ONLY: never mutates a published book, because '
    'pick_outcomes anchors entry to run_date and editing history would let the '
    'track record be laundered. Rows are revoked, never deleted. See ADR-0171.';

COMMENT ON COLUMN editorial_vetoes.direction IS
    'NULL = both sides. "This name is untradeable" and "this SHORT is crowded" are '
    'different claims and are stored as different rows.';

COMMENT ON COLUMN editorial_vetoes.reason IS
    'Required. This column IS the editorial judgment; everything else is bookkeeping. '
    'An unexplained absence from the book is indistinguishable from a screen bug.';

COMMENT ON COLUMN editorial_vetoes.expires_on IS
    'NULL = permanent until revoked. Set it for a tactical objection (crowded tape, '
    'pending print) so a moment-in-time view does not silently become a standing ban.';

-- RLS: readable by anyone, writable only by the service role. A veto is part of
-- the published audit trail — "why is this name not in the book" is a question a
-- reader is entitled to answer — but authoring one is an operator action.
ALTER TABLE editorial_vetoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "editorial_vetoes anon read" ON editorial_vetoes;
CREATE POLICY "editorial_vetoes anon read"
    ON editorial_vetoes FOR SELECT
    USING (true);
