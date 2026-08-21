-- Trials end on the 1st of the month, and deleting a business really does
-- delete all of it.
--
-- Two decisions from 2026-08-21, in one migration because they are the same
-- promise seen from both ends: nothing of a guest business outlives it.
--
-- 1. Every trial goes on the 1st of each month, whatever day it signed up.
--    The old rule (a month after sign-up, checked daily) meant the database
--    always held up to a month of strangers' data at any moment, spread over
--    thirty different expiry dates. One date for everybody is smaller to hold,
--    smaller to explain on the banner, and impossible to get wrong. Awesome is
--    is_demo = false, so no value of any argument can reach it.
--
-- 2. Deleting a business stops carrying a hand-written list of its tables.
--    agent_calls, agent_writes, oauth_codes and oauth_tokens all cascade from
--    orgs and none of them was on that list: they happened to be deleted
--    anyway, by the cascade, not by the code that claimed to be doing it. The
--    next table added would not have been so lucky. Now the four tables with
--    foreign keys of their own between them are deleted in order, the org row
--    goes last, and everything else leaves with it by cascade, including
--    anything added later.

-- ---------------------------------------------------------------------
-- 0. A guard, so "everything else leaves by cascade" stays true
--
-- The whole design above rests on every table that carries an org_id having a
-- foreign key to orgs that cascades. That is true today and nothing enforces
-- it: a table created without the constraint would silently start keeping the
-- rows of deleted businesses forever, which is exactly the rubbish this is
-- meant to prevent. This function names any such table, so a test can fail on
-- the day one appears instead of the day somebody notices the size.
-- ---------------------------------------------------------------------
create or replace function awesome.org_cascade_gaps()
returns table(table_name text, reason text)
language sql stable
set search_path to 'awesome', 'pg_catalog'
as $$
  select c.relname::text,
         'no cascading foreign key to orgs'
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'org_id' and a.attnum > 0
    left join pg_constraint fk
           on fk.conrelid = c.oid
          and fk.contype = 'f'
          and fk.confrelid = 'awesome.orgs'::regclass
          and fk.confdeltype = 'c'
   where n.nspname = 'awesome'
     and c.relkind = 'r'
     and not a.attisdropped
     and fk.conname is null;
$$;

revoke all on function awesome.org_cascade_gaps() from public, anon, authenticated;
grant execute on function awesome.org_cascade_gaps() to service_role;

-- ---------------------------------------------------------------------
-- 1. Closing your own account
--
-- Same refusal as before (Awesome is not a trial and cannot be closed from a
-- web form) and the same return value, but the list of tables is gone. It named
-- six and there are ten, and the four it never mentioned were deleted anyway by
-- the cascade. A list that is right by luck is worse than no list: the next
-- table added to the schema would have been kept forever, for businesses that
-- no longer exist.
-- ---------------------------------------------------------------------
create or replace function awesome.delete_demo_org(p_org_id uuid)
returns text
language plpgsql security definer
set search_path to 'awesome', 'pg_catalog'
as $$
declare v_name text;
begin
  select o.name into v_name
    from awesome.orgs o
   where o.id = p_org_id and o.is_demo
     for update;
  if not found then
    raise exception 'delete_demo_org: % is not a trial business', p_org_id;
  end if;

  -- These four have foreign keys between themselves (an invoice points at a
  -- client and an issuer, neither of which cascades), so the order matters and
  -- is spelled out. Everything else that carries an org_id leaves with the org
  -- row below, by cascade, including tables that do not exist yet.
  delete from awesome.invoice_items where org_id = p_org_id;
  delete from awesome.invoices     where org_id = p_org_id;
  delete from awesome.clients      where org_id = p_org_id;
  delete from awesome.issuers      where org_id = p_org_id;
  delete from awesome.orgs         where id     = p_org_id;

  return v_name;
end;
$$;

revoke all on function awesome.delete_demo_org(uuid) from public, anon, authenticated;
grant execute on function awesome.delete_demo_org(uuid) to service_role;

-- ---------------------------------------------------------------------
-- 2. The purge
--
-- p_days = 0 means every trial, whatever its age. That is what the monthly
-- sweep passes, and it is the only value that ignores the sign-up date. Any
-- other number keeps the old meaning (trials older than that many days), which
-- is what the aimed calls in the test suite use.
--
-- p_org_id still aims it at one business and never widens it: is_demo and the
-- age condition are checked inside. A test that calls this unaimed deletes
-- real accounts, and on 2026-08-10 one did.
-- ---------------------------------------------------------------------
drop function if exists awesome.purge_stale_demo_orgs(integer, uuid);

create function awesome.purge_stale_demo_orgs(
  p_days   integer default 30,
  p_org_id uuid    default null
)
returns table(purged_org_id uuid, purged_name text, purged_logo_path text)
language plpgsql security definer
set search_path to 'awesome', 'pg_catalog'
as $$
declare
  v_cutoff timestamptz := now() - make_interval(days => greatest(coalesce(p_days, 30), 0));
begin
  return query
  with doomed as (
    select o.id, o.name, o.logo_path
      from awesome.orgs o
     -- is_demo is the only thing standing between this and the business that
     -- owns the deployment. It is false for Awesome and true for every account
     -- created by signing up.
     where o.is_demo
       and o.created_at < v_cutoff
       and (p_org_id is null or o.id = p_org_id)
  ),
  del_items as (
    delete from awesome.invoice_items i where i.org_id in (select id from doomed) returning 1
  ),
  del_invoices as (
    delete from awesome.invoices i where i.org_id in (select id from doomed) returning 1
  ),
  del_clients as (
    delete from awesome.clients c where c.org_id in (select id from doomed) returning 1
  ),
  del_issuers as (
    delete from awesome.issuers s where s.org_id in (select id from doomed) returning 1
  ),
  -- No list of the rest: agent keys, members, the audit log, the retry guard
  -- and the OAuth tokens all cascade from this delete.
  del_orgs as (
    delete from awesome.orgs o
     where o.id in (select id from doomed)
    returning o.id, o.name, o.logo_path
  )
  select d.id, d.name, d.logo_path from del_orgs d;
end;
$$;

revoke all on function awesome.purge_stale_demo_orgs(integer, uuid) from public, anon, authenticated;
grant execute on function awesome.purge_stale_demo_orgs(integer, uuid) to service_role;
