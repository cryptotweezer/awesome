-- Multi-tenant, step 3a of 3: the write path becomes organisation-aware.
--
-- Replaces the six write functions from 20260725_awesome_write_functions.sql
-- plus delete_invoice and peek_next_invoice_number from 00000000_base_schema.sql.
--
-- Three rules drive every change below:
--
--   1. An id is not permission. Every function now takes p_org_id and every
--      lookup filters on it, so knowing (or guessing) another organisation's
--      uuid buys nothing. This is the single most important property of the
--      whole multi-tenant migration.
--   2. p_org_id carries a DEFAULT of the Awesome organisation *for now*, purely
--      so the currently deployed app and the five live agents keep working
--      between this migration and the next deploy. The default is removed in
--      F1.7. While it exists, a caller that forgets the org silently writes
--      into Awesome, so it must not outlive the deploy.
--   3. The old global sequence is gone. Numbers now come from
--      orgs.next_invoice_number, bumped inside the same statement that reads
--      it, so the row lock serialises concurrent inserts of one organisation
--      and of no other.

-- The write functions gain a parameter, so the old signatures have to go:
-- leaving them in place would create overloads, and a six-argument call would
-- quietly resolve to the unscoped version.
drop function if exists awesome.create_invoice(uuid, uuid, date, text, jsonb, text);
drop function if exists awesome.update_invoice(uuid, uuid, uuid, date, jsonb, text);
drop function if exists awesome.mark_paid(uuid);
drop function if exists awesome.mark_unpaid(uuid);
drop function if exists awesome.cancel_invoice(uuid);
drop function if exists awesome.reactivate_invoice(uuid);
drop function if exists awesome.delete_invoice(uuid);
drop function if exists awesome.peek_next_invoice_number();

-- ---------------------------------------------------------------------------
-- Payment terms come from the organisation instead of a hardcoded 7.
--
-- On INSERT the term is taken from the organisation and STAMPED on the invoice
-- ('NET7', 'NET14', ...). On UPDATE the invoice's own stamp wins, so changing
-- the organisation's terms later never rewrites the history of past invoices,
-- exactly like a client's rate never rewrites past line items.
-- ---------------------------------------------------------------------------
create or replace function awesome.invoice_before_write()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  v_org_days integer;
  v_days     integer;
begin
  select o.terms_days into v_org_days from awesome.orgs o where o.id = new.org_id;
  v_org_days := coalesce(v_org_days, 7);

  if tg_op = 'INSERT' then
    v_days := v_org_days;
    new.terms := 'NET' || v_days;
  else
    -- Reuse whatever this invoice was issued under; fall back only if the
    -- stamp is not in the NET<n> shape.
    v_days := coalesce(substring(new.terms from '^NET([0-9]+)$')::int, v_org_days);
  end if;

  -- due_date follows the term. On INSERT it is derived when not given.
  -- On UPDATE it must FOLLOW a changed invoice_date, unless the caller
  -- explicitly supplied a different due_date (manual override wins).
  if tg_op = 'INSERT' then
    if new.due_date is null then
      new.due_date := new.invoice_date + v_days;
    end if;
  else
    if new.due_date is null then
      new.due_date := new.invoice_date + v_days;
    elsif new.invoice_date is distinct from old.invoice_date
          and new.due_date is not distinct from old.due_date then
      new.due_date := new.invoice_date + v_days;
    end if;
  end if;

  new.balance_due := new.total - new.paid_amount;
  if new.status <> 'cancelled' then
    -- Paid only once the whole invoice is covered; no partial state.
    if new.paid_amount > 0 and new.paid_amount >= new.total then
      new.status := 'paid';
    else
      new.status := 'unpaid';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $function$;

-- ---------------------------------------------------------------------------
-- Quotas live in the database, not in the UI.
--
-- A guest's agent talks straight to the gateway and never renders a form, so a
-- limit that only exists in React is not a limit. One trigger function serves
-- the three capped tables; a null cap (the real business) means unlimited.
-- ---------------------------------------------------------------------------
create or replace function awesome.enforce_quota()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  v_cap   integer;
  v_count integer;
  v_what  text := tg_argv[0];
begin
  select case v_what
           when 'invoices'   then o.max_invoices
           when 'clients'    then o.max_clients
           when 'agent_keys' then o.max_agent_keys
         end
    into v_cap
    from awesome.orgs o
   where o.id = new.org_id;

  if v_cap is null then
    return new;   -- unlimited, or an org row that does not exist yet
  end if;

  execute format('select count(*) from awesome.%I where org_id = $1', v_what)
     into v_count using new.org_id;

  if v_count >= v_cap then
    raise exception
      'Trial limit reached: this organisation can have at most % %. Delete one, or install the app on your own database to remove the limit.',
      v_cap, replace(v_what, '_', ' ');
  end if;

  return new;
end $function$;

drop trigger if exists trg_invoices_quota on awesome.invoices;
create trigger trg_invoices_quota
  before insert on awesome.invoices
  for each row execute function awesome.enforce_quota('invoices');

drop trigger if exists trg_clients_quota on awesome.clients;
create trigger trg_clients_quota
  before insert on awesome.clients
  for each row execute function awesome.enforce_quota('clients');

drop trigger if exists trg_agent_keys_quota on awesome.agent_keys;
create trigger trg_agent_keys_quota
  before insert on awesome.agent_keys
  for each row execute function awesome.enforce_quota('agent_keys');

-- ---------------------------------------------------------------------------
-- create_invoice
-- ---------------------------------------------------------------------------
create or replace function awesome.create_invoice(
  p_client_id      uuid,
  p_issuer_id      uuid,
  p_invoice_date   date,
  p_created_by     text,
  p_items          jsonb,
  p_internal_notes text default null,
  p_org_id         uuid default '00000000-0000-0000-0000-000000000001'
)
returns awesome.invoices
language plpgsql
security definer
set search_path to 'awesome', 'pg_catalog'
as $$
declare
  v_client  awesome.clients;
  v_issuer  awesome.issuers;
  v_invoice awesome.invoices;
  v_number  integer;
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

  -- Scoped lookups: a client or issuer from another organisation reads as
  -- missing, which is exactly what it should be from here.
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

  -- Take the next number and advance the counter in one statement. The row
  -- lock this takes is per organisation, so two businesses never wait on each
  -- other and neither can be handed the same number twice.
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
    coalesce(nullif(btrim(it->>'description'), ''), 'Cleaning Service'),
    nullif(it->>'service_date', '')::date,
    coalesce(nullif(it->>'quantity', '')::numeric, 1),
    (it->>'rate')::numeric,
    (ord - 1)::int
  from jsonb_array_elements(p_items) with ordinality as t(it, ord);

  -- re-read so trigger-computed totals/status come back to the caller
  select * into v_invoice from awesome.invoices where id = v_invoice.id;
  return v_invoice;
end;
$$;

-- ---------------------------------------------------------------------------
-- update_invoice: re-snapshot client + issuer, fully replace line items.
-- invoice_number, org_id and created_by are never touched.
-- ---------------------------------------------------------------------------
create or replace function awesome.update_invoice(
  p_id             uuid,
  p_client_id      uuid,
  p_issuer_id      uuid,
  p_invoice_date   date,
  p_items          jsonb,
  p_internal_notes text default null,
  p_org_id         uuid default '00000000-0000-0000-0000-000000000001'
)
returns awesome.invoices
language plpgsql
security definer
set search_path to 'awesome', 'pg_catalog'
as $$
declare
  v_client  awesome.clients;
  v_issuer  awesome.issuers;
  v_invoice awesome.invoices;
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
    coalesce(nullif(btrim(it->>'description'), ''), 'Cleaning Service'),
    nullif(it->>'service_date', '')::date,
    coalesce(nullif(it->>'quantity', '')::numeric, 1),
    (it->>'rate')::numeric,
    (ord - 1)::int
  from jsonb_array_elements(p_items) with ordinality as t(it, ord);

  select * into v_invoice from awesome.invoices where id = p_id;
  return v_invoice;
end;
$$;

-- ---------------------------------------------------------------------------
-- mark_paid / mark_unpaid: no partial payments, the trigger derives status.
-- ---------------------------------------------------------------------------
create or replace function awesome.mark_paid(
  p_id     uuid,
  p_org_id uuid default '00000000-0000-0000-0000-000000000001'
)
returns awesome.invoices
language plpgsql
security definer
set search_path to 'awesome', 'pg_catalog'
as $$
declare v_invoice awesome.invoices;
begin
  select * into v_invoice from awesome.invoices
   where id = p_id and org_id = p_org_id;
  if not found then
    raise exception 'mark_paid: invoice % not found', p_id;
  end if;
  if v_invoice.status = 'cancelled' then
    raise exception 'mark_paid: invoice % is cancelled, reactivate it first', p_id;
  end if;

  update awesome.invoices set paid_amount = total
   where id = p_id and org_id = p_org_id
  returning * into v_invoice;
  return v_invoice;
end;
$$;

create or replace function awesome.mark_unpaid(
  p_id     uuid,
  p_org_id uuid default '00000000-0000-0000-0000-000000000001'
)
returns awesome.invoices
language plpgsql
security definer
set search_path to 'awesome', 'pg_catalog'
as $$
declare v_invoice awesome.invoices;
begin
  select * into v_invoice from awesome.invoices
   where id = p_id and org_id = p_org_id;
  if not found then
    raise exception 'mark_unpaid: invoice % not found', p_id;
  end if;
  if v_invoice.status = 'cancelled' then
    raise exception 'mark_unpaid: invoice % is cancelled, reactivate it first', p_id;
  end if;

  update awesome.invoices set paid_amount = 0
   where id = p_id and org_id = p_org_id
  returning * into v_invoice;
  return v_invoice;
end;
$$;

-- ---------------------------------------------------------------------------
-- cancel_invoice / reactivate_invoice: status only, number is kept.
-- ---------------------------------------------------------------------------
create or replace function awesome.cancel_invoice(
  p_id     uuid,
  p_org_id uuid default '00000000-0000-0000-0000-000000000001'
)
returns awesome.invoices
language plpgsql
security definer
set search_path to 'awesome', 'pg_catalog'
as $$
declare v_invoice awesome.invoices;
begin
  update awesome.invoices set status = 'cancelled'
   where id = p_id and org_id = p_org_id
  returning * into v_invoice;
  if not found then
    raise exception 'cancel_invoice: invoice % not found', p_id;
  end if;
  return v_invoice;
end;
$$;

create or replace function awesome.reactivate_invoice(
  p_id     uuid,
  p_org_id uuid default '00000000-0000-0000-0000-000000000001'
)
returns awesome.invoices
language plpgsql
security definer
set search_path to 'awesome', 'pg_catalog'
as $$
declare v_invoice awesome.invoices;
begin
  update awesome.invoices set status = 'unpaid'
   where id = p_id and org_id = p_org_id
  returning * into v_invoice;
  if not found then
    raise exception 'reactivate_invoice: invoice % not found', p_id;
  end if;
  return v_invoice;
end;
$$;

-- ---------------------------------------------------------------------------
-- Numbering, now per organisation.
--
-- Deleting still reclaims the number: the counter drops back so the next
-- invoice reuses it. Cancelling, by contrast, keeps the number spent. The
-- floor is the organisation's own starting point (1945 here, 1 for a new one).
-- ---------------------------------------------------------------------------
create or replace function awesome.delete_invoice(
  p_id     uuid,
  p_org_id uuid default '00000000-0000-0000-0000-000000000001'
)
returns void
language plpgsql
security definer
set search_path to 'awesome', 'pg_catalog'
as $$
declare
  v_deleted integer;
begin
  delete from awesome.invoice_items
   where invoice_id = p_id
     and org_id = p_org_id;

  delete from awesome.invoices
   where id = p_id and org_id = p_org_id;
  get diagnostics v_deleted = row_count;
  if v_deleted = 0 then
    raise exception 'delete_invoice: invoice % not found', p_id;
  end if;

  update awesome.orgs o
     set next_invoice_number = greatest(
           o.invoice_number_start,
           coalesce((select max(i.invoice_number) + 1
                       from awesome.invoices i
                      where i.org_id = p_org_id), o.invoice_number_start)
         )
   where o.id = p_org_id;
end;
$$;

-- Form preview only: what the next invoice will be numbered, without taking it.
create or replace function awesome.peek_next_invoice_number(
  p_org_id uuid default '00000000-0000-0000-0000-000000000001'
)
returns bigint
language sql
stable
security definer
set search_path to 'awesome', 'pg_catalog'
as $$
  select next_invoice_number::bigint from awesome.orgs where id = p_org_id;
$$;

-- The global sequence no longer decides anything. The object itself is dropped
-- in F1.9, once there is no chance of needing to roll back to it.
alter table awesome.invoices alter column invoice_number drop default;

-- ---------------------------------------------------------------------------
-- Lock the surface: definer functions must not be callable by anon/authenticated.
-- ---------------------------------------------------------------------------
revoke execute on function awesome.create_invoice(uuid, uuid, date, text, jsonb, text, uuid) from public;
revoke execute on function awesome.update_invoice(uuid, uuid, uuid, date, jsonb, text, uuid) from public;
revoke execute on function awesome.mark_paid(uuid, uuid)          from public;
revoke execute on function awesome.mark_unpaid(uuid, uuid)        from public;
revoke execute on function awesome.cancel_invoice(uuid, uuid)     from public;
revoke execute on function awesome.reactivate_invoice(uuid, uuid) from public;
revoke execute on function awesome.delete_invoice(uuid, uuid)     from public;
revoke execute on function awesome.peek_next_invoice_number(uuid) from public;

grant execute on function awesome.create_invoice(uuid, uuid, date, text, jsonb, text, uuid) to service_role;
grant execute on function awesome.update_invoice(uuid, uuid, uuid, date, jsonb, text, uuid) to service_role;
grant execute on function awesome.mark_paid(uuid, uuid)          to service_role;
grant execute on function awesome.mark_unpaid(uuid, uuid)        to service_role;
grant execute on function awesome.cancel_invoice(uuid, uuid)     to service_role;
grant execute on function awesome.reactivate_invoice(uuid, uuid) to service_role;
grant execute on function awesome.delete_invoice(uuid, uuid)     to service_role;
grant execute on function awesome.peek_next_invoice_number(uuid) to service_role;
