-- Phase 3: read functions for the questions agents ask often.
--
-- Each returns a narrow result so an agent's context stays small. "Today" and
-- the financial-year cut-off are computed in Australia/Sydney time
-- ((now() at time zone 'Australia/Sydney')::date), never the server's UTC day.
--
-- SECURITY DEFINER + pinned search_path, EXECUTE revoked from PUBLIC and granted
-- to service_role only (they bypass RLS).

-- who_owes(): one row per client with an unpaid balance.
create or replace function awesome.who_owes()
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
    count(*) filter (
      where due_date < (now() at time zone 'Australia/Sydney')::date
    )::int,
    coalesce(sum(balance_due) filter (
      where due_date < (now() at time zone 'Australia/Sydney')::date
    ), 0)
  from awesome.invoices
  where status = 'unpaid'
  group by bill_to_name
  order by 5 desc, 3 desc;
$$;

-- client_account(name): the unpaid invoices for a client (name is matched
-- loosely, so "AAP" finds "AAP Plumbing Pty Ltd").
create or replace function awesome.client_account(p_name text)
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
    (due_date < (now() at time zone 'Australia/Sydney')::date)
  from awesome.invoices
  where status = 'unpaid'
    and bill_to_name ilike '%' || p_name || '%'
  order by invoice_number;
$$;

-- recent_invoices(name, limit): the latest invoices, optionally for one client.
create or replace function awesome.recent_invoices(
  p_name  text default null,
  p_limit int  default 10
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
  join awesome.issuers i on i.id = inv.issuer_id
  where p_name is null or inv.bill_to_name ilike '%' || p_name || '%'
  order by inv.invoice_number desc
  limit greatest(coalesce(p_limit, 10), 1);
$$;

-- billed_in_period(from, to, issuer?): billed total per ABN in a date window,
-- cancelled excluded. Optional issuer short_name filter.
create or replace function awesome.billed_in_period(
  p_from   date,
  p_to     date,
  p_issuer text default null
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
  join awesome.issuers i on i.id = inv.issuer_id
  where inv.status <> 'cancelled'
    and inv.invoice_date >= p_from
    and inv.invoice_date <= p_to
    and (p_issuer is null or i.short_name ilike '%' || p_issuer || '%')
  group by i.short_name
  order by i.short_name;
$$;

-- fy_summary(fy_start?): billed and paid per ABN for a financial year.
-- Defaults to the current Australian FY (1 Jul, Sydney time).
create or replace function awesome.fy_summary(p_fy_start date default null)
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
    select coalesce(
      p_fy_start,
      case
        when extract(month from (now() at time zone 'Australia/Sydney')::date) >= 7
          then make_date(extract(year from (now() at time zone 'Australia/Sydney')::date)::int, 7, 1)
        else make_date(extract(year from (now() at time zone 'Australia/Sydney')::date)::int - 1, 7, 1)
      end
    ) as fy_start
  )
  select
    i.short_name,
    i.abn,
    coalesce(sum(inv.total) filter (where inv.status <> 'cancelled'), 0),
    coalesce(sum(inv.total) filter (where inv.status = 'paid'), 0)
  from params p
  join awesome.invoices inv
    on inv.invoice_date >= p.fy_start
   and inv.invoice_date <  (p.fy_start + interval '1 year')
  join awesome.issuers i on i.id = inv.issuer_id
  group by i.short_name, i.abn
  order by i.short_name;
$$;

-- Lock the surface.
revoke execute on function awesome.who_owes()                        from public;
revoke execute on function awesome.client_account(text)              from public;
revoke execute on function awesome.recent_invoices(text, int)        from public;
revoke execute on function awesome.billed_in_period(date, date, text) from public;
revoke execute on function awesome.fy_summary(date)                  from public;

grant execute on function awesome.who_owes()                        to service_role;
grant execute on function awesome.client_account(text)              to service_role;
grant execute on function awesome.recent_invoices(text, int)        to service_role;
grant execute on function awesome.billed_in_period(date, date, text) to service_role;
grant execute on function awesome.fy_summary(date)                  to service_role;
