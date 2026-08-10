-- What came out of the second round of testing (see § SEGUNDO TESTING in
-- plan_invitado.md), which Andres ran before any of the previous round was
-- committed.
--
-- 0. The purge can be aimed at one business, so a test stops deleting real
--    trial accounts, and it hands back the logo it deleted.
-- 1. A TFN can no longer be stored, an ABN is validated, and a company can
--    keep its ACN alongside it.
-- 2. GST: businesses registered for it now charge it, print it, and can see
--    what they owe the ATO this quarter.

-- ---------------------------------------------------------------------
-- 0. A purge you can aim
--
-- On 2026-08-10 running the test suite deleted a real guest account. The test
-- that proves Awesome survives called purge_stale_demo_orgs(p_days => 1)
-- against production, and that function does not distinguish a test business
-- from a real one: everything on a trial older than a day went with it, and the
-- test still passed, because all it checks is that Awesome is still standing.
--
-- The fix is an optional target. With p_org_id the purge considers exactly one
-- business, so a test can prove both halves of the rule (an old trial goes, and
-- Awesome never does) without ever touching anybody else's data. Left null it
-- behaves as before, which is what the daily cron wants.
--
-- It also returns the logo path now. The row is gone by the time the caller
-- runs, so guessing "<id>/logo.png" was the only thing left to try; guessing is
-- how files get left behind in the bucket forever.
-- ---------------------------------------------------------------------
drop function if exists awesome.purge_stale_demo_orgs(integer);

create function awesome.purge_stale_demo_orgs(
  p_days   integer default 30,
  p_org_id uuid    default null
)
returns table(purged_org_id uuid, purged_name text, purged_logo_path text)
language plpgsql security definer
set search_path to 'awesome', 'pg_catalog'
as $$
declare
  v_cutoff timestamptz := now() - make_interval(days => greatest(coalesce(p_days, 30), 1));
begin
  return query
  with doomed as (
    select o.id, o.name, o.logo_path
      from awesome.orgs o
     -- Age since sign-up, not activity. A trial exists so somebody can try the
     -- app, not so the app can hold their data: a busy trial kept alive forever
     -- would mean keeping somebody's clients and invoices forever.
     where o.is_demo
       and o.created_at < v_cutoff
       -- Null means every business that qualifies, which is what the daily cron
       -- asks for. Naming one narrows it to that one, and never widens it: the
       -- is_demo and age conditions above still have to hold.
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
  del_keys as (
    delete from awesome.agent_keys k where k.org_id in (select id from doomed) returning 1
  ),
  del_members as (
    delete from awesome.org_members m where m.org_id in (select id from doomed) returning 1
  ),
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

-- ---------------------------------------------------------------------
-- 1. The tax numbers, as Australia actually uses them
--
-- A TFN is a person's private tax number. It must never be printed on an
-- invoice, and this app offered it as one of three choices, sitting next to the
-- field whose value gets printed at the top of every document. It is gone.
--
-- What goes on an invoice is the ABN, eleven digits, and a company usually
-- shows its ACN, nine digits, as well. So the ABN stops being "whatever text
-- was typed" and the ACN gets a column of its own instead of sharing that one.
-- ---------------------------------------------------------------------
alter table awesome.issuers add column if not exists acn text;

alter table awesome.issuers drop constraint if exists issuers_acn_check;
alter table awesome.issuers add constraint issuers_acn_check
  check (acn is null or acn ~ '^[0-9]{9}$');

update awesome.orgs set tax_id_label = 'ABN' where tax_id_label = 'TFN';

alter table awesome.orgs drop constraint if exists orgs_tax_id_label_check;
alter table awesome.orgs add constraint orgs_tax_id_label_check
  check (tax_id_label = any (array['ABN'::text, 'ACN'::text]));

-- Digits are the number; spaces are how people read it out. Storing the
-- keystrokes would make "40 243 400 997" and "40243400997" two different
-- businesses to the unique index, so everything normalises through here.
create or replace function awesome.digits(p_text text)
returns text
language sql immutable
as $fn$ select regexp_replace(coalesce(p_text, ''), '\D', '', 'g') $fn$;

-- ---------------------------------------------------------------------
-- 1b. create_org learns about the ACN, and checks the ABN
--
-- Dropped and recreated rather than replaced: a new argument means a new
-- signature, and leaving both would give PostgREST two candidates and an error
-- (PGRST203), which is exactly what bit create_invoice a day ago.
-- ---------------------------------------------------------------------
drop function if exists awesome.create_org(
  uuid, text, text, text, text, text, text, text, text, text, text, text,
  text, text, text, text, text, text, text, integer, text
);

create function awesome.create_org(
  p_user_id      uuid,
  p_email        text,
  p_display_name text,
  p_name         text,
  p_issuer_name  text,
  p_tax_id       text,
  p_tax_id_label text default 'ABN',
  p_entity_type  text default 'sole_trader',
  p_address_line text default null,
  p_suburb       text default null,
  p_state        text default null,
  p_postcode     text default null,
  p_contact_email text default null,
  p_phone        text default null,
  p_bank_name         text default null,
  p_bank_bsb          text default null,
  p_bank_account_no   text default null,
  p_bank_account_name text default null,
  p_payment_note      text default null,
  p_terms_days   integer default 7,
  p_timezone     text default 'Australia/Sydney',
  p_acn          text default null
)
returns awesome.orgs
language plpgsql security definer
set search_path to 'awesome', 'pg_catalog'
as $fn$
declare
  v_org    awesome.orgs;
  v_abn    text := awesome.digits(p_tax_id);
  v_acn    text := nullif(awesome.digits(p_acn), '');
  v_name   text := btrim(coalesce(p_name, ''));
  v_issuer text := coalesce(nullif(btrim(coalesce(p_issuer_name, '')), ''), btrim(coalesce(p_name, '')));
begin
  if p_user_id is null then
    raise exception 'create_org: a signed-in user is required';
  end if;
  if v_name = '' then
    raise exception 'create_org: the business name is required';
  end if;
  if length(v_abn) <> 11 then
    raise exception 'create_org: an ABN is eleven digits';
  end if;
  if v_acn is not null and length(v_acn) <> 9 then
    raise exception 'create_org: an ACN is nine digits';
  end if;
  if exists (select 1 from awesome.org_members m where m.user_id = p_user_id) then
    raise exception 'create_org: this account already belongs to a business';
  end if;

  insert into awesome.orgs (
    name, display_name, entity_type, tax_id_label,
    address_line, suburb, state, postcode, email, phone,
    bank_name, bank_bsb, bank_account_no, bank_account_name, payment_note,
    terms_days, timezone, invoice_number_start, next_invoice_number, is_demo
  ) values (
    v_name, v_name,
    coalesce(p_entity_type, 'sole_trader'),
    case when p_tax_id_label = 'ACN' then 'ACN' else 'ABN' end,
    p_address_line, p_suburb, coalesce(p_state, 'NSW'), p_postcode,
    coalesce(p_contact_email, p_email), p_phone,
    p_bank_name, p_bank_bsb, p_bank_account_no, p_bank_account_name, p_payment_note,
    coalesce(p_terms_days, 7), coalesce(p_timezone, 'Australia/Sydney'),
    1, 1, true
  )
  returning * into v_org;

  insert into awesome.org_members (org_id, user_id, email, display_name, role)
  values (
    v_org.id, p_user_id, p_email,
    coalesce(nullif(btrim(coalesce(p_display_name, '')), ''), split_part(p_email, '@', 1)),
    'owner'
  );

  insert into awesome.issuers (org_id, full_name, short_name, abn, acn)
  values (v_org.id, v_issuer, left(v_issuer, 20), v_abn, v_acn);

  return v_org;
end;
$fn$;

-- ---------------------------------------------------------------------
-- 1c. Fixing the entity behind the invoices
--
-- Until now the ABN could be set once, at sign-up, and never corrected: a typo
-- meant a wrong number on every invoice with no way back. Editing it changes
-- nothing already issued, because an invoice snapshots issuer_name and
-- issuer_abn when it is created, the same way a line item snapshots its rate.
-- ---------------------------------------------------------------------
create or replace function awesome.update_issuer(
  p_org_id    uuid,
  p_issuer_id uuid,
  p_full_name text,
  p_abn       text,
  p_acn       text default null
)
returns awesome.issuers
language plpgsql security definer
set search_path to 'awesome', 'pg_catalog'
as $fn$
declare
  v_issuer awesome.issuers;
  v_abn    text := awesome.digits(p_abn);
  v_acn    text := nullif(awesome.digits(p_acn), '');
  v_name   text := btrim(coalesce(p_full_name, ''));
begin
  if p_org_id is null then
    raise exception 'update_issuer: p_org_id is required';
  end if;
  if v_name = '' then
    raise exception 'update_issuer: the name on the ABN is required';
  end if;
  if length(v_abn) <> 11 then
    raise exception 'update_issuer: an ABN is eleven digits';
  end if;
  if v_acn is not null and length(v_acn) <> 9 then
    raise exception 'update_issuer: an ACN is nine digits';
  end if;

  update awesome.issuers i
     set full_name  = v_name,
         short_name = left(v_name, 20),
         abn        = v_abn,
         acn        = v_acn
   where i.id = p_issuer_id
     and i.org_id = p_org_id
  returning * into v_issuer;

  if not found then
    raise exception 'update_issuer: no such entity in this business';
  end if;

  return v_issuer;
end;
$fn$;

revoke all on function awesome.digits(text) from public, anon, authenticated;
revoke all on function awesome.update_issuer(uuid, uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function awesome.create_org(
  uuid, text, text, text, text, text, text, text, text, text, text, text,
  text, text, text, text, text, text, text, integer, text, text
) from public, anon, authenticated;

grant execute on function awesome.digits(text) to service_role;
grant execute on function awesome.update_issuer(uuid, uuid, text, text, text)
  to service_role;
grant execute on function awesome.create_org(
  uuid, text, text, text, text, text, text, text, text, text, text, text,
  text, text, text, text, text, text, text, integer, text, text
) to service_role;

-- ---------------------------------------------------------------------
-- 2. GST
--
-- Australia's GST is 10%, and it is not a per-client matter: a registered
-- business collects it on its sales, subtracts what it paid on its purchases,
-- and settles the difference with the ATO in the BAS, usually every quarter.
-- So what a dashboard owes somebody is a running total, not a line on a
-- client's statement.
--
-- Prices here INCLUDE GST, which is how a small business quotes: the client
-- wants to know what they pay in total. That also means switching registration
-- on does not change what anything costs, only how the same amount is
-- explained: $110 becomes $100 plus $10 of GST.
--
-- The rate is frozen on the invoice, like the rate on a line item. Registering
-- today must not add tax to invoices sent last year, and deregistering must not
-- quietly remove it from invoices where it was charged.
-- ---------------------------------------------------------------------
alter table awesome.orgs
  add column if not exists gst_registered boolean not null default false;

alter table awesome.invoices
  add column if not exists gst_rate   numeric(5,4)  not null default 0,
  add column if not exists gst_amount numeric(10,2) not null default 0,
  add column if not exists paid_at    date,
  add column if not exists issuer_acn text;

-- Cash basis needs the day the money arrived, and until now nothing recorded
-- it. For invoices already marked paid the closest thing on record is when the
-- row was last touched, which is nearly always the moment somebody marked it
-- paid. Approximate for old rows, exact from here on.
update awesome.invoices
   set paid_at = (updated_at at time zone 'Australia/Sydney')::date
 where status = 'paid' and paid_at is null;

create index if not exists invoices_org_paid_at_idx
  on awesome.invoices (org_id, paid_at) where status = 'paid';

-- ---------------------------------------------------------------------
-- 2b. The one trigger that already normalises an invoice does the rest
--
-- Due dates, the paid/unpaid rule and the balance are settled here, so GST and
-- the payment date belong here too: every path into the table (the app, an
-- agent through the gateway, a hand-written UPDATE) gets the same answer.
-- ---------------------------------------------------------------------
create or replace function awesome.invoice_before_write()
returns trigger language plpgsql set search_path to '' as $function$
declare
  v_org_days integer;
  v_days     integer;
  v_gst      boolean;
begin
  select o.terms_days, o.gst_registered
    into v_org_days, v_gst
    from awesome.orgs o where o.id = new.org_id;
  v_org_days := coalesce(v_org_days, 7);

  if tg_op = 'INSERT' then
    v_days := v_org_days;
    new.terms := 'NET' || v_days;
    -- Frozen here and never touched again: the rate this invoice was issued
    -- under, not the rate the business happens to be on today.
    new.gst_rate := case when coalesce(v_gst, false) then 0.10 else 0 end;
  else
    v_days := coalesce(substring(new.terms from '^NET([0-9]+)$')::int, v_org_days);
  end if;

  if tg_op = 'INSERT' then
    if new.due_date is null then
      new.due_date := new.invoice_date + v_days;
    end if;
  else
    -- On UPDATE the due date follows a changed invoice_date, unless the caller
    -- explicitly supplied a different one: a manual override wins.
    if new.due_date is null then
      new.due_date := new.invoice_date + v_days;
    elsif new.invoice_date is distinct from old.invoice_date
          and new.due_date is not distinct from old.due_date then
      new.due_date := new.invoice_date + v_days;
    end if;
  end if;

  new.balance_due := new.total - new.paid_amount;
  if new.status <> 'cancelled' then
    -- Paid only once the whole invoice is covered; there is no partial state.
    if new.paid_amount > 0 and new.paid_amount >= new.total then
      new.status := 'paid';
    else
      new.status := 'unpaid';
    end if;
  end if;

  -- The price already contains the tax, so at 10% the GST is a eleventh of the
  -- total. Recomputed on every write because editing the lines changes it.
  new.gst_amount := round(
    new.total * coalesce(new.gst_rate, 0) / (1 + coalesce(new.gst_rate, 0)), 2
  );

  -- The day the money arrived, in the business's own timezone, which is what a
  -- cash-basis BAS counts. Cleared again if an invoice goes back to unpaid.
  if new.status = 'paid' then
    if new.paid_at is null then
      new.paid_at := awesome.org_today(new.org_id);
    end if;
  else
    new.paid_at := null;
  end if;

  new.updated_at := now();
  return new;
end $function$;

-- ---------------------------------------------------------------------
-- 2c. An invoice carries the ACN it was issued under, like the ABN
--
-- The drop is not decoration. The previous migration recreated this function
-- with its arguments in a different order from the one schema.sql documents,
-- and a different order is a different function to Postgres: recreating it
-- from schema.sql left two candidates with the same argument NAMES, and every
-- call came back PGRST203. schema.sql is the source of truth, so the other
-- order goes. Callers pass named arguments, so nothing outside notices.
-- ---------------------------------------------------------------------
drop function if exists awesome.create_invoice(uuid, uuid, date, jsonb, text, text, uuid);

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
as $fn$
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
$fn$;
