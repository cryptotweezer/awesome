-- Weekly costs split three ways.
--
-- The list was one flat set of names, and a flat list hides the only question
-- Andres actually asks it: how much of a week goes to living here, how much
-- leaves for Colombia, and how much is the visa costing. Those are three
-- different commitments with three different ends, and a single total tells
-- him none of it.
--
-- The three are fixed rather than a table of categories somebody maintains.
-- There are three, they are not going to drift, and a lookup table would add a
-- join and a management screen to hold data that fits in a check constraint.
-- If a fourth is ever needed it is one line here.
--
-- 'australia' is the default so the column can be not null without asking a
-- question about rows that do not exist yet. The form asks for real.

alter table awesome.expense_items
  add column if not exists category text not null default 'australia';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'expense_items_category_check'
  ) then
    alter table awesome.expense_items
      add constraint expense_items_category_check
      check (category in ('australia', 'colombia', 'visa'));
  end if;
end $$;

comment on column awesome.expense_items.category is
  'Which commitment this cost belongs to: australia (living here), colombia (money sent home), visa.';

drop index if exists awesome.expense_items_org_idx;
create index if not exists expense_items_org_idx
  on awesome.expense_items (org_id, category, sort_order, name);
