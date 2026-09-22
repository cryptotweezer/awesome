-- Clients that are never invoiced, and the rhythm each client is done on.
--
-- Awesome does not bill everyone it works for. Some clients are invoiced every
-- week and some pay cash and are never sent anything, and until now only the
-- first kind existed in the app, because the app only did invoicing. The
-- savings plan being built on top of it needs both: it is trying to answer how
-- much money should come in in a given week, and half that money belongs to
-- clients the invoicing side has never heard of.
--
-- They go in `clients` rather than in a table of their own. They ARE clients:
-- they have a name, an address, an agreed rate and a history. Splitting them
-- would mean every record the savings plan keeps (who is due this week, who
-- paid, what came in) would have to point at one of two possible parents, and
-- that shape breeds bugs for no gain.
--
-- The cost of one table is that a cash client must never leak into invoicing,
-- and a default is not a wall. So `create_invoice` and `update_invoice` refuse
-- one outright. The application filters them out of the pickers, but the
-- application is not the guarantee: this is. An agent, a REST call, a page
-- written next year, none of them can bill somebody who was never meant to be
-- billed.
--
-- Nothing changes for anyone existing. Every client already in the database,
-- Awesome's and every guest business's, takes the defaults and stays exactly
-- what it was: invoiced, weekly.

alter table awesome.clients
  -- 'invoice' = sent an invoice, appears in the history and on documents.
  -- 'cash'    = paid in person, invisible to the invoicing side entirely.
  add column if not exists billing_type text not null default 'invoice',
  -- How often this client is normally done. Weekly and fortnightly are the
  -- rotation; the rest are placed in the week they actually happened.
  add column if not exists cadence text not null default 'weekly',
  -- Only meaningful when cadence = 'every_n_weeks'.
  add column if not exists cadence_weeks integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'clients_billing_type_check'
  ) then
    alter table awesome.clients
      add constraint clients_billing_type_check
      check (billing_type in ('invoice', 'cash'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'clients_cadence_check'
  ) then
    alter table awesome.clients
      add constraint clients_cadence_check
      check (cadence in ('weekly', 'fortnightly', 'monthly', 'every_n_weeks'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'clients_cadence_weeks_check'
  ) then
    alter table awesome.clients
      add constraint clients_cadence_weeks_check
      check (
        case when cadence = 'every_n_weeks'
          then cadence_weeks is not null and cadence_weeks between 1 and 52
          else true
        end
      );
  end if;
end $$;

comment on column awesome.clients.billing_type is
  'invoice = billed and sent documents; cash = paid in person and never invoiced. A cash client is refused by create_invoice and update_invoice.';
comment on column awesome.clients.cadence is
  'How often this client is normally done. Drives the savings plan, not the invoicing.';

-- ---------------------------------------------------------------------
--  The wall between the two kinds of client.
--
--  One function so there is one refusal and one wording, and so adding a
--  third caller later cannot accidentally ship without it.
-- ---------------------------------------------------------------------

create or replace function awesome.assert_invoiceable(p_client awesome.clients)
returns void
language plpgsql immutable
set search_path to 'awesome', 'pg_catalog'
as $$
begin
  if p_client.billing_type = 'cash' then
    raise exception
      '% is a cash client and is never invoiced. Cash clients are tracked in the savings plan, not in billing. Change them to an invoiced client first if that is what you meant.',
      p_client.name;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
--  create_invoice / update_invoice, unchanged but for the refusal.
--
--  Replaced whole rather than patched, because the body is the definition:
--  there is nowhere else to read what these do.
-- ---------------------------------------------------------------------

create or replace function awesome.create_invoice(
  p_client_id      uuid,
  p_issuer_id      uuid,
  p_invoice_date   date,
  p_created_by     text,
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
  perform awesome.assert_invoiceable(v_client);

  select * into v_issuer from awesome.issuers
   where id = p_issuer_id and org_id = p_org_id;
  if not found then
    raise exception 'create_invoice: issuer % not found', p_issuer_id;
  end if;

  -- A blank line falls back to the work normally done for THIS client, then to
  -- what the business always sells. With neither, a line that says nothing is
  -- an error rather than something to guess at.
  select coalesce(
           nullif(btrim(coalesce(v_client.default_description, '')), ''),
           nullif(btrim(coalesce(o.default_service_description, '')), '')
         )
    into v_default
    from awesome.orgs o where o.id = p_org_id;

  if v_default is null and exists (
    select 1 from jsonb_array_elements(p_items) e
    where nullif(btrim(coalesce(e->>'description', '')), '') is null
  ) then
    raise exception 'create_invoice: every line item needs a description saying what the work was';
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
    issuer_id, issuer_name, issuer_abn, issuer_acn,
    client_id, bill_to_name, bill_to_address_line,
    bill_to_suburb, bill_to_state, bill_to_postcode,
    invoice_date, internal_notes, created_by
  ) values (
    p_org_id, v_number,
    v_issuer.id, v_issuer.full_name, v_issuer.abn, v_issuer.acn,
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
  perform awesome.assert_invoiceable(v_client);

  select * into v_issuer from awesome.issuers
   where id = p_issuer_id and org_id = p_org_id;
  if not found then
    raise exception 'update_invoice: issuer % not found', p_issuer_id;
  end if;

  select coalesce(
           nullif(btrim(coalesce(v_client.default_description, '')), ''),
           nullif(btrim(coalesce(o.default_service_description, '')), '')
         )
    into v_default
    from awesome.orgs o where o.id = p_org_id;

  if v_default is null and exists (
    select 1 from jsonb_array_elements(p_items) e
    where nullif(btrim(coalesce(e->>'description', '')), '') is null
  ) then
    raise exception 'update_invoice: every line item needs a description saying what the work was';
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

revoke execute on function awesome.assert_invoiceable(awesome.clients) from public, anon, authenticated;
revoke execute on function awesome.create_invoice(uuid, uuid, date, text, jsonb, text, uuid) from public, anon, authenticated;
revoke execute on function awesome.update_invoice(uuid, uuid, uuid, date, jsonb, text, uuid) from public, anon, authenticated;

grant execute on function awesome.assert_invoiceable(awesome.clients) to service_role;
grant execute on function awesome.create_invoice(uuid, uuid, date, text, jsonb, text, uuid) to service_role;
grant execute on function awesome.update_invoice(uuid, uuid, uuid, date, jsonb, text, uuid) to service_role;
