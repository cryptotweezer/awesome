-- What is owed, and when saving is allowed to start.
--
-- The savings plan has an order of operations that was missing from the first
-- two migrations: the loans come out first, and saving does not begin until
-- they are paid. Two tables and one settings row are what that needs.
--
-- LOANS. A loan is not an expense item. An expense is a number that repeats
-- forever and is only ever compared to other weeks; a loan has a total, a
-- balance that falls, and an end. Modelling it as an expense would mean the
-- number never moved and nothing would ever say "this one is finished", which
-- is the single fact the whole ordering depends on.
--
-- The balance is NOT stored. It is the principal minus the payments recorded
-- against it, worked out on read. A stored balance is a second copy of the same
-- truth, and the first time a payment is deleted or corrected the two disagree
-- with no way to tell which is right. The payments are the record.
--
-- THE PLAN. One row per business, holding the two numbers Andres said he must
-- be able to change at any time: what he intends to save each week, and the day
-- the plan starts. The two-year figure is derived from the weekly amount rather
-- than stored, so there is one number to edit and not three that can disagree.
-- `starts_on` is null until he picks it, which is honest: until the loans are
-- gone there is no start date, and a default would invent one.

create table if not exists awesome.loans (
  id             uuid          not null default gen_random_uuid(),
  org_id         uuid          not null,
  name           text          not null,
  -- What was owed at the beginning. Payments are counted against this.
  principal      numeric(12,2) not null,
  -- What comes out for this loan in a normal week. Counted in the weekly
  -- outgoings alongside the expense items.
  weekly_payment numeric(10,2) not null default 0,
  started_on     date,
  notes          text,
  -- A loan that is settled, written off or entered by mistake. The balance
  -- says whether it is paid; this says whether it is still being tracked.
  is_active      boolean       not null default true,
  sort_order     integer       not null default 0,
  created_at     timestamptz   not null default now(),
  updated_at     timestamptz   not null default now(),
  constraint loans_pkey primary key (id),
  constraint loans_name_not_blank check (btrim(name) <> ''),
  constraint loans_principal_positive check (principal >= 0),
  constraint loans_payment_positive check (weekly_payment >= 0),
  constraint loans_org_fkey foreign key (org_id)
    references awesome.orgs(id) on delete cascade
);

create table if not exists awesome.loan_payments (
  id         uuid          not null default gen_random_uuid(),
  org_id     uuid          not null,
  loan_id    uuid          not null,
  amount     numeric(12,2) not null,
  -- The day the money actually left, which is not always the day it was
  -- entered. Same reasoning as an invoice's date.
  paid_on    date          not null,
  note       text,
  -- Who or what recorded it: a person's name, or an agent's label.
  recorded_by text,
  created_at timestamptz   not null default now(),
  constraint loan_payments_pkey primary key (id),
  constraint loan_payments_amount_positive check (amount > 0),
  constraint loan_payments_loan_fkey foreign key (loan_id)
    references awesome.loans(id) on delete cascade,
  constraint loan_payments_org_fkey foreign key (org_id)
    references awesome.orgs(id) on delete cascade
);

create index if not exists loans_org_idx
  on awesome.loans (org_id, sort_order, name);
create index if not exists loan_payments_loan_idx
  on awesome.loan_payments (loan_id, paid_on desc);
create index if not exists loan_payments_org_idx
  on awesome.loan_payments (org_id, paid_on desc);

create table if not exists awesome.savings_plan (
  org_id        uuid          not null,
  -- What he intends to save in a week. The master number: the total over the
  -- horizon is derived from it, never stored.
  weekly_target numeric(10,2) not null default 1000,
  -- How long the plan runs. Two years to begin with, editable in months so it
  -- can move either way without changing units.
  horizon_months integer      not null default 24,
  -- The day week 1 begins. Null until the loans are cleared and he picks it.
  starts_on     date,
  notes         text,
  created_at    timestamptz   not null default now(),
  updated_at    timestamptz   not null default now(),
  constraint savings_plan_pkey primary key (org_id),
  constraint savings_plan_target_positive check (weekly_target >= 0),
  constraint savings_plan_horizon_positive check (horizon_months between 1 and 600),
  constraint savings_plan_org_fkey foreign key (org_id)
    references awesome.orgs(id) on delete cascade
);

drop trigger if exists trg_loans_touch on awesome.loans;
create trigger trg_loans_touch
  before update on awesome.loans
  for each row execute function awesome.touch_updated_at();

drop trigger if exists trg_savings_plan_touch on awesome.savings_plan;
create trigger trg_savings_plan_touch
  before update on awesome.savings_plan
  for each row execute function awesome.touch_updated_at();

alter table awesome.loans         enable row level security;
alter table awesome.loan_payments enable row level security;
alter table awesome.savings_plan  enable row level security;

revoke all on awesome.loans         from public, anon, authenticated;
revoke all on awesome.loan_payments from public, anon, authenticated;
revoke all on awesome.savings_plan  from public, anon, authenticated;

grant all on awesome.loans         to service_role;
grant all on awesome.loan_payments to service_role;
grant all on awesome.savings_plan  to service_role;
