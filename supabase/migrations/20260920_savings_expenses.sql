-- What a week costs, before anything unusual happens to it.
--
-- Awesome's outgoings are weekly and they are nearly always the same, so the
-- savings plan starts from a short list of named amounts and works out the
-- difference from there. This table is that list and nothing more: a name and
-- what it normally costs in a week.
--
-- Deliberately NOT here, and this is the distinction the whole design rests on:
--
--   * a week where one of these cost something different. That is a property of
--     that week, not of the item. Changing the number here would change every
--     week that ever used it, including the ones already closed.
--   * a one-off cost that only ever happened once. That belongs to the week it
--     happened in and must never repeat.
--
-- Both arrive with the real weeks, in a later migration, and both point at a
-- week. What lives here is only the standing amount.
--
-- These are the household's costs as much as the business's: the plan is about
-- what is left over at the end of a week, and rent does not care which. None of
-- it is ever printed on an invoice, a client statement or the tax report, which
-- are documents about what a client owes and have nothing to do with this.
--
-- Awesome is the only business with a savings plan, but the table is org-scoped
-- like every other one, with a cascading key so a deleted business takes its
-- expenses with it. org_cascade_gaps() checks exactly that, and a test fails if
-- a new table forgets.

create table if not exists awesome.expense_items (
  id            uuid        not null default gen_random_uuid(),
  org_id        uuid        not null,
  name          text        not null,
  weekly_amount numeric(10,2) not null default 0,
  -- An item that has stopped applying is archived, not deleted: closed weeks
  -- keep their own figures, but the list should stop offering it.
  is_active     boolean     not null default true,
  sort_order    integer     not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint expense_items_pkey primary key (id),
  constraint expense_items_name_not_blank check (btrim(name) <> ''),
  constraint expense_items_amount_positive check (weekly_amount >= 0),
  constraint expense_items_org_fkey foreign key (org_id)
    references awesome.orgs(id) on delete cascade
);

create index if not exists expense_items_org_idx
  on awesome.expense_items (org_id, sort_order, name);

drop trigger if exists trg_expense_items_touch on awesome.expense_items;
create trigger trg_expense_items_touch
  before update on awesome.expense_items
  for each row execute function awesome.touch_updated_at();

-- RLS on with no policies, like every other table here: the only way in is the
-- service_role client, server side, carrying an org_id it did not get from the
-- caller.
alter table awesome.expense_items enable row level security;
revoke all on awesome.expense_items from public, anon, authenticated;
grant all on awesome.expense_items to service_role;
