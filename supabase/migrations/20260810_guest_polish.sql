-- What came out of the first real guest account (see § PRIMER TESTING in
-- plan_invitado.md), plus the change of mind about how long a trial lives.
--
-- 1. "Cleaning Service" stops being written into the schema and becomes a
--    per-business setting, empty for everyone except Awesome.
-- 2. A client no longer has to carry a service description at all.
-- 3. Trial businesses are deleted a month after they are created, used or not.

-- ---------------------------------------------------------------------
-- 1. The usual service becomes a property of the business
--
-- Awesome invoices the same thing every time, so its forms should keep filling
-- themselves in. A printing shop does not clean anything, and the word must not
-- appear anywhere in its account. That difference is exactly one per business,
-- which is what makes this a column on orgs rather than a branch on is_demo:
-- being a trial and always selling the same thing are unrelated ideas.
-- ---------------------------------------------------------------------
alter table awesome.orgs
  add column if not exists default_service_description text not null default '';

update awesome.orgs
   set default_service_description = 'Cleaning Service'
 where id = '00000000-0000-0000-0000-000000000001'
   and default_service_description = '';

-- ---------------------------------------------------------------------
-- 1b. Whether the work is agreed per client, or said per invoice line
--
-- Awesome agrees a service and a rate with each client and bills that, month
-- after month. Most businesses do not: what the job was and what it cost are
-- properties of the invoice, not of the customer, and asking for them when the
-- client is created is a form to fill in for nothing.
--
-- Kept separate from default_service_description on purpose. "I always sell the
-- same thing" and "I agree a price per customer" are different claims, and one
-- column pretending to answer both would eventually be wrong for somebody.
-- ---------------------------------------------------------------------
alter table awesome.orgs
  add column if not exists per_client_defaults boolean not null default false;

update awesome.orgs
   set per_client_defaults = true
 where id = '00000000-0000-0000-0000-000000000001';

-- ---------------------------------------------------------------------
-- 2. A client may have no usual service and no agreed rate
--
-- The guest client form now asks only who the client is; what the work is and
-- what it costs are said on each invoice line. Both columns were already
-- optional in spirit, but the description carried a NOT NULL and a default that
-- put the word back in by itself.
-- ---------------------------------------------------------------------
alter table awesome.clients alter column default_description drop default;
alter table awesome.clients alter column default_description drop not null;
alter table awesome.invoice_items alter column description drop default;

-- Trial accounts that were handed the word before it was theirs to refuse.
-- Awesome and any other real business are untouched.
update awesome.clients c
   set default_description = null
  from awesome.orgs o
 where o.id = c.org_id
   and o.is_demo
   and c.default_description = 'Cleaning Service';

-- Line items are snapshots and are normally never rewritten. The exception is
-- narrow and deliberate: only trial accounts, only lines that were never typed
-- by anyone, and only because the word is wrong on their documents. Blank is
-- not an option, an invoice line has to say something.
update awesome.invoice_items it
   set description = 'Service'
  from awesome.orgs o
 where o.id = it.org_id
   and o.is_demo
   and it.description = 'Cleaning Service';

-- ---------------------------------------------------------------------
-- 2b. One create_invoice, not two
--
-- The live database held create_invoice with p_created_by BEFORE p_items, while
-- schema.sql declares it after. Replacing it from schema.sql's text therefore
-- created a SECOND function instead of replacing the first, and PostgREST
-- refuses to pick between two overloads: every call fails with PGRST203. Every
-- caller passes its arguments by name, so the one to drop is the one that does
-- not match schema.sql. Dropped first, so what follows is the only one left.
-- ---------------------------------------------------------------------
drop function if exists awesome.create_invoice(uuid, uuid, date, text, jsonb, text, uuid);

-- ---------------------------------------------------------------------
-- 3. The two write functions stop knowing what business they serve
--
-- A blank description now falls back to the business's own default, and if
-- there is none it is an error: an invoice line that says nothing is not
-- something to paper over with a guess.
-- ---------------------------------------------------------------------
create or replace function awesome.create_invoice(
  p_client_id      uuid,
  p_issuer_id      uuid,
  p_invoice_date   date,
  p_items          jsonb,
  p_internal_notes text,
  p_created_by     text,
  p_org_id         uuid
)
returns awesome.invoices
language plpgsql security definer
set search_path to 'awesome', 'pg_catalog'
as $$
declare
  v_client  awesome.clients;
  v_issuer  awesome.issuers;
  v_invoice awesome.invoices;
  v_number  integer;
  v_default text;
begin
  if p_created_by is null or btrim(p_created_by) = '' then
    raise exception 'create_invoice: p_created_by is required (agent signature)';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'create_invoice: at least one line item is required';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) e
    where nullif(e->>'rate', '') is null
  ) then
    raise exception 'create_invoice: every line item needs a rate';
  end if;

  select * into v_client from awesome.clients
   where id = p_client_id and org_id = p_org_id;
  if not found then
    raise exception 'create_invoice: client % not found', p_client_id;
  end if;

  select * into v_issuer from awesome.issuers
   where id = p_issuer_id and org_id = p_org_id;
  if not found then
    raise exception 'create_invoice: issuer % not found', p_issuer_id;
  end if;

  select nullif(btrim(coalesce(o.default_service_description, '')), '')
    into v_default
    from awesome.orgs o where o.id = p_org_id;

  if v_default is null and exists (
    select 1 from jsonb_array_elements(p_items) e
    where nullif(btrim(coalesce(e->>'description', '')), '') is null
  ) then
    raise exception 'create_invoice: every line item needs a description';
  end if;

  -- Take the next number and advance the counter in one statement. The row
  -- lock is per business, so two businesses never wait on each other and
  -- neither can be handed the same number twice.
  update awesome.orgs
     set next_invoice_number = next_invoice_number + 1
   where id = p_org_id
  returning next_invoice_number - 1 into v_number;
  if not found then
    raise exception 'create_invoice: organisation % not found', p_org_id;
  end if;

  insert into awesome.invoices (
    org_id, invoice_number,
    issuer_id, issuer_name, issuer_abn,
    client_id, bill_to_name, bill_to_address_line,
    bill_to_suburb, bill_to_state, bill_to_postcode,
    invoice_date, internal_notes, created_by
  ) values (
    p_org_id, v_number,
    v_issuer.id, v_issuer.full_name, v_issuer.abn,
    v_client.id, v_client.name, v_client.address_line,
    v_client.suburb, v_client.state, v_client.postcode,
    p_invoice_date, p_internal_notes, p_created_by
  )
  returning * into v_invoice;

  insert into awesome.invoice_items
    (invoice_id, description, service_date, quantity, rate, sort_order)
  select
    v_invoice.id,
    coalesce(nullif(btrim(it->>'description'), ''), v_default),
    nullif(it->>'service_date', '')::date,
    coalesce(nullif(it->>'quantity', '')::numeric, 1),
    (it->>'rate')::numeric,
    (ord - 1)::int
  from jsonb_array_elements(p_items) with ordinality as t(it, ord);

  select * into v_invoice from awesome.invoices where id = v_invoice.id;
  return v_invoice;
end;
$$;

create or replace function awesome.update_invoice(
  p_id             uuid,
  p_client_id      uuid,
  p_issuer_id      uuid,
  p_invoice_date   date,
  p_items          jsonb,
  p_internal_notes text,
  p_org_id         uuid
)
returns awesome.invoices
language plpgsql security definer
set search_path to 'awesome', 'pg_catalog'
as $$
declare
  v_client  awesome.clients;
  v_issuer  awesome.issuers;
  v_invoice awesome.invoices;
  v_default text;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'update_invoice: at least one line item is required';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) e
    where nullif(e->>'rate', '') is null
  ) then
    raise exception 'update_invoice: every line item needs a rate';
  end if;

  select * into v_invoice from awesome.invoices
   where id = p_id and org_id = p_org_id;
  if not found then
    raise exception 'update_invoice: invoice % not found', p_id;
  end if;

  select * into v_client from awesome.clients
   where id = p_client_id and org_id = p_org_id;
  if not found then
    raise exception 'update_invoice: client % not found', p_client_id;
  end if;

  select * into v_issuer from awesome.issuers
   where id = p_issuer_id and org_id = p_org_id;
  if not found then
    raise exception 'update_invoice: issuer % not found', p_issuer_id;
  end if;

  select nullif(btrim(coalesce(o.default_service_description, '')), '')
    into v_default
    from awesome.orgs o where o.id = p_org_id;

  if v_default is null and exists (
    select 1 from jsonb_array_elements(p_items) e
    where nullif(btrim(coalesce(e->>'description', '')), '') is null
  ) then
    raise exception 'update_invoice: every line item needs a description';
  end if;

  update awesome.invoices set
    issuer_id            = v_issuer.id,
    issuer_name          = v_issuer.full_name,
    issuer_abn           = v_issuer.abn,
    client_id            = v_client.id,
    bill_to_name         = v_client.name,
    bill_to_address_line = v_client.address_line,
    bill_to_suburb       = v_client.suburb,
    bill_to_state        = v_client.state,
    bill_to_postcode     = v_client.postcode,
    invoice_date         = p_invoice_date,
    internal_notes       = p_internal_notes
  where id = p_id and org_id = p_org_id;

  delete from awesome.invoice_items where invoice_id = p_id;

  insert into awesome.invoice_items
    (invoice_id, description, service_date, quantity, rate, sort_order)
  select
    p_id,
    coalesce(nullif(btrim(it->>'description'), ''), v_default),
    nullif(it->>'service_date', '')::date,
    coalesce(nullif(it->>'quantity', '')::numeric, 1),
    (it->>'rate')::numeric,
    (ord - 1)::int
  from jsonb_array_elements(p_items) with ordinality as t(it, ord);

  select * into v_invoice from awesome.invoices where id = p_id;
  return v_invoice;
end;
$$;

-- ---------------------------------------------------------------------
-- 3b. A trial account can be closed by the person who owns it
--
-- Same deletion as the purge, triggered by a person instead of by the calendar,
-- and fenced the same way: is_demo is checked inside the function, so no
-- argument, no caller and no bug in the app can point this at Awesome. It
-- returns the name it deleted, which is how the caller knows it really ran.
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

  delete from awesome.invoice_items where org_id = p_org_id;
  delete from awesome.invoices     where org_id = p_org_id;
  delete from awesome.clients      where org_id = p_org_id;
  delete from awesome.issuers      where org_id = p_org_id;
  delete from awesome.agent_keys   where org_id = p_org_id;
  delete from awesome.org_members  where org_id = p_org_id;
  delete from awesome.orgs         where id     = p_org_id;

  return v_name;
end;
$$;

revoke all on function awesome.delete_demo_org(uuid) from public, anon, authenticated;
grant execute on function awesome.delete_demo_org(uuid) to service_role;

-- ---------------------------------------------------------------------
-- 4. A trial lasts a month, whether or not anybody used it
--
-- Decided 2026-08-10. These accounts exist so people can try the app, not so
-- the app can hold their data: keeping a busy trial alive forever meant keeping
-- somebody's clients and invoices forever, which is not what a trial is for.
-- Age since sign-up is now the only thing that matters, which is also the one
-- rule that can be stated in a sentence on the banner.
--
-- Unchanged, and the part that matters: is_demo is false for Awesome, so no
-- value of p_days can reach it.
-- ---------------------------------------------------------------------
create or replace function awesome.purge_stale_demo_orgs(p_days integer default 30)
returns table(purged_org_id uuid, purged_name text)
language plpgsql security definer
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
       and o.created_at < v_cutoff
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

-- ---------------------------------------------------------------------
-- 5. Lock the surface again
--
-- CREATE FUNCTION grants EXECUTE to PUBLIC by default, and every function here
-- is SECURITY DEFINER, so anything newly created or recreated has to be shut
-- again explicitly. Only service_role, which only the server holds, may call.
-- ---------------------------------------------------------------------
revoke all on function awesome.create_invoice(uuid, uuid, date, jsonb, text, text, uuid)
  from public, anon, authenticated;
grant execute on function awesome.create_invoice(uuid, uuid, date, jsonb, text, text, uuid)
  to service_role;

revoke all on function awesome.update_invoice(uuid, uuid, uuid, date, jsonb, text, uuid)
  from public, anon, authenticated;
grant execute on function awesome.update_invoice(uuid, uuid, uuid, date, jsonb, text, uuid)
  to service_role;

revoke all on function awesome.purge_stale_demo_orgs(integer) from public, anon, authenticated;
grant execute on function awesome.purge_stale_demo_orgs(integer) to service_role;
