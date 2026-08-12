-- ---------------------------------------------------------------------
--  2026-08-12 · What the fourth round of testing found
--
--  Andres installed a brand new business's agent kit from scratch and worked
--  through it as a stranger would. One thing here came back from that:
--
--  A client can be given a `default_description` ("the work normally done for
--  this client"), the API accepts it, the dashboard stores it, and then
--  create_invoice ignored it: a line with no description was refused unless the
--  ORGANISATION had a usual service set. The tool description promised the
--  opposite, so an agent that trusted it produced an error instead of an
--  invoice.
--
--  A blank line now falls back to the client's usual work first, then the
--  business's, and is only an error when neither exists. Everything else in
--  both functions is unchanged.
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
