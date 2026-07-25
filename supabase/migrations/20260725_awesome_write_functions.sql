-- Phase 1: atomic write functions for schema `awesome`.
--
-- Why: today the multi-step write logic lives in TypeScript
-- (src/lib/data/invoices.ts). Moving it into the DB makes every write atomic
-- and lets the app be the ONLY caller, so the rules are enforced, not advisory.
--
-- Design notes:
--   * The heavy business rules stay in the existing triggers
--     (invoice_before_write -> due_date + status + balance_due,
--      item_before_write -> line amount, recalc_invoice_totals -> subtotal/total).
--     These functions only orchestrate the multi-step writes in one transaction.
--   * SECURITY DEFINER + pinned search_path, EXECUTE revoked from PUBLIC and
--     granted to service_role only. Definer functions bypass RLS, so they must
--     never be reachable by anon/authenticated.
--   * p_created_by is required so every invoice is signed by its author
--     ('Ema', 'Claude', 'Codex', ...).
--   * p_invoice_date is required (no CURRENT_DATE default) because CURRENT_DATE
--     is the server's UTC day and would shift the Sydney financial-year cut-off.
--     Callers pass todayInSydney().
--   * No partial payments: mark_paid sets paid_amount = total, mark_unpaid = 0,
--     and the trigger derives the status.

-- ---------------------------------------------------------------------------
-- create_invoice
-- ---------------------------------------------------------------------------
create or replace function awesome.create_invoice(
  p_client_id      uuid,
  p_issuer_id      uuid,
  p_invoice_date   date,
  p_created_by     text,
  p_items          jsonb,
  p_internal_notes text default null
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

  select * into v_client from awesome.clients where id = p_client_id;
  if not found then
    raise exception 'create_invoice: client % not found', p_client_id;
  end if;

  select * into v_issuer from awesome.issuers where id = p_issuer_id;
  if not found then
    raise exception 'create_invoice: issuer % not found', p_issuer_id;
  end if;

  insert into awesome.invoices (
    issuer_id, issuer_name, issuer_abn,
    client_id, bill_to_name, bill_to_address_line,
    bill_to_suburb, bill_to_state, bill_to_postcode,
    invoice_date, internal_notes, created_by
  ) values (
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
-- invoice_number and created_by are never touched.
-- ---------------------------------------------------------------------------
create or replace function awesome.update_invoice(
  p_id             uuid,
  p_client_id      uuid,
  p_issuer_id      uuid,
  p_invoice_date   date,
  p_items          jsonb,
  p_internal_notes text default null
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

  select * into v_invoice from awesome.invoices where id = p_id;
  if not found then
    raise exception 'update_invoice: invoice % not found', p_id;
  end if;

  select * into v_client from awesome.clients where id = p_client_id;
  if not found then
    raise exception 'update_invoice: client % not found', p_client_id;
  end if;

  select * into v_issuer from awesome.issuers where id = p_issuer_id;
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
  where id = p_id;

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
create or replace function awesome.mark_paid(p_id uuid)
returns awesome.invoices
language plpgsql
security definer
set search_path to 'awesome', 'pg_catalog'
as $$
declare v_invoice awesome.invoices;
begin
  select * into v_invoice from awesome.invoices where id = p_id;
  if not found then
    raise exception 'mark_paid: invoice % not found', p_id;
  end if;
  if v_invoice.status = 'cancelled' then
    raise exception 'mark_paid: invoice % is cancelled, reactivate it first', p_id;
  end if;

  update awesome.invoices set paid_amount = total where id = p_id
  returning * into v_invoice;
  return v_invoice;
end;
$$;

create or replace function awesome.mark_unpaid(p_id uuid)
returns awesome.invoices
language plpgsql
security definer
set search_path to 'awesome', 'pg_catalog'
as $$
declare v_invoice awesome.invoices;
begin
  select * into v_invoice from awesome.invoices where id = p_id;
  if not found then
    raise exception 'mark_unpaid: invoice % not found', p_id;
  end if;
  if v_invoice.status = 'cancelled' then
    raise exception 'mark_unpaid: invoice % is cancelled, reactivate it first', p_id;
  end if;

  update awesome.invoices set paid_amount = 0 where id = p_id
  returning * into v_invoice;
  return v_invoice;
end;
$$;

-- ---------------------------------------------------------------------------
-- cancel_invoice / reactivate_invoice: status only, number is kept.
-- Cancelling keeps the number; reactivating writes a non-cancelled status so
-- the trigger re-derives paid/unpaid from paid_amount.
-- ---------------------------------------------------------------------------
create or replace function awesome.cancel_invoice(p_id uuid)
returns awesome.invoices
language plpgsql
security definer
set search_path to 'awesome', 'pg_catalog'
as $$
declare v_invoice awesome.invoices;
begin
  update awesome.invoices set status = 'cancelled' where id = p_id
  returning * into v_invoice;
  if not found then
    raise exception 'cancel_invoice: invoice % not found', p_id;
  end if;
  return v_invoice;
end;
$$;

create or replace function awesome.reactivate_invoice(p_id uuid)
returns awesome.invoices
language plpgsql
security definer
set search_path to 'awesome', 'pg_catalog'
as $$
declare v_invoice awesome.invoices;
begin
  update awesome.invoices set status = 'unpaid' where id = p_id
  returning * into v_invoice;
  if not found then
    raise exception 'reactivate_invoice: invoice % not found', p_id;
  end if;
  return v_invoice;
end;
$$;

-- ---------------------------------------------------------------------------
-- Lock the surface: definer functions must not be callable by anon/authenticated.
-- ---------------------------------------------------------------------------
revoke execute on function awesome.create_invoice(uuid, uuid, date, text, jsonb, text) from public;
revoke execute on function awesome.update_invoice(uuid, uuid, uuid, date, jsonb, text) from public;
revoke execute on function awesome.mark_paid(uuid)          from public;
revoke execute on function awesome.mark_unpaid(uuid)        from public;
revoke execute on function awesome.cancel_invoice(uuid)     from public;
revoke execute on function awesome.reactivate_invoice(uuid) from public;

grant execute on function awesome.create_invoice(uuid, uuid, date, text, jsonb, text) to service_role;
grant execute on function awesome.update_invoice(uuid, uuid, uuid, date, jsonb, text) to service_role;
grant execute on function awesome.mark_paid(uuid)          to service_role;
grant execute on function awesome.mark_unpaid(uuid)        to service_role;
grant execute on function awesome.cancel_invoice(uuid)     to service_role;
grant execute on function awesome.reactivate_invoice(uuid) to service_role;
