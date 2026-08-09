-- Multi-tenant, step 1 of 3: organisations and their members.
--
-- Nothing is scoped yet. This migration only creates the two new tables and
-- moves the single `company_profile` row into `orgs` as organisation #1, so the
-- existing business becomes one tenant among others without losing a field.
-- `company_profile` is left in place and still readable; it is dropped in F1.9,
-- once no code reads it.
--
-- The Awesome organisation carries a fixed uuid so migrations, seeds and code
-- can all name it without a lookup:
--   AWESOME_ORG_ID = 00000000-0000-0000-0000-000000000001

-- ---------------------------------------------------------------------------
-- orgs: everything that used to be "the company", now one row per business.
-- ---------------------------------------------------------------------------
create table if not exists awesome.orgs (
  id           uuid not null default gen_random_uuid(),

  -- Two names on purpose: `name` is what gets PRINTED on invoices (the legal or
  -- trading name), `display_name` is what the dashboard shows.
  name         text not null,
  display_name text,

  entity_type  text not null default 'sole_trader',
  -- What the printed tax number is called for this business. Sole traders and
  -- companies here use an ABN; some users will have a TFN or an ACN instead.
  tax_id_label text not null default 'ABN',

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

  -- Payment terms in days. Used to be hardcoded as +7 in the invoice trigger.
  terms_days      integer not null default 7,
  -- "Today" is resolved in the organisation's own zone, never in UTC.
  timezone        text    not null default 'Australia/Sydney',
  -- Financial year start month. Australia is July; the column exists so a
  -- different country is a data change and not a migration.
  fy_start_month  integer not null default 7,

  -- Path in the private `org-logos` bucket. Null means the built-in logo.
  logo_path text,

  -- Per-organisation numbering. Guests start at 1; this business keeps its
  -- historical series. `next_invoice_number` replaces the global sequence.
  invoice_number_start integer not null default 1,
  next_invoice_number  integer not null default 1,

  -- Demo organisations carry quotas and get purged after 30 days of silence.
  -- Null quota means unlimited, which is what the real business gets.
  is_demo          boolean not null default true,
  max_invoices     integer default 20,
  max_clients      integer default 10,
  max_agent_keys   integer default 3,
  max_ai_messages  integer default 20,
  ai_messages_used integer not null default 0,

  -- Progress of the guided setup checklist, one key per step.
  onboarding jsonb not null default '{}'::jsonb,

  last_active_at timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint orgs_pkey primary key (id),
  constraint orgs_entity_type_check check (
    entity_type = any (array['sole_trader'::text, 'company'::text, 'partnership'::text, 'trust'::text])
  ),
  constraint orgs_tax_id_label_check check (
    tax_id_label = any (array['ABN'::text, 'TFN'::text, 'ACN'::text])
  ),
  constraint orgs_terms_days_check check (terms_days between 0 and 365),
  constraint orgs_fy_start_month_check check (fy_start_month between 1 and 12),
  constraint orgs_numbering_check check (next_invoice_number >= invoice_number_start)
);

-- ---------------------------------------------------------------------------
-- org_members: which Supabase user belongs to which organisation.
--
-- `auth.users` is SHARED with the resume and pis projects, so simply having an
-- account there means nothing here. Membership is the only thing that grants
-- access to billing data.
--
-- The unique index on user_id is what enforces "one user, one organisation".
-- Dropping it is all it would take to allow several, later.
-- ---------------------------------------------------------------------------
create table if not exists awesome.org_members (
  org_id       uuid not null,
  user_id      uuid not null,
  email        text not null,
  -- Signs `invoices.created_by` when this person works in the dashboard.
  display_name text,
  role         text not null default 'owner',
  created_at   timestamptz not null default now(),

  constraint org_members_pkey primary key (org_id, user_id),
  constraint org_members_user_unique unique (user_id),
  constraint org_members_org_fkey foreign key (org_id)
    references awesome.orgs(id) on delete cascade,
  constraint org_members_role_check check (role = any (array['owner'::text, 'member'::text]))
);

create index if not exists org_members_email_idx on awesome.org_members (lower(email));
create index if not exists orgs_demo_activity_idx on awesome.orgs (last_active_at) where is_demo;

alter table awesome.orgs        enable row level security;
alter table awesome.org_members enable row level security;

grant all on awesome.orgs        to service_role;
grant all on awesome.org_members to service_role;

-- ---------------------------------------------------------------------------
-- updated_at, kept honest by a trigger rather than by every caller.
-- ---------------------------------------------------------------------------
create or replace function awesome.touch_updated_at()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  new.updated_at := now();
  return new;
end $function$;

drop trigger if exists trg_orgs_touch on awesome.orgs;
create trigger trg_orgs_touch
  before update on awesome.orgs
  for each row execute function awesome.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Awesome becomes organisation #1, built from the row it already has.
-- Every field is copied; nothing is retyped.
-- ---------------------------------------------------------------------------
insert into awesome.orgs (
  id, name, display_name, entity_type, tax_id_label,
  address_line, suburb, state, postcode, email, phone,
  bank_name, bank_bsb, bank_account_no, bank_account_name, payment_note,
  email_subject_template, email_body_template,
  statement_subject_template, statement_body_template,
  terms_days, timezone, fy_start_month,
  invoice_number_start, next_invoice_number,
  is_demo, max_invoices, max_clients, max_agent_keys, max_ai_messages
)
select
  '00000000-0000-0000-0000-000000000001'::uuid,
  cp.business_name,
  'Awesome Services',           -- the UI name, which differs from the printed one
  'sole_trader',
  'ABN',
  cp.address_line, cp.suburb, cp.state, cp.postcode, cp.email, cp.phone,
  cp.bank_name, cp.bank_bsb, cp.bank_account_no, cp.bank_account_name, cp.payment_note,
  cp.email_subject_template, cp.email_body_template,
  cp.statement_subject_template, cp.statement_body_template,
  7, 'Australia/Sydney', 7,
  1945,
  -- Continue the existing series exactly where the sequence left it.
  greatest(1945, coalesce((select max(invoice_number) + 1 from awesome.invoices), 1945)),
  false, null, null, null, null   -- not a demo, no quotas
from awesome.company_profile cp
where cp.id = 1
on conflict (id) do nothing;

-- The two people who already work in this dashboard. Their display names match
-- the old EMAIL_TO_ISSUER map so `created_by` keeps signing exactly as before.
insert into awesome.org_members (org_id, user_id, email, display_name, role)
select
  '00000000-0000-0000-0000-000000000001'::uuid,
  u.id,
  u.email,
  case lower(u.email)
    when 'cryptotweezer@gmail.com' then 'Andres'
    when 'mavi.sofan33@gmail.com'  then 'Mavi'
  end,
  'owner'
from auth.users u
where lower(u.email) in ('cryptotweezer@gmail.com', 'mavi.sofan33@gmail.com')
on conflict (user_id) do nothing;
