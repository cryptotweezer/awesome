-- The weeks that actually happened.
--
-- The rotation is the plan: who is due, on what day, for how much, repeating
-- forever. This is the other half, and the two must never be confused. A week
-- here is one real stretch of calendar that was worked, and it exists to record
-- how that week differed from the plan, because it always does.
--
-- A week is born pre-filled from the rotation and reality is applied on top:
-- this client was not done, that one moved to Thursday, there was extra work,
-- somebody paid cash who normally transfers, the fuel cost more. At the end the
-- week says what really came in and what really went out.
--
-- THREE STATES, ONE COLUMN. Only `closed_at` is stored:
--
--   open     the week has not ended yet
--   pending  it ended and is not closed, because money is still to arrive
--   closed   everything is in, and what was saved has been confirmed
--
-- Pending is derived from the date, never stored, for the same reason an
-- overdue invoice is derived: a stored state goes stale at midnight and needs
-- somebody to remember to move it.
--
-- NOTHING IS SEALED. A closed week can be reopened and corrected. Real life
-- does not stop being wrong on Friday, and a system that refuses the correction
-- just gets a second system in a spreadsheet next to it.
--
-- WHAT A CLOSED WEEK KEEPS. Its totals are frozen on the row. Raising a client's
-- rate, changing a fixed expense or moving the savings target must never rewrite
-- a week that already happened: the same rule that makes an invoice line keep
-- the rate it was raised under.

create table if not exists awesome.savings_weeks (
  id             uuid          not null default gen_random_uuid(),
  org_id         uuid          not null,
  -- The first day of the week, in the business's timezone. Weeks run from the
  -- weekday the plan started on, so this is not always a Monday.
  week_start     date          not null,
  week_end       date          not null,
  -- Which side of the two-week rotation this week is, so it knows who was due.
  rotation_week  smallint      not null,
  -- Null while open or pending. Set when everything is in.
  closed_at      timestamptz,
  closed_by      text,
  -- Frozen at close, so history stops moving. Null while the week is open, when
  -- the figures are worked out live from the entries and the current expenses.
  income_total   numeric(12,2),
  expenses_total numeric(12,2),
  saved_amount   numeric(12,2),
  target_amount  numeric(12,2),
  notes          text,
  created_at     timestamptz   not null default now(),
  updated_at     timestamptz   not null default now(),
  constraint savings_weeks_pkey primary key (id),
  constraint savings_weeks_unique unique (org_id, week_start),
  constraint savings_weeks_rotation_check check (rotation_week in (1, 2)),
  constraint savings_weeks_order_check check (week_end >= week_start),
  constraint savings_weeks_org_fkey foreign key (org_id)
    references awesome.orgs(id) on delete cascade
);

-- One line of income in one week.
--
-- `client_id` is nullable on purpose. A one-off job, done once for somebody who
-- is not a client and never will be, belongs to the week it happened in and
-- nowhere else: creating a client for it would put a name in the client list
-- forever to record an afternoon.
--
-- `client_name` is a snapshot for exactly the same reason an invoice snapshots
-- who it was billed to. Renaming or deleting a client must not rewrite what a
-- past week says happened.
create table if not exists awesome.week_entries (
  id            uuid          not null default gen_random_uuid(),
  org_id        uuid          not null,
  week_id       uuid          not null,
  -- Null for a one-off job. Set for anyone in the client list.
  client_id     uuid,
  client_name   text          not null,
  -- Where this line came from:
  --   rotation  the plan said this client was due this week
  --   adhoc     added to this week because the work happened
  --   oneoff    a job for somebody who is not a client
  source        text          not null default 'rotation',
  -- expected  the plan says it should happen and it has not been settled yet
  -- done      it happened
  -- skipped   it did not happen: the money does not come in, and no other week
  --           is affected. Work that did not happen is not a debt.
  status        text          not null default 'expected',
  -- The day it ACTUALLY happened, which starts from the rotation's day and can
  -- move. Moving it here never touches the rotation.
  day           smallint,
  amount        numeric(12,2) not null default 0,
  -- Additional work on top of the usual job.
  extra_amount  numeric(12,2) not null default 0,
  extra_note    text,
  -- How this one was paid THIS week, which is not always the usual way.
  method        text          not null default 'cash',
  paid          boolean       not null default false,
  paid_on       date,
  -- The invoice that covers this line, when there is one. This is what keeps
  -- the two halves of the app in step: the payment is recorded once, on the
  -- invoice, and read here.
  invoice_id    uuid,
  note          text,
  sort_order    integer       not null default 0,
  created_at    timestamptz   not null default now(),
  updated_at    timestamptz   not null default now(),
  constraint week_entries_pkey primary key (id),
  constraint week_entries_status_check check (status in ('expected', 'done', 'skipped')),
  constraint week_entries_source_check check (source in ('rotation', 'adhoc', 'oneoff')),
  constraint week_entries_method_check check (method in ('cash', 'account')),
  constraint week_entries_day_check check (day is null or day between 1 and 7),
  constraint week_entries_name_not_blank check (btrim(client_name) <> ''),
  -- One line per client per week. A second visit in the same week is extra work
  -- on the same line, which is what it is.
  constraint week_entries_client_unique unique (week_id, client_id),
  constraint week_entries_week_fkey foreign key (week_id)
    references awesome.savings_weeks(id) on delete cascade,
  -- A client can be deleted; the week keeps the name it recorded.
  constraint week_entries_client_fkey foreign key (client_id)
    references awesome.clients(id) on delete set null,
  constraint week_entries_invoice_fkey foreign key (invoice_id)
    references awesome.invoices(id) on delete set null,
  constraint week_entries_org_fkey foreign key (org_id)
    references awesome.orgs(id) on delete cascade
);

-- What a week cost, when it did not cost the usual.
--
-- While a week is open this table holds ONLY the differences: a fixed expense
-- that came in higher this week, and the one-off that nobody planned for. The
-- rest is read live from the standing list, so adding an expense today applies
-- to this week without touching any other.
--
-- When the week closes, the full list is written here as it stood, and the week
-- stops listening to the standing amounts. That is what freezes history.
create table if not exists awesome.week_expenses (
  id              uuid          not null default gen_random_uuid(),
  org_id          uuid          not null,
  week_id         uuid          not null,
  -- Null for a one-off that is not on the standing list at all.
  expense_item_id uuid,
  name            text          not null,
  category        text          not null default 'australia',
  amount          numeric(12,2) not null,
  -- override  this standing expense cost something different this week
  -- oneoff    something that happened once
  -- snapshot  written at close, a copy of the standing amount as it then was
  kind            text          not null default 'oneoff',
  note            text,
  created_at      timestamptz   not null default now(),
  updated_at      timestamptz   not null default now(),
  constraint week_expenses_pkey primary key (id),
  constraint week_expenses_kind_check check (kind in ('override', 'oneoff', 'snapshot')),
  constraint week_expenses_amount_check check (amount >= 0),
  constraint week_expenses_name_not_blank check (btrim(name) <> ''),
  constraint week_expenses_week_fkey foreign key (week_id)
    references awesome.savings_weeks(id) on delete cascade,
  constraint week_expenses_item_fkey foreign key (expense_item_id)
    references awesome.expense_items(id) on delete set null,
  constraint week_expenses_org_fkey foreign key (org_id)
    references awesome.orgs(id) on delete cascade
);

create index if not exists savings_weeks_org_idx
  on awesome.savings_weeks (org_id, week_start desc);
create index if not exists savings_weeks_open_idx
  on awesome.savings_weeks (org_id, week_start) where closed_at is null;
create index if not exists week_entries_week_idx
  on awesome.week_entries (week_id, sort_order);
create index if not exists week_entries_org_idx
  on awesome.week_entries (org_id);
create index if not exists week_entries_invoice_idx
  on awesome.week_entries (invoice_id) where invoice_id is not null;
create index if not exists week_expenses_week_idx
  on awesome.week_expenses (week_id);
create index if not exists week_expenses_org_idx
  on awesome.week_expenses (org_id);

drop trigger if exists trg_savings_weeks_touch on awesome.savings_weeks;
create trigger trg_savings_weeks_touch
  before update on awesome.savings_weeks
  for each row execute function awesome.touch_updated_at();

drop trigger if exists trg_week_entries_touch on awesome.week_entries;
create trigger trg_week_entries_touch
  before update on awesome.week_entries
  for each row execute function awesome.touch_updated_at();

drop trigger if exists trg_week_expenses_touch on awesome.week_expenses;
create trigger trg_week_expenses_touch
  before update on awesome.week_expenses
  for each row execute function awesome.touch_updated_at();

alter table awesome.savings_weeks enable row level security;
alter table awesome.week_entries  enable row level security;
alter table awesome.week_expenses enable row level security;

revoke all on awesome.savings_weeks from public, anon, authenticated;
revoke all on awesome.week_entries  from public, anon, authenticated;
revoke all on awesome.week_expenses from public, anon, authenticated;

grant all on awesome.savings_weeks to service_role;
grant all on awesome.week_entries  to service_role;
grant all on awesome.week_expenses to service_role;
