-- Keep the recent agent history, not all of it.
--
-- `purge_agent_history` already trimmed `agent_calls` by age, for every
-- business and not only the trials: ninety days, no org filter. Age alone is
-- the wrong shape for this table. A business that connects one assistant and
-- asks it three things a week is nowhere near ninety days of anything, while
-- one running an agent on a schedule writes a row every time that agent wakes
-- up, and ninety days of that is the largest table in the database. The bound
-- has to be on the number of rows, not on how old the oldest one is.
--
-- So there are two rules now, and a row leaves when either one says so:
--
--   * older than p_call_days (90), same as before, and
--   * beyond the newest p_call_keep (500) of its own business.
--
-- The cap counts only the calls that succeeded. Denials and errors are the
-- rows worth having, which the table's own comment says out loud: a run of
-- them is an assistant asking for something it was never granted. They are
-- also rare, so they cannot be what fills the table, and letting a burst of
-- ordinary work push them out would empty the log of the only part anybody
-- reads it for. They still leave on the age rule, like everything else.
--
-- 500 is deliberately far above what is shown. The Agents page reads the
-- newest 25, so the cap is not a display limit: it is the point past which
-- nobody is going to scroll and the rows are only costing space.
--
-- The signature changes (a third argument, a third returned count), so the old
-- function is dropped rather than replaced. `create or replace` with a new
-- argument list makes an overload, and two functions of this name would leave
-- the caller's named arguments ambiguous.
drop function if exists awesome.purge_agent_history(integer, integer);

create or replace function awesome.purge_agent_history(
  p_call_days  integer default 90,
  p_write_days integer default 1,
  p_call_keep  integer default 500,
  -- Null means every business, which is what the cron passes. Naming one
  -- confines all three deletes to it, so a test can prove the rules against
  -- rows it created itself instead of against somebody's real history. The
  -- trial purge carries the same argument, for the same reason.
  p_org_id     uuid    default null
)
returns table (purged_calls integer, purged_writes integer, capped_calls integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_calls  integer;
  v_writes integer;
  v_capped integer;
begin
  delete from awesome.agent_calls
   where at < now() - make_interval(days => greatest(p_call_days, 1))
     and (p_org_id is null or org_id = p_org_id);
  get diagnostics v_calls = row_count;

  -- Numbered newest first within each business, so the cap is per business and
  -- a busy one can never crowd out a quiet one's history. `id` breaks the tie
  -- on rows written in the same instant, which keeps the ranking stable
  -- between runs instead of dropping a different row each night.
  with ranked as (
    select id,
           row_number() over (
             partition by org_id order by at desc, id desc
           ) as rn
      from awesome.agent_calls
     where outcome = 'ok'
       and (p_org_id is null or org_id = p_org_id)
  )
  delete from awesome.agent_calls c
   using ranked r
   where c.id = r.id
     and r.rn > greatest(p_call_keep, 1);
  get diagnostics v_capped = row_count;

  delete from awesome.agent_writes
   where created_at < now() - make_interval(days => greatest(p_write_days, 1))
     and (p_org_id is null or org_id = p_org_id);
  get diagnostics v_writes = row_count;

  return query select v_calls, v_writes, v_capped;
end $$;

-- The age delete reads `at` alone, which the two existing indexes (both led by
-- another column) cannot serve, so it was a sequential scan every night. The
-- retry guard already carries the same index for the same reason.
create index if not exists agent_calls_age_idx on awesome.agent_calls (at);

-- CREATE FUNCTION resets privileges to EXECUTE TO PUBLIC, and the lockdown loop
-- in schema.sql has long since run. Not repeating this here is exactly how
-- create_invoice came unlocked (see 20260823_security_review).
revoke all on function awesome.purge_agent_history(integer, integer, integer, uuid)
  from public, anon, authenticated;
grant execute on function awesome.purge_agent_history(integer, integer, integer, uuid)
  to service_role;
