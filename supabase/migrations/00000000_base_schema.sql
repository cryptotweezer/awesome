-- Base schema for `awesome`, reconstructed from the live database on 2026-08-09.
--
-- WHY THIS FILE EXISTS
-- The tables, the sequence, the triggers and two of the functions were applied
-- through the Supabase MCP in July 2026 and never written down here, so the only
-- copy lived inside the running database. This file closes that hole before the
-- multi-tenant migration touches any of it.
--
-- It is dated 00000000 because it precedes every other migration in this folder:
-- the `2026072x_*.sql` files ADD functions on top of what is created here.
--
-- Faithful to production as of 2026-08-09 (sequence at last_value 1960, so the
-- next invoice is #1961). Running it on an empty database reproduces the schema
-- but not the data.

create schema if not exists awesome;

-- ---------------------------------------------------------------------------
-- Sequence. First real invoice is #1945, so the sequence starts there.
-- ---------------------------------------------------------------------------
create sequence if not exists awesome.invoice_number_seq
  as integer start with 1945 increment by 1 no maxvalue no minvalue cache 1;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- One row only, enforced by the check. Holds the printed business identity,
-- the bank details and the two email templates the gateway fills in.
create table if not exists awesome.company_profile (
  id                         integer not null default 1,
  business_name              text    not null default 'Awesome Cleaning Services',
  address_line               text    not null,
  suburb                     text    not null,
  state                      text    not null,
  postcode                   text    not null,
  email                      text    not null,
  phone                      text    not null,
  bank_name                  text    not null,
  bank_bsb                   text    not null,
  bank_account_no            text    not null,
  bank_account_name          text    not null,
  payment_note               text    not null,
  email_subject_template     text    not null default 'Invoice {invoice_list} from {business_name}',
  email_body_template        text    not null default 'Hi {client_name},

Please find attached invoice {invoice_list} from {business_name}. Payment details are on the invoice; if you have any questions, just reply to this email.

Thanks,
{business_name}',
  statement_subject_template text    not null default 'Account statement from {business_name}',
  statement_body_template    text    not null default 'Hi {client_name},

Please find attached your current account statement from {business_name}, showing the invoices still outstanding. Payment details are on each invoice; if you have any questions, just reply to this email.

Thanks,
{business_name}',
  constraint company_profile_pkey primary key (id),
  constraint company_profile_singleton check (id = 1)
);

-- The ABN holders. Two rows: Mavi and Andres.
create table if not exists awesome.issuers (
  id         uuid        not null default gen_random_uuid(),
  full_name  text        not null,
  short_name text        not null,
  abn        text        not null,
  is_active  boolean     not null default true,
  created_at timestamptz not null default now(),
  constraint issuers_pkey primary key (id),
  constraint issuers_abn_key unique (abn)
);

create table if not exists awesome.clients (
  id                  uuid          not null default gen_random_uuid(),
  name                text          not null,
  address_line        text,
  suburb              text,
  state               text          default 'NSW',
  postcode            text,
  email               text,
  default_issuer_id   uuid,
  default_description text          not null default 'Cleaning Service',
  default_rate        numeric(10,2),
  is_active           boolean       not null default true,
  created_at          timestamptz   not null default now(),
  constraint clients_pkey primary key (id),
  constraint clients_default_issuer_id_fkey foreign key (default_issuer_id)
    references awesome.issuers(id)
);

-- issuer_name / issuer_abn and the bill_to_* columns are SNAPSHOTS taken at
-- creation time: editing a client or an issuer must never rewrite history.
create table if not exists awesome.invoices (
  id                   uuid          not null default gen_random_uuid(),
  invoice_number       integer       not null default nextval('awesome.invoice_number_seq'::regclass),
  issuer_id            uuid          not null,
  issuer_name          text          not null,
  issuer_abn           text          not null,
  client_id            uuid,
  bill_to_name         text          not null,
  bill_to_address_line text,
  bill_to_suburb       text,
  bill_to_state        text,
  bill_to_postcode     text,
  invoice_date         date          not null default current_date,
  terms                text          not null default 'NET7',
  due_date             date,
  currency             text          not null default 'AUD',
  subtotal             numeric(10,2) not null default 0,
  total                numeric(10,2) not null default 0,
  paid_amount          numeric(10,2) not null default 0,
  balance_due          numeric(10,2) not null default 0,
  status               text          not null default 'unpaid',
  internal_notes       text,
  created_at           timestamptz   not null default now(),
  updated_at           timestamptz   not null default now(),
  created_by           text,
  constraint invoices_pkey primary key (id),
  constraint invoices_invoice_number_key unique (invoice_number),
  constraint invoices_status_check check (status = any (array['unpaid'::text, 'paid'::text, 'cancelled'::text])),
  constraint invoices_issuer_id_fkey foreign key (issuer_id) references awesome.issuers(id),
  constraint invoices_client_id_fkey foreign key (client_id) references awesome.clients(id)
);

create table if not exists awesome.invoice_items (
  id           uuid          not null default gen_random_uuid(),
  invoice_id   uuid          not null,
  description  text          not null default 'Cleaning Service',
  service_date date,
  quantity     numeric(10,2) not null default 1,
  rate         numeric(10,2) not null,
  amount       numeric(10,2) not null default 0,
  sort_order   integer       not null default 0,
  created_at   timestamptz   not null default now(),
  constraint invoice_items_pkey primary key (id),
  constraint invoice_items_invoice_id_fkey foreign key (invoice_id)
    references awesome.invoices(id) on delete cascade
);

-- One row per AI agent. Only the hash is stored; the raw key is shown once.
-- See 20260725_agent_keys.sql, kept here so this file stands alone.
create table if not exists awesome.agent_keys (
  id           uuid        not null default gen_random_uuid(),
  label        text        not null,
  key_hash     text        not null,
  is_active    boolean     not null default true,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  constraint agent_keys_pkey primary key (id),
  constraint agent_keys_key_hash_key unique (key_hash)
);

-- ---------------------------------------------------------------------------
-- RLS on, no policies: only the service_role client reaches this data, and only
-- from the server. Anon and authenticated see nothing at all.
-- ---------------------------------------------------------------------------
alter table awesome.company_profile enable row level security;
alter table awesome.issuers         enable row level security;
alter table awesome.clients         enable row level security;
alter table awesome.invoices        enable row level security;
alter table awesome.invoice_items   enable row level security;
alter table awesome.agent_keys      enable row level security;

grant usage on schema awesome to service_role;
grant all on all tables in schema awesome to service_role;
grant all on all sequences in schema awesome to service_role;

-- ---------------------------------------------------------------------------
-- Triggers. These hold three business rules that exist nowhere in the app code:
-- the 7-day term, the paid/unpaid derivation, and the line-item maths.
-- ---------------------------------------------------------------------------

create or replace function awesome.invoice_before_write()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  -- due_date follows the 7-day term. On INSERT it is derived when not given.
  -- On UPDATE it must FOLLOW a changed invoice_date, unless the caller
  -- explicitly supplied a different due_date (manual override wins).
  if tg_op = 'INSERT' then
    if new.due_date is null then
      new.due_date := new.invoice_date + 7;
    end if;
  else
    if new.due_date is null then
      new.due_date := new.invoice_date + 7;
    elsif new.invoice_date is distinct from old.invoice_date
          and new.due_date is not distinct from old.due_date then
      new.due_date := new.invoice_date + 7;
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

create or replace function awesome.item_before_write()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  new.amount := round(new.quantity * new.rate, 2);
  return new;
end $function$;

create or replace function awesome.recalc_invoice_totals()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare inv uuid := coalesce(new.invoice_id, old.invoice_id); s numeric(10,2);
begin
  select coalesce(sum(amount),0) into s from awesome.invoice_items where invoice_id = inv;
  update awesome.invoices set subtotal = s, total = s where id = inv;
  return null;
end $function$;

drop trigger if exists trg_invoice_before_write on awesome.invoices;
create trigger trg_invoice_before_write
  before insert or update on awesome.invoices
  for each row execute function awesome.invoice_before_write();

drop trigger if exists trg_item_before_write on awesome.invoice_items;
create trigger trg_item_before_write
  before insert or update on awesome.invoice_items
  for each row execute function awesome.item_before_write();

drop trigger if exists trg_recalc_totals on awesome.invoice_items;
create trigger trg_recalc_totals
  after insert or delete or update on awesome.invoice_items
  for each row execute function awesome.recalc_invoice_totals();

-- ---------------------------------------------------------------------------
-- Numbering helpers. The other functions live in the dated migrations.
-- ---------------------------------------------------------------------------

-- Form preview only: what nextval would hand out, without consuming it.
create or replace function awesome.peek_next_invoice_number()
returns bigint
language sql
stable
security definer
set search_path to 'awesome', 'pg_catalog'
as $function$
  select case when is_called then last_value + 1 else last_value end
  from awesome.invoice_number_seq;
$function$;

-- Deleting reclaims the number: the sequence is resynced so the next invoice
-- reuses it. Cancelling, by contrast, keeps the number spent.
create or replace function awesome.delete_invoice(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'awesome', 'pg_catalog'
as $function$
declare
  v_max bigint;
begin
  delete from awesome.invoice_items where invoice_id = p_id;
  delete from awesome.invoices where id = p_id;

  select max(invoice_number) into v_max from awesome.invoices;

  -- setval(x, true) => next value is x + 1. GREATEST(1944, ...) keeps the
  -- floor so the next number is always >= 1945 even when no invoices remain.
  perform setval('awesome.invoice_number_seq', greatest(1944, coalesce(v_max, 0)), true);
end;
$function$;

revoke all on function awesome.peek_next_invoice_number() from public;
revoke all on function awesome.delete_invoice(uuid) from public;
grant execute on function awesome.peek_next_invoice_number() to service_role;
grant execute on function awesome.delete_invoice(uuid) to service_role;
