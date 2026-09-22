-- One plan at a time, one after another, each with its own record.
--
-- `savings_plan` was keyed on `org_id`: one row per business, for ever. That
-- says a business has exactly one savings plan in its whole life, which is not
-- how saving works. A two-year plan ends; a shorter one is easier to believe
-- in; either way what happened under the last one is worth keeping, because
-- "did I make it" is the question the whole section exists to answer.
--
-- So plans get their own identity and the weeks say which plan they belong to.
-- Sequential, never overlapping: a week belongs to one plan, and a plan runs
-- from its start date for its horizon. `ends_on` is stored as a generated
-- column so the database can answer "which plan is this week in" and "is this
-- plan finished" without arithmetic in three different places.
--
-- A plan is FINISHED when `ends_on` has gone by, derived from the date and
-- never stored, the same way an overdue invoice is. Its result is the weeks it
-- holds, each of which froze its own figures when it closed, so a finished
-- plan's statistics cannot drift afterwards.

create table if not exists awesome.savings_plans (
  id             uuid          not null default gen_random_uuid(),
  org_id         uuid          not null,
  -- Optional, for the history to be readable: "Visa", "Car", "First year".
  name           text,
  starts_on      date          not null,
  weekly_target  numeric(10,2) not null default 1000,
  horizon_months integer       not null default 24,
  -- 52 weeks a year, which is the figure this is checked against by hand.
  -- Stored, not computed on read, so a query can find the plan a date is in.
  ends_on        date generated always as (
    starts_on + (round((horizon_months::numeric / 12) * 52)::int * 7 - 1)
  ) stored,
  notes          text,
  created_at     timestamptz   not null default now(),
  updated_at     timestamptz   not null default now(),
  constraint savings_plans_pkey primary key (id),
  constraint savings_plans_target_positive check (weekly_target >= 0),
  constraint savings_plans_horizon_positive
    check (horizon_months between 1 and 600),
  -- Two plans starting the same day is always a mistake. Overlap in general is
  -- refused by the write path, which knows the previous plan's end date.
  constraint savings_plans_org_start_key unique (org_id, starts_on),
  constraint savings_plans_org_fkey foreign key (org_id)
    references awesome.orgs(id) on delete cascade
);

create index if not exists savings_plans_org_idx
  on awesome.savings_plans (org_id, starts_on desc);

comment on table awesome.savings_plans is
  'Savings plans, one after another. A plan is finished when ends_on has gone '
  'by; its result is the weeks that point at it, which froze their own figures '
  'as they closed.';

-- Carry over the single plan, if it was ever started. A row with no start date
-- was never a plan, only a settings row waiting for one, and it is not worth
-- resurrecting.
insert into awesome.savings_plans
  (org_id, starts_on, weekly_target, horizon_months, notes, created_at)
select org_id, starts_on, weekly_target, horizon_months, notes, created_at
from awesome.savings_plan
where starts_on is not null
on conflict (org_id, starts_on) do nothing;

-- ---------------------------------------------------------------------
--  Weeks belong to a plan.
-- ---------------------------------------------------------------------
alter table awesome.savings_weeks
  add column if not exists plan_id uuid;

update awesome.savings_weeks w
set plan_id = p.id
from awesome.savings_plans p
where w.plan_id is null
  and p.org_id = w.org_id
  and w.week_start between p.starts_on and p.ends_on;

-- Any week left without a plan belonged to a plan that was never started, so
-- it was never part of anything. There is nothing to keep.
delete from awesome.savings_weeks where plan_id is null;

alter table awesome.savings_weeks
  alter column plan_id set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'savings_weeks_plan_fkey'
  ) then
    alter table awesome.savings_weeks
      add constraint savings_weeks_plan_fkey foreign key (plan_id)
      references awesome.savings_plans(id) on delete cascade;
  end if;
end $$;

create index if not exists savings_weeks_plan_idx
  on awesome.savings_weeks (plan_id, week_start);

comment on column awesome.savings_weeks.plan_id is
  'The plan this week was run under. Deleting a plan takes its weeks with it, '
  'which is the whole record of those weeks: the work, the payments and the '
  'costs. Invoices are untouched, because the link between the two halves '
  'points from a week line TO an invoice and never back.';

drop table if exists awesome.savings_plan;

-- ---------------------------------------------------------------------
--  The new table gets the same lockdown as every other one.
-- ---------------------------------------------------------------------
-- RLS on with no policies, so only service_role (which bypasses it) reaches
-- the rows, and only server-side. A new table does NOT inherit this: it was
-- created open, and the gap lasted exactly as long as it took to notice.
alter table awesome.savings_plans enable row level security;
revoke all on table awesome.savings_plans from public, anon, authenticated;

drop trigger if exists trg_savings_plans_touch on awesome.savings_plans;
create trigger trg_savings_plans_touch
  before update on awesome.savings_plans
  for each row execute function awesome.touch_updated_at();
