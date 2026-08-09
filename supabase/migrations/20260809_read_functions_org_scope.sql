-- Multi-tenant, step 3b of 3: the read path becomes organisation-aware.
--
-- Replaces the nine read functions from 20260725_awesome_read_functions.sql and
-- 20260725_day_to_day_reads.sql.
--
-- These are the functions that would leak first. Four of them match client or
-- issuer names with `ilike '%' || p || '%'`, so before this migration a guest
-- asking for clients called "a" would have been handed the real business's
-- customer list. Every one of them is now filtered on org_id BEFORE the name
-- match is even considered.
--
-- Two helpers replace what used to be a hardcoded 'Australia/Sydney' repeated
-- in nine places: "today" and the financial-year start now come from the
-- organisation's own timezone and fy_start_month.
--
-- As in step 3a, p_org_id keeps a temporary DEFAULT so the deployed app does
-- not break between this migration and the next deploy. Removed in F1.7.

-- Old signatures must go: keeping them would leave an unscoped overload that a
-- zero-argument call would happily resolve to.
drop function if exists awesome.who_owes();
drop function if exists awesome.client_account(text);
drop function if exists awesome.recent_invoices(text, int);
drop function if exists awesome.billed_in_period(date, date, text);
drop function if exists awesome.fy_summary(date);
drop function if exists awesome.business_snapshot();
drop function if exists awesome.overdue_invoices();
drop function if exists awesome.client_summary(text);
drop function if exists awesome.find_invoices(text, text, text, date, date, int);

-- ---------------------------------------------------------------------------
-- Time, per organisation.
--
-- Never CURRENT_DATE: that is the server's UTC day, and on a UTC host it moves
-- the financial-year cut-off and flips overdue flags a day early or late.
-- ---------------------------------------------------------------------------
create or replace function awesome.org_today(p_org_id uuid)
returns date
language sql
stable
security definer
set search_path to 'awesome', 'pg_catalog'
as $$
  select (now() at time zone coalesce(
    (select o.timezone from awesome.orgs o where o.id = p_org_id),
    'Australia/Sydney'
  ))::date;
$$;

create or replace function awesome.org_fy_start(p_org_id uuid)
returns date
language sql
stable
security definer
set search_path to 'awesome', 'pg_catalog'
as $$
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

-- ---------------------------------------------------------------------------
-- who_owes(): one row per client with an unpaid balance.
-- ---------------------------------------------------------------------------
create or replace function awesome.who_owes(
  p_org_id uuid default '00000000-0000-0000-0000-000000000001'
)
returns table(
  client_name    text,
  invoice_count  int,
  amount         numeric,
  overdue_count  int,
  overdue_amount numeric
)
language sql
stable
security definer
set search_path to 'awesome', 'pg_catalog'
as $$
  select
    bill_to_name,
    count(*)::int,
    sum(balance_due),
    count(*) filter (where due_date < awesome.org_today(p_org_id))::int,
    coalesce(sum(balance_due) filter (where due_date < awesome.org_today(p_org_id)), 0)
  from awesome.invoices
  where org_id = p_org_id
    and status = 'unpaid'
  group by bill_to_name
  order by 5 desc, 3 desc;
$$;

-- ---------------------------------------------------------------------------
-- client_account(name): the unpaid invoices for a client (loose name match,
-- so "AAP" finds "AAP Plumbing Pty Ltd") within one organisation.
-- ---------------------------------------------------------------------------
create or replace function awesome.client_account(
  p_name   text,
  p_org_id uuid default '00000000-0000-0000-0000-000000000001'
)
returns table(
  client_name    text,
  invoice_number int,
  invoice_date   date,
  due_date       date,
  total          numeric,
  balance_due    numeric,
  overdue        boolean
)
language sql
stable
security definer
set search_path to 'awesome', 'pg_catalog'
as $$
  select
    bill_to_name,
    invoice_number,
    invoice_date,
    due_date,
    total,
    balance_due,
    (due_date < awesome.org_today(p_org_id))
  from awesome.invoices
  where org_id = p_org_id
    and status = 'unpaid'
    and bill_to_name ilike '%' || p_name || '%'
  order by invoice_number;
$$;

-- ---------------------------------------------------------------------------
-- recent_invoices(name, limit): the latest invoices, optionally for one client.
-- ---------------------------------------------------------------------------
create or replace function awesome.recent_invoices(
  p_name   text default null,
  p_limit  int  default 10,
  p_org_id uuid default '00000000-0000-0000-0000-000000000001'
)
returns table(
  invoice_number int,
  client_name    text,
  issuer         text,
  invoice_date   date,
  total          numeric,
  status         text
)
language sql
stable
security definer
set search_path to 'awesome', 'pg_catalog'
as $$
  select
    inv.invoice_number,
    inv.bill_to_name,
    i.short_name,
    inv.invoice_date,
    inv.total,
    inv.status
  from awesome.invoices inv
  join awesome.issuers i on i.id = inv.issuer_id and i.org_id = inv.org_id
  where inv.org_id = p_org_id
    and (p_name is null or inv.bill_to_name ilike '%' || p_name || '%')
  order by inv.invoice_number desc
  limit greatest(coalesce(p_limit, 10), 1);
$$;

-- ---------------------------------------------------------------------------
-- billed_in_period(from, to, issuer?): billed total per ABN in a date window,
-- cancelled excluded.
-- ---------------------------------------------------------------------------
create or replace function awesome.billed_in_period(
  p_from   date,
  p_to     date,
  p_issuer text default null,
  p_org_id uuid default '00000000-0000-0000-0000-000000000001'
)
returns table(
  issuer        text,
  invoice_count int,
  billed        numeric
)
language sql
stable
security definer
set search_path to 'awesome', 'pg_catalog'
as $$
  select
    i.short_name,
    count(*)::int,
    coalesce(sum(inv.total), 0)
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

-- ---------------------------------------------------------------------------
-- fy_summary(fy_start?): billed and paid per ABN for a financial year.
-- Defaults to the organisation's current financial year.
-- ---------------------------------------------------------------------------
create or replace function awesome.fy_summary(
  p_fy_start date default null,
  p_org_id   uuid default '00000000-0000-0000-0000-000000000001'
)
returns table(
  issuer  text,
  abn     text,
  billed  numeric,
  paid    numeric
)
language sql
stable
security definer
set search_path to 'awesome', 'pg_catalog'
as $$
  with params as (
    select coalesce(p_fy_start, awesome.org_fy_start(p_org_id)) as fy_start
  )
  select
    i.short_name,
    i.abn,
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

-- ---------------------------------------------------------------------------
-- business_snapshot(): the daily pulse, one row.
-- The left join keeps a brand new organisation returning zeros instead of no
-- row at all, which the dashboard would otherwise render as a crash.
-- ---------------------------------------------------------------------------
create or replace function awesome.business_snapshot(
  p_org_id uuid default '00000000-0000-0000-0000-000000000001'
)
returns table(
  outstanding_amount  numeric,
  outstanding_count   int,
  overdue_amount      numeric,
  overdue_count       int,
  billed_this_month   numeric,
  billed_this_fy      numeric,
  billed_all_time     numeric,
  paid_all_time       numeric
)
language sql stable security definer
set search_path to 'awesome', 'pg_catalog'
as $$
  with p as (
    select
      awesome.org_today(p_org_id)                              as today,
      date_trunc('month', awesome.org_today(p_org_id))::date    as month_start,
      awesome.org_fy_start(p_org_id)                            as fy_start
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

-- ---------------------------------------------------------------------------
-- overdue_invoices(): a flat list of every overdue unpaid invoice.
-- ---------------------------------------------------------------------------
create or replace function awesome.overdue_invoices(
  p_org_id uuid default '00000000-0000-0000-0000-000000000001'
)
returns table(
  invoice_number int,
  client_name    text,
  issuer         text,
  due_date       date,
  days_overdue   int,
  balance_due    numeric
)
language sql stable security definer
set search_path to 'awesome', 'pg_catalog'
as $$
  select
    i.invoice_number,
    i.bill_to_name,
    iss.short_name,
    i.due_date,
    (awesome.org_today(p_org_id) - i.due_date)::int,
    i.balance_due
  from awesome.invoices i
  join awesome.issuers iss on iss.id = i.issuer_id and iss.org_id = i.org_id
  where i.org_id = p_org_id
    and i.status = 'unpaid'
    and i.due_date < awesome.org_today(p_org_id)
  order by i.due_date asc;
$$;

-- ---------------------------------------------------------------------------
-- client_summary(name): a snapshot per matched client (loose name match).
-- ---------------------------------------------------------------------------
create or replace function awesome.client_summary(
  p_name   text,
  p_org_id uuid default '00000000-0000-0000-0000-000000000001'
)
returns table(
  client_name       text,
  billed_all_time   numeric,
  paid_all_time     numeric,
  outstanding       numeric,
  unpaid_count      int,
  overdue_count     int,
  last_invoice_date date
)
language sql stable security definer
set search_path to 'awesome', 'pg_catalog'
as $$
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

-- ---------------------------------------------------------------------------
-- find_invoices(...): bounded flexible search, every filter optional.
-- ---------------------------------------------------------------------------
create or replace function awesome.find_invoices(
  p_client text default null,
  p_issuer text default null,
  p_status text default null,
  p_from   date default null,
  p_to     date default null,
  p_limit  int  default 20,
  p_org_id uuid default '00000000-0000-0000-0000-000000000001'
)
returns table(
  invoice_number int,
  client_name    text,
  issuer         text,
  invoice_date   date,
  due_date       date,
  total          numeric,
  balance_due    numeric,
  status         text
)
language sql stable security definer
set search_path to 'awesome', 'pg_catalog'
as $$
  select
    i.invoice_number,
    i.bill_to_name,
    iss.short_name,
    i.invoice_date,
    i.due_date,
    i.total,
    i.balance_due,
    i.status
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

-- ---------------------------------------------------------------------------
-- Lock the surface: definer functions bypass RLS, so anon and authenticated
-- must never be able to call one.
-- ---------------------------------------------------------------------------
revoke execute on function awesome.org_today(uuid)                        from public;
revoke execute on function awesome.org_fy_start(uuid)                     from public;
revoke execute on function awesome.who_owes(uuid)                         from public;
revoke execute on function awesome.client_account(text, uuid)             from public;
revoke execute on function awesome.recent_invoices(text, int, uuid)       from public;
revoke execute on function awesome.billed_in_period(date, date, text, uuid) from public;
revoke execute on function awesome.fy_summary(date, uuid)                 from public;
revoke execute on function awesome.business_snapshot(uuid)                from public;
revoke execute on function awesome.overdue_invoices(uuid)                 from public;
revoke execute on function awesome.client_summary(text, uuid)             from public;
revoke execute on function awesome.find_invoices(text, text, text, date, date, int, uuid) from public;

grant execute on function awesome.org_today(uuid)                        to service_role;
grant execute on function awesome.org_fy_start(uuid)                     to service_role;
grant execute on function awesome.who_owes(uuid)                         to service_role;
grant execute on function awesome.client_account(text, uuid)             to service_role;
grant execute on function awesome.recent_invoices(text, int, uuid)       to service_role;
grant execute on function awesome.billed_in_period(date, date, text, uuid) to service_role;
grant execute on function awesome.fy_summary(date, uuid)                 to service_role;
grant execute on function awesome.business_snapshot(uuid)                to service_role;
grant execute on function awesome.overdue_invoices(uuid)                 to service_role;
grant execute on function awesome.client_summary(text, uuid)             to service_role;
grant execute on function awesome.find_invoices(text, text, text, date, date, int, uuid) to service_role;
