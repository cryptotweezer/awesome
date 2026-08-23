-- Re-lock every function, and make the next drift fail a test instead of
-- waiting to be noticed.
--
-- Found in the security review of 2026-08-23. `create_invoice` was executable
-- by anon and authenticated. It is SECURITY DEFINER, so had anyone ever granted
-- USAGE on this schema to those roles, the public anon key would have been a
-- write primitive that bypasses row level security. Nothing was reachable,
-- because only service_role holds USAGE and PostgREST stops at the schema gate
-- with 42501, but a system that is safe on one control alone is not safe, it is
-- lucky.
--
-- How it happened: the lockdown loop runs once, at the end of schema.sql, and
-- CREATE FUNCTION resets privileges to the default of EXECUTE TO PUBLIC. A
-- later migration (20260812_kit_fixes) recreated create_invoice with a
-- different argument list and did not repeat the revoke, so the loop's work was
-- undone after it had run. Every other function kept its lock because no
-- migration touched it again.
--
-- Trigger functions are left alone on purpose: they are not SECURITY DEFINER,
-- and Postgres refuses to call them except as a trigger.

do $$
declare fn record;
begin
  for fn in
    select p.oid::regprocedure::text as sig
      from pg_proc p
     where p.pronamespace = 'awesome'::regnamespace
       and p.prokind = 'f'
       and p.proname not in (
         'invoice_before_write', 'item_before_write',
         'recalc_invoice_totals', 'touch_updated_at', 'enforce_quota'
       )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn.sig);
    execute format('grant execute on function %s to service_role', fn.sig);
  end loop;
end $$;

-- Any function anon or authenticated can still execute, which should always be
-- nothing but the trigger functions. A test calls this, so the day a migration
-- recreates a function and forgets to re-lock it, the suite says so rather than
-- a reviewer noticing months later.
create or replace function awesome.open_functions()
returns table(function_name text, reason text)
language sql stable
set search_path to 'awesome', 'pg_catalog'
as $$
  select p.oid::regprocedure::text,
         'executable by anon or authenticated'
    from pg_proc p
   where p.pronamespace = 'awesome'::regnamespace
     and p.prokind = 'f'
     and p.proname not in (
       'invoice_before_write', 'item_before_write',
       'recalc_invoice_totals', 'touch_updated_at', 'enforce_quota'
     )
     and (has_function_privilege('anon', p.oid, 'EXECUTE')
          or has_function_privilege('authenticated', p.oid, 'EXECUTE'));
$$;

revoke all on function awesome.open_functions() from public, anon, authenticated;
grant execute on function awesome.open_functions() to service_role;

-- ---------------------------------------------------------------------
--  Registered OAuth clients do not live forever either.
--
--  Registration is open, by design: it hands out a name and a redirect URI and
--  nothing happens until a person approves that name on a consent screen. What
--  it also does is let anybody add rows, so the table needs the same expiry
--  every other append-only table here has. A client with no token and no use
--  in 30 days never completed a connection.
-- ---------------------------------------------------------------------
create or replace function awesome.purge_unused_oauth_clients(
  p_days integer default 30
)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare removed integer;
begin
  delete from awesome.oauth_clients c
   where c.created_at < now() - make_interval(days => greatest(coalesce(p_days, 30), 1))
     and not exists (
       select 1 from awesome.oauth_tokens t where t.client_id = c.client_id
     );
  get diagnostics removed = row_count;
  return removed;
end $function$;

revoke all on function awesome.purge_unused_oauth_clients(integer) from public, anon, authenticated;
grant execute on function awesome.purge_unused_oauth_clients(integer) to service_role;
