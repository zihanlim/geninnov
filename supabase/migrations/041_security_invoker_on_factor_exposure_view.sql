-- 041_security_invoker_on_factor_exposure_view.sql
--
-- Makes `portfolio_factor_exposure` enforce the QUERYING user's permissions
-- rather than its creator's.
--
-- A Postgres view runs as its owner by default. That means RLS on the tables
-- underneath it is evaluated against the OWNER, not against the anon role doing
-- the reading — so a view is a legitimate way to hand out data that RLS would
-- otherwise withhold, and Supabase's linter flags every one of them at ERROR
-- level for that reason.
--
-- WHY THIS ONE WAS NOT ACTUALLY LEAKING, and is worth fixing anyway. The view
-- reads exactly two tables — `factor_exposures` and `portfolio_positions` — and
-- both already carry `Public read` policies granting anon SELECT. So it
-- published nothing anon could not have fetched directly, and the practical
-- exposure was nil. What it was doing was holding that property by ACCIDENT: if
-- either table's policy were ever tightened (a lens becoming subscriber-only, a
-- position roster going private), the tightening would silently not apply here,
-- and the view would keep serving the rows the new policy was written to
-- withhold. `security_invoker` makes the view inherit whatever the tables decide,
-- now and later.
--
-- This is safe to apply precisely BECAUSE both tables are anon-readable today:
-- the queries `/` and `/risk` make against this view return exactly what they
-- returned before. Applying the same change to a view over a sealed table —
-- `chat_usage`, say — would empty it.
--
-- Requires Postgres 15+. The project is on 15+; `security_invoker` is silently
-- ignored as an unknown reloption on 14 and earlier, which would leave the lint
-- open while looking fixed.

ALTER VIEW public.portfolio_factor_exposure SET (security_invoker = on);

COMMENT ON VIEW public.portfolio_factor_exposure IS
    'Book-level FF5+UMD tilt, one row per portfolio run_date, signed-weighted so shorts reduce exposure. security_invoker: inherits the RLS of factor_exposures and portfolio_positions rather than running as the view owner.';
