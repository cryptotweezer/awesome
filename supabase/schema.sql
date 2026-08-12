-- =====================================================================
--  awesome, billing app: the complete database.
--
--  Run this once in the SQL editor of a fresh Supabase project and the
--  application works. It creates the schema, the tables, the rules and the
--  functions the app and every AI agent call.
--
--  Nothing here is specific to any one business. The first business is created
--  by the app itself the first time somebody signs in.
--
--  Two things to know before reading further:
--
--  1. Row level security is ON with NO policies, on purpose. Only the
--     `service_role` key reaches this data, and only from the server. Anon and
--     authenticated see nothing at all, ever.
--  2. Every table carries `org_id` and every function takes `p_org_id`. That
--     is the whole tenancy model: an id is not permission, and a function that
--     is handed a row belonging to somebody else treats it as missing.
-- =====================================================================

create schema if not exists awesome;

-- ---------------------------------------------------------------------
--  Tables
-- ---------------------------------------------------------------------

-- One business. Everything else belongs to exactly one of these.
create table if not exists awesome.orgs (
  id           uuid not null default gen_random_uuid(),

  -- Two names on purpose: `name` is PRINTED on documents (the legal or trading
  -- name), `display_name` is what the dashboard shows.
  name         text not null,
  display_name text,

  entity_type  text not null default 'sole_trader',
  tax_id_label text not null default 'ABN',   -- ABN | TFN | ACN

  address_line text, suburb text, state text, postcode text,
  email        text, phone  text,

  bank_name text, bank_bsb text, bank_account_no text, bank_account_name text,
  payment_note text,

  email_subject_template     text not null default 'Invoice {invoice_list} from {business_name}',
  email_body_template        text not null default 'Hi {client_name},

Please find attached invoice {invoice_list} from {business_name}. Payment details are on the invoice; if you have any questions, just reply to this email.

Thanks,
{business_name}',
  statement_subject_template text not null default 'Account statement from {business_name}',
  statement_body_template    text not null default 'Hi {client_name},

Please find attached your current account statement from {business_name}, showing the invoices still outstanding. Payment details are on each invoice; if you have any questions, just reply to this email.

Thanks,
{business_name}',

  -- What this business always sells, if it always sells the same thing. It
  -- pre-fills the client and invoice forms. Empty means the work is described
  -- line by line, which is the case for most businesses.
  default_service_description text not null default '',

  -- Whether the service and the rate are agreed per client (Awesome) or said
  -- on each invoice line (most businesses). It decides what the client form
  -- asks for, nothing else.
  per_client_defaults boolean not null default false,

  -- Australia's GST is 10% and only registered businesses charge it. Prices
  -- INCLUDE it, so turning this on does not change what anything costs, only
  -- how the same amount is explained on the invoice.
  gst_registered boolean not null default false,

  terms_days     integer not null default 7,     -- the payment window
  timezone       text    not null default 'Australia/Sydney',
  fy_start_month integer not null default 7,     -- 7 = Australian financial year

  logo_path text,   -- in the org-logos bucket; null means no logo is printed

  -- Numbering is per business, so every business can have its own #1.
  invoice_number_start integer not null default 1,
  next_invoice_number  integer not null default 1,

  -- Trial businesses carry quotas and are purged after 30 quiet days.
  -- A null quota means unlimited.
  is_demo          boolean not null default true,
  max_invoices     integer default 20,
  max_clients      integer default 10,
  max_agent_keys   integer default 3,
  max_ai_messages  integer default 20,
  ai_messages_used integer not null default 0,

  onboarding jsonb not null default '{}'::jsonb,   -- setup checklist progress

  last_active_at timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint orgs_pkey primary key (id),
  constraint orgs_entity_type_check check (
    entity_type = any (array['sole_trader'::text, 'company'::text, 'partnership'::text, 'trust'::text])
  ),
  -- No TFN, on purpose: that is a person's private tax number and it must
  -- never reach a printed invoice.
  constraint orgs_tax_id_label_check check (
    tax_id_label = any (array['ABN'::text, 'ACN'::text])
  ),
  constraint orgs_terms_days_check check (terms_days between 0 and 365),
  constraint orgs_fy_start_month_check check (fy_start_month between 1 and 12),
  constraint orgs_numbering_check check (next_invoice_number >= invoice_number_start)
);

-- Which Supabase user belongs to which business. Having an account in
-- auth.users means nothing on its own: membership here is what grants access.
-- The unique index on user_id is what enforces "one user, one business".
create table if not exists awesome.org_members (
  org_id       uuid not null,
  user_id      uuid not null,
  email        text not null,
  display_name text,          -- signs invoices.created_by
  role         text not null default 'owner',
  created_at   timestamptz not null default now(),

  constraint org_members_pkey primary key (org_id, user_id),
  constraint org_members_user_unique unique (user_id),
  constraint org_members_org_fkey foreign key (org_id)
    references awesome.orgs(id) on delete cascade,
  constraint org_members_role_check check (role = any (array['owner'::text, 'member'::text]))
);

-- The entity whose tax number is printed on an invoice. Most businesses have
-- exactly one; a business billing under two ABNs has two.
create table if not exists awesome.issuers (
  id         uuid        not null default gen_random_uuid(),
  org_id     uuid        not null,
  full_name  text        not null,
  short_name text        not null,
  abn        text        not null,   -- eleven digits, no spaces
  acn        text,                   -- nine digits; companies print both
  is_active  boolean     not null default true,
  created_at timestamptz not null default now(),
  constraint issuers_pkey primary key (id),
  constraint issuers_org_abn_key unique (org_id, abn),
  constraint issuers_acn_check check (acn is null or acn ~ '^[0-9]{9}$'),
  constraint issuers_org_fkey foreign key (org_id)
    references awesome.orgs(id) on delete cascade
);

create table if not exists awesome.clients (
  id                  uuid          not null default gen_random_uuid(),
  org_id              uuid          not null,
  name                text          not null,
  address_line        text,
  suburb              text,
  state               text          default 'NSW',
  postcode            text,
  email               text,
  default_issuer_id   uuid,
  default_description text,         -- optional: the usual work for this client
  default_rate        numeric(10,2),
  is_active           boolean       not null default true,
  created_at          timestamptz   not null default now(),
  constraint clients_pkey primary key (id),
  constraint clients_default_issuer_id_fkey foreign key (default_issuer_id)
    references awesome.issuers(id),
  constraint clients_org_fkey foreign key (org_id)
    references awesome.orgs(id) on delete cascade
);

-- issuer_name, issuer_abn and the bill_to_* columns are SNAPSHOTS taken when
-- the invoice is created: editing a client or an issuer must never rewrite
-- history. Same reasoning as the rate on a line item.
create table if not exists awesome.invoices (
  id                   uuid          not null default gen_random_uuid(),
  org_id               uuid          not null,
  invoice_number       integer       not null,
  issuer_id            uuid          not null,
  issuer_name          text          not null,
  issuer_abn           text          not null,
  issuer_acn           text,
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
  -- Frozen at issue, like the rate on a line item: registering for GST must
  -- not add tax to invoices already sent, and deregistering must not remove it.
  gst_rate             numeric(5,4)  not null default 0,
  gst_amount           numeric(10,2) not null default 0,
  paid_amount          numeric(10,2) not null default 0,
  balance_due          numeric(10,2) not null default 0,
  status               text          not null default 'unpaid',
  paid_at              date,          -- the day the money arrived; cash-basis BAS
  internal_notes       text,          -- never printed on any document
  created_at           timestamptz   not null default now(),
  updated_at           timestamptz   not null default now(),
  created_by           text,          -- who made it: a person or an agent label
  constraint invoices_pkey primary key (id),
  constraint invoices_org_number_key unique (org_id, invoice_number),
  constraint invoices_status_check check (status = any (array['unpaid'::text, 'paid'::text, 'cancelled'::text])),
  constraint invoices_issuer_id_fkey foreign key (issuer_id) references awesome.issuers(id),
  constraint invoices_client_id_fkey foreign key (client_id) references awesome.clients(id),
  constraint invoices_org_fkey foreign key (org_id) references awesome.orgs(id) on delete cascade
);

create table if not exists awesome.invoice_items (
  id           uuid          not null default gen_random_uuid(),
  org_id       uuid          not null,   -- denormalised; kept in step by a trigger
  invoice_id   uuid          not null,
  description  text          not null,
  service_date date,                     -- the day the work was done
  quantity     numeric(10,2) not null default 1,
  rate         numeric(10,2) not null,
  amount       numeric(10,2) not null default 0,
  sort_order   integer       not null default 0,
  created_at   timestamptz   not null default now(),
  constraint invoice_items_pkey primary key (id),
  constraint invoice_items_invoice_id_fkey foreign key (invoice_id)
    references awesome.invoices(id) on delete cascade,
  constraint invoice_items_org_fkey foreign key (org_id)
    references awesome.orgs(id) on delete cascade
);

-- One row per AI agent. Only the hash is stored; the raw key is shown once.
-- The org_id here is the only thing deciding what an agent can reach.
create table if not exists awesome.agent_keys (
  id           uuid        not null default gen_random_uuid(),
  org_id       uuid        not null,
  label        text        not null,
  key_hash     text        not null,
  is_active    boolean     not null default true,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  constraint agent_keys_pkey primary key (id),
  constraint agent_keys_key_hash_key unique (key_hash),
  constraint agent_keys_org_fkey foreign key (org_id)
    references awesome.orgs(id) on delete cascade
);

create index if not exists org_members_email_idx    on awesome.org_members (lower(email));
create index if not exists orgs_demo_activity_idx   on awesome.orgs (last_active_at) where is_demo;
create index if not exists issuers_org_idx          on awesome.issuers (org_id);
create index if not exists clients_org_idx          on awesome.clients (org_id);
create index if not exists agent_keys_org_idx       on awesome.agent_keys (org_id);
create index if not exists invoice_items_org_idx    on awesome.invoice_items (org_id);
create index if not exists invoices_org_status_idx  on awesome.invoices (org_id, status);
create index if not exists invoices_org_date_idx    on awesome.invoices (org_id, invoice_date desc);
create index if not exists invoices_org_paid_at_idx on awesome.invoices (org_id, paid_at) where status = 'paid';

-- ---------------------------------------------------------------------
--  Access. RLS on, no policies: service_role only, from the server only.
-- ---------------------------------------------------------------------
alter table awesome.orgs          enable row level security;
alter table awesome.org_members   enable row level security;
alter table awesome.issuers       enable row level security;
alter table awesome.clients       enable row level security;
alter table awesome.invoices      enable row level security;
alter table awesome.invoice_items enable row level security;
alter table awesome.agent_keys    enable row level security;

grant usage on schema awesome to service_role;
grant all on all tables in schema awesome to service_role;
grant all on all sequences in schema awesome to service_role;

-- ---------------------------------------------------------------------
--  Triggers. These hold rules that exist nowhere in the application code.
-- ---------------------------------------------------------------------

-- updated_at is filled in for you, UNLESS you set it deliberately. Keeping an
-- explicit value matters when restoring a backup, and the purge reads this
-- column to decide what is dormant, so it has to be writable.
create or replace function awesome.touch_updated_at()
returns trigger language plpgsql set search_path to '' as $function$
begin
  if new.updated_at is distinct from old.updated_at then
    return new;
  end if;
  new.updated_at := now();
  return new;
end $function$;

-- due_date follows the business's own terms, and the term is STAMPED on the
-- invoice at creation. Changing the business's terms later therefore never
-- rewrites invoices already issued.
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

  -- The price already contains the tax, so at 10% the GST is an eleventh of
  -- the total. Recomputed on every write because editing the lines changes it.
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

-- The line total, and the owner stamped from the parent invoice so the
-- denormalised org_id can never be set to something else by a caller.
create or replace function awesome.item_before_write()
returns trigger language plpgsql set search_path to '' as $function$
begin
  new.amount := round(new.quantity * new.rate, 2);

  select i.org_id into new.org_id
    from awesome.invoices i
   where i.id = new.invoice_id;

  if new.org_id is null then
    raise exception 'invoice % does not exist', new.invoice_id;
  end if;

  return new;
end $function$;

create or replace function awesome.recalc_invoice_totals()
returns trigger language plpgsql set search_path to '' as $function$
declare inv uuid := coalesce(new.invoice_id, old.invoice_id); s numeric(10,2);
begin
  select coalesce(sum(amount),0) into s from awesome.invoice_items where invoice_id = inv;
  update awesome.invoices set subtotal = s, total = s where id = inv;
  return null;
end $function$;

-- Trial quotas live here rather than in the UI, because an agent talks to the
-- gateway and never renders a form. A limit that only exists in React is not a
-- limit. A null cap means unlimited.
create or replace function awesome.enforce_quota()
returns trigger language plpgsql set search_path to '' as $function$
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
    return new;
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

drop trigger if exists trg_orgs_touch on awesome.orgs;
create trigger trg_orgs_touch
  before update on awesome.orgs
  for each row execute function awesome.touch_updated_at();

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

-- ---------------------------------------------------------------------
--  Time. Never CURRENT_DATE: that is the server's UTC day, which shifts the
--  financial year and the overdue flags for anybody not living in UTC.
-- ---------------------------------------------------------------------

create or replace function awesome.org_today(p_org_id uuid)
returns date language sql stable security definer
set search_path to 'awesome', 'pg_catalog' as $$
  select (now() at time zone coalesce(
    (select o.timezone from awesome.orgs o where o.id = p_org_id),
    'Australia/Sydney'
  ))::date;
$$;

create or replace function awesome.org_fy_start(p_org_id uuid)
returns date language sql stable security definer
set search_path to 'awesome', 'pg_catalog' as $$
  with p as (
    select
      awesome.org_today(p_org_id) as today,
      coalesce((select o.fy_start_month from awesome.orgs o where o.id = p_org_id), 7) as m
  )
  select case
           when extract(month from p.today) >= p.m
             then make_date(extract(year from p.today)::int, p.m, 1)
             else make_date(extract(year from p.today)::int - 1, p.m, 1)
         end
  from p;
$$;

-- ---------------------------------------------------------------------
--  Onboarding: a business, its owner and its issuer, created together.
-- ---------------------------------------------------------------------

-- Digits are the number; spaces are how people read it out. Storing the
-- keystrokes would make "40 243 400 997" and "40243400997" two different
-- businesses to the unique index, so everything normalises through here.
create or replace function awesome.digits(p_text text)
returns text
language sql immutable
as $$ select regexp_replace(coalesce(p_text, ''), '\D', '', 'g') $$;

create or replace function awesome.create_org(
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
as $$
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
$$;

-- ---------------------------------------------------------------------
--  Fixing the entity behind the invoices: the name on the ABN, the ABN
--  itself and the optional ACN. Editing them changes nothing already issued,
--  because an invoice snapshots issuer_name and issuer_abn when it is made,
--  the same way a line item snapshots its rate.
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
as $$
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
$$;

-- ---------------------------------------------------------------------
--  Writes. Every one takes p_org_id and filters on it, so knowing another
--  business's uuid buys nothing.
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

create or replace function awesome.mark_paid(p_id uuid, p_org_id uuid)
returns awesome.invoices
language plpgsql security definer
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

create or replace function awesome.mark_unpaid(p_id uuid, p_org_id uuid)
returns awesome.invoices
language plpgsql security definer
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

create or replace function awesome.cancel_invoice(p_id uuid, p_org_id uuid)
returns awesome.invoices
language plpgsql security definer
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

create or replace function awesome.reactivate_invoice(p_id uuid, p_org_id uuid)
returns awesome.invoices
language plpgsql security definer
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

-- Deleting reclaims the number: the counter rewinds so the next invoice reuses
-- it. Cancelling, by contrast, keeps the number spent.
create or replace function awesome.delete_invoice(p_id uuid, p_org_id uuid)
returns void
language plpgsql security definer
set search_path to 'awesome', 'pg_catalog'
as $$
declare
  v_deleted integer;
begin
  delete from awesome.invoice_items
   where invoice_id = p_id and org_id = p_org_id;

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

-- Form preview only. The definitive number is assigned at insert time.
create or replace function awesome.peek_next_invoice_number(p_org_id uuid)
returns bigint language sql stable security definer
set search_path to 'awesome', 'pg_catalog' as $$
  select next_invoice_number::bigint from awesome.orgs where id = p_org_id;
$$;

-- ---------------------------------------------------------------------
--  Reads. Narrow on purpose, so an agent never pulls a whole table into its
--  context. Note the org filter comes BEFORE any name matching: without it, a
--  one-letter search would return every client in the database.
-- ---------------------------------------------------------------------

create or replace function awesome.who_owes(p_org_id uuid)
returns table(
  client_name text, invoice_count int, amount numeric,
  overdue_count int, overdue_amount numeric
)
language sql stable security definer
set search_path to 'awesome', 'pg_catalog' as $$
  select
    bill_to_name,
    count(*)::int,
    sum(balance_due),
    count(*) filter (where due_date < awesome.org_today(p_org_id))::int,
    coalesce(sum(balance_due) filter (where due_date < awesome.org_today(p_org_id)), 0)
  from awesome.invoices
  where org_id = p_org_id and status = 'unpaid'
  group by bill_to_name
  order by 5 desc, 3 desc;
$$;

create or replace function awesome.client_account(p_name text, p_org_id uuid)
returns table(
  client_name text, invoice_number int, invoice_date date, due_date date,
  total numeric, balance_due numeric, overdue boolean
)
language sql stable security definer
set search_path to 'awesome', 'pg_catalog' as $$
  select
    bill_to_name, invoice_number, invoice_date, due_date, total, balance_due,
    (due_date < awesome.org_today(p_org_id))
  from awesome.invoices
  where org_id = p_org_id
    and status = 'unpaid'
    and bill_to_name ilike '%' || p_name || '%'
  order by invoice_number;
$$;

create or replace function awesome.recent_invoices(
  p_name text, p_limit int, p_org_id uuid
)
returns table(
  invoice_number int, client_name text, issuer text,
  invoice_date date, total numeric, status text
)
language sql stable security definer
set search_path to 'awesome', 'pg_catalog' as $$
  select
    inv.invoice_number, inv.bill_to_name, i.short_name,
    inv.invoice_date, inv.total, inv.status
  from awesome.invoices inv
  join awesome.issuers i on i.id = inv.issuer_id and i.org_id = inv.org_id
  where inv.org_id = p_org_id
    and (p_name is null or inv.bill_to_name ilike '%' || p_name || '%')
  order by inv.invoice_number desc
  limit greatest(coalesce(p_limit, 10), 1);
$$;

create or replace function awesome.billed_in_period(
  p_from date, p_to date, p_issuer text, p_org_id uuid
)
returns table(issuer text, invoice_count int, billed numeric)
language sql stable security definer
set search_path to 'awesome', 'pg_catalog' as $$
  select i.short_name, count(*)::int, coalesce(sum(inv.total), 0)
  from awesome.invoices inv
  join awesome.issuers i on i.id = inv.issuer_id and i.org_id = inv.org_id
  where inv.org_id = p_org_id
    and inv.status <> 'cancelled'
    and inv.invoice_date >= p_from
    and inv.invoice_date <= p_to
    and (p_issuer is null or i.short_name ilike '%' || p_issuer || '%')
  group by i.short_name
  order by i.short_name;
$$;

create or replace function awesome.fy_summary(p_fy_start date, p_org_id uuid)
returns table(issuer text, abn text, billed numeric, paid numeric)
language sql stable security definer
set search_path to 'awesome', 'pg_catalog' as $$
  with params as (
    select coalesce(p_fy_start, awesome.org_fy_start(p_org_id)) as fy_start
  )
  select
    i.short_name, i.abn,
    coalesce(sum(inv.total) filter (where inv.status <> 'cancelled'), 0),
    coalesce(sum(inv.total) filter (where inv.status = 'paid'), 0)
  from params p
  join awesome.invoices inv
    on inv.org_id = p_org_id
   and inv.invoice_date >= p.fy_start
   and inv.invoice_date <  (p.fy_start + interval '1 year')
  join awesome.issuers i on i.id = inv.issuer_id and i.org_id = inv.org_id
  group by i.short_name, i.abn
  order by i.short_name;
$$;

-- The left join keeps a brand new business returning zeros rather than no row
-- at all, which the dashboard would otherwise render as a crash.
create or replace function awesome.business_snapshot(p_org_id uuid)
returns table(
  outstanding_amount numeric, outstanding_count int,
  overdue_amount numeric, overdue_count int,
  billed_this_month numeric, billed_this_fy numeric,
  billed_all_time numeric, paid_all_time numeric
)
language sql stable security definer
set search_path to 'awesome', 'pg_catalog' as $$
  with p as (
    select
      awesome.org_today(p_org_id) as today,
      date_trunc('month', awesome.org_today(p_org_id))::date as month_start,
      awesome.org_fy_start(p_org_id) as fy_start
  )
  select
    coalesce(sum(i.balance_due) filter (where i.status = 'unpaid'), 0),
    count(i.id) filter (where i.status = 'unpaid')::int,
    coalesce(sum(i.balance_due) filter (where i.status = 'unpaid' and i.due_date < p.today), 0),
    count(i.id) filter (where i.status = 'unpaid' and i.due_date < p.today)::int,
    coalesce(sum(i.total) filter (where i.status <> 'cancelled' and i.invoice_date >= p.month_start), 0),
    coalesce(sum(i.total) filter (where i.status <> 'cancelled' and i.invoice_date >= p.fy_start), 0),
    coalesce(sum(i.total) filter (where i.status <> 'cancelled'), 0),
    coalesce(sum(i.total) filter (where i.status = 'paid'), 0)
  from p left join awesome.invoices i on i.org_id = p_org_id
  group by p.today, p.month_start, p.fy_start;
$$;

create or replace function awesome.overdue_invoices(p_org_id uuid)
returns table(
  invoice_number int, client_name text, issuer text,
  due_date date, days_overdue int, balance_due numeric
)
language sql stable security definer
set search_path to 'awesome', 'pg_catalog' as $$
  select
    i.invoice_number, i.bill_to_name, iss.short_name, i.due_date,
    (awesome.org_today(p_org_id) - i.due_date)::int,
    i.balance_due
  from awesome.invoices i
  join awesome.issuers iss on iss.id = i.issuer_id and iss.org_id = i.org_id
  where i.org_id = p_org_id
    and i.status = 'unpaid'
    and i.due_date < awesome.org_today(p_org_id)
  order by i.due_date asc;
$$;

create or replace function awesome.client_summary(p_name text, p_org_id uuid)
returns table(
  client_name text, billed_all_time numeric, paid_all_time numeric,
  outstanding numeric, unpaid_count int, overdue_count int, last_invoice_date date
)
language sql stable security definer
set search_path to 'awesome', 'pg_catalog' as $$
  select
    i.bill_to_name,
    coalesce(sum(i.total) filter (where i.status <> 'cancelled'), 0),
    coalesce(sum(i.total) filter (where i.status = 'paid'), 0),
    coalesce(sum(i.balance_due) filter (where i.status = 'unpaid'), 0),
    count(*) filter (where i.status = 'unpaid')::int,
    count(*) filter (
      where i.status = 'unpaid' and i.due_date < awesome.org_today(p_org_id)
    )::int,
    max(i.invoice_date)
  from awesome.invoices i
  where i.org_id = p_org_id
    and i.bill_to_name ilike '%' || p_name || '%'
  group by i.bill_to_name
  order by i.bill_to_name;
$$;

create or replace function awesome.find_invoices(
  p_client text, p_issuer text, p_status text,
  p_from date, p_to date, p_limit int, p_org_id uuid
)
returns table(
  invoice_number int, client_name text, issuer text, invoice_date date,
  due_date date, total numeric, balance_due numeric, status text
)
language sql stable security definer
set search_path to 'awesome', 'pg_catalog' as $$
  select
    i.invoice_number, i.bill_to_name, iss.short_name, i.invoice_date,
    i.due_date, i.total, i.balance_due, i.status
  from awesome.invoices i
  join awesome.issuers iss on iss.id = i.issuer_id and iss.org_id = i.org_id
  where i.org_id = p_org_id
    and (p_client is null or i.bill_to_name ilike '%' || p_client || '%')
    and (p_issuer is null or iss.short_name ilike '%' || p_issuer || '%')
    and (p_status is null or i.status = p_status)
    and (p_from is null or i.invoice_date >= p_from)
    and (p_to is null or i.invoice_date <= p_to)
  order by i.invoice_number desc
  limit greatest(coalesce(p_limit, 20), 1);
$$;

-- ---------------------------------------------------------------------
--  The dashboard assistant's allowance.
--
--  It runs on the deployment owner's own AI credit, so a trial business gets a
--  fixed, all-time number of messages. Counting happens in one statement that
--  both reads and writes, because two browser tabs asking at the same moment
--  would otherwise each read the old number and both be let through.
--  Returns how many are left; null means unlimited.
-- ---------------------------------------------------------------------
create or replace function awesome.consume_ai_message(p_org_id uuid)
returns integer
language plpgsql security definer
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
--  Closing a trial account on purpose.
--
--  The same deletion as the purge below, asked for by the person who owns the
--  account instead of by the calendar. is_demo is checked in here rather than
--  by the caller: this is the one function in the schema whose whole job is to
--  destroy a business, and the fence that keeps it away from Awesome belongs
--  where it cannot be forgotten.
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

-- ---------------------------------------------------------------------
--  Trial businesses are deleted a month after they are created, used or not.
--
--  Activity is deliberately NOT part of the rule. These accounts exist so
--  people can try the app, and a busy one kept alive forever would mean this
--  database holding somebody's real clients and invoices forever. One month
--  from sign-up is also the only rule that fits in one sentence on a banner,
--  which matters more than cleverness when the outcome is deletion.
--
--  The deletes are explicit and ordered rather than left to ON DELETE CASCADE:
--  cascading from `orgs` fans out to clients, issuers and invoices at once,
--  and the invoice -> client and invoice -> issuer foreign keys have no
--  cascade of their own, so the order it happened to pick could fail.
--
--  p_org_id aims the purge at a single business. Left null it considers every
--  trial that qualifies, which is what the daily cron wants. It exists because
--  a test that calls this function unaimed deletes real accounts, and one did.
-- ---------------------------------------------------------------------
create or replace function awesome.purge_stale_demo_orgs(
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

-- ---------------------------------------------------------------------
--  Lock the surface. SECURITY DEFINER functions bypass RLS, so anon and
--  authenticated must never be able to call one.
-- ---------------------------------------------------------------------
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
    execute format('revoke all on function %s from public', fn.sig);
    execute format('grant execute on function %s to service_role', fn.sig);
  end loop;
end $$;

-- ---------------------------------------------------------------------
--  Storage: the logo each business prints on its documents.
--  Private on purpose. The files are read server-side while rendering a PDF
--  and are never linked from a page.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('org-logos', 'org-logos', false, 1048576, array['image/png', 'image/jpeg'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
