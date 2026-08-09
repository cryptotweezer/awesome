-- Guest module, the pieces added after the tenancy migration itself:
-- the logo bucket, the assistant's message allowance, and the purge.
--
-- From here on `supabase/schema.sql` is the authoritative description of the
-- database, and it is what a fresh install runs. These dated files remain as
-- the record of how the live database got from one shape to the next.

-- ---------------------------------------------------------------------
-- Storage for the logo each business prints on its own documents.
-- Private: read server-side while rendering a PDF, never linked from a page.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('org-logos', 'org-logos', false, 1048576, array['image/png', 'image/jpeg'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------
-- updated_at is filled in for you, UNLESS you set it deliberately.
--
-- It used to be overwritten unconditionally, so no caller could preserve a
-- timestamp: restoring a backup stamped every row with the restore date. Since
-- the purge below reads this column to decide what is dormant, being unable to
-- write it was also being unable to test the purge.
-- ---------------------------------------------------------------------
create or replace function awesome.touch_updated_at()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if new.updated_at is distinct from old.updated_at then
    return new;
  end if;
  new.updated_at := now();
  return new;
end $function$;

-- ---------------------------------------------------------------------
-- The dashboard assistant runs on the deployment owner's AI credit, so a trial
-- business gets a fixed, all-time allowance.
--
-- Counting happens in one statement that both reads and writes, because two
-- browser tabs asking at the same moment would otherwise each read the old
-- number and both be let through. Returns how many are left; null is unlimited.
-- ---------------------------------------------------------------------
create or replace function awesome.consume_ai_message(p_org_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'awesome', 'pg_catalog'
as $$
declare
  v_cap  integer;
  v_used integer;
begin
  select o.max_ai_messages, o.ai_messages_used
    into v_cap, v_used
    from awesome.orgs o
   where o.id = p_org_id
     for update;

  if not found then
    raise exception 'consume_ai_message: organisation % not found', p_org_id;
  end if;

  if v_cap is null then
    return null;
  end if;

  if v_used >= v_cap then
    raise exception
      'You have used all % assistant messages that come with a trial account. Connect your own AI to keep going: it runs on your account and has no limit.',
      v_cap;
  end if;

  update awesome.orgs
     set ai_messages_used = ai_messages_used + 1
   where id = p_org_id;

  return v_cap - v_used - 1;
end;
$$;

-- ---------------------------------------------------------------------
-- Trial businesses are deleted after a month of silence.
--
-- Activity is DERIVED rather than tracked. Trusting `last_active_at` alone
-- would delete a business that stays signed in and works here every day, since
-- that column only moves on sign-in. Writing a heartbeat on every page render
-- would fix it and cost a database write per page view, for a fact the data
-- already knows. So a business counts as alive if ANY of these is recent:
-- somebody signed in, the business details changed, an invoice was created or
-- changed, or an agent called the gateway. Being brand new counts too.
--
-- The deletes are explicit and ordered rather than left to ON DELETE CASCADE:
-- cascading from `orgs` fans out to clients, issuers and invoices at once, and
-- the invoice -> client and invoice -> issuer foreign keys have no cascade of
-- their own, so the order it happened to pick could fail.
-- ---------------------------------------------------------------------
create or replace function awesome.purge_stale_demo_orgs(p_days integer default 30)
returns table(purged_org_id uuid, purged_name text)
language plpgsql
security definer
set search_path to 'awesome', 'pg_catalog'
as $$
declare
  v_cutoff timestamptz := now() - make_interval(days => greatest(coalesce(p_days, 30), 1));
begin
  return query
  with doomed as (
    select o.id, o.name
      from awesome.orgs o
     where o.is_demo
       and greatest(
             o.last_active_at,
             o.updated_at,
             o.created_at,
             coalesce((select max(i.updated_at) from awesome.invoices i where i.org_id = o.id),
                      '-infinity'::timestamptz),
             coalesce((select max(k.last_used_at) from awesome.agent_keys k where k.org_id = o.id),
                      '-infinity'::timestamptz)
           ) < v_cutoff
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
  del_keys as (
    delete from awesome.agent_keys k where k.org_id in (select id from doomed) returning 1
  ),
  del_members as (
    delete from awesome.org_members m where m.org_id in (select id from doomed) returning 1
  ),
  del_orgs as (
    delete from awesome.orgs o where o.id in (select id from doomed) returning o.id, o.name
  )
  select d.id, d.name from del_orgs d;
end;
$$;

revoke all on function awesome.consume_ai_message(uuid) from public;
revoke all on function awesome.purge_stale_demo_orgs(integer) from public;
grant execute on function awesome.consume_ai_message(uuid) to service_role;
grant execute on function awesome.purge_stale_demo_orgs(integer) to service_role;
