-- Day-to-day read functions. All narrow (aggregated, or filtered + limited) so
-- an agent never pulls the whole invoices table into context. Overdue / month /
-- FY are computed in Australia/Sydney time.

-- business_snapshot(): the daily pulse, one row.
create or replace function awesome.business_snapshot()
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
  with t as (select (now() at time zone 'Australia/Sydney')::date as today),
  p as (
    select
      today,
      date_trunc('month', today)::date as month_start,
      case when extract(month from today) >= 7
           then make_date(extract(year from today)::int, 7, 1)
           else make_date(extract(year from today)::int - 1, 7, 1)
      end as fy_start
    from t
  )
  select
    coalesce(sum(i.balance_due) filter (where i.status = 'unpaid'), 0),
    count(*) filter (where i.status = 'unpaid')::int,
    coalesce(sum(i.balance_due) filter (where i.status = 'unpaid' and i.due_date < p.today), 0),
    count(*) filter (where i.status = 'unpaid' and i.due_date < p.today)::int,
    coalesce(sum(i.total) filter (where i.status <> 'cancelled' and i.invoice_date >= p.month_start), 0),
    coalesce(sum(i.total) filter (where i.status <> 'cancelled' and i.invoice_date >= p.fy_start), 0),
    coalesce(sum(i.total) filter (where i.status <> 'cancelled'), 0),
    coalesce(sum(i.total) filter (where i.status = 'paid'), 0)
  from p left join awesome.invoices i on true
  group by p.today, p.month_start, p.fy_start;
$$;

-- overdue_invoices(): a flat list of every overdue unpaid invoice.
create or replace function awesome.overdue_invoices()
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
    ((now() at time zone 'Australia/Sydney')::date - i.due_date)::int,
    i.balance_due
  from awesome.invoices i
  join awesome.issuers iss on iss.id = i.issuer_id
  where i.status = 'unpaid'
    and i.due_date < (now() at time zone 'Australia/Sydney')::date
  order by i.due_date asc;
$$;

-- client_summary(name): a snapshot per matched client (loose name match).
create or replace function awesome.client_summary(p_name text)
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
      where i.status = 'unpaid'
        and i.due_date < (now() at time zone 'Australia/Sydney')::date
    )::int,
    max(i.invoice_date)
  from awesome.invoices i
  where i.bill_to_name ilike '%' || p_name || '%'
  group by i.bill_to_name
  order by i.bill_to_name;
$$;

-- find_invoices(...): bounded flexible search. Every filter optional, always
-- ordered newest first and capped by p_limit.
create or replace function awesome.find_invoices(
  p_client text default null,
  p_issuer text default null,
  p_status text default null,
  p_from   date default null,
  p_to     date default null,
  p_limit  int  default 20
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
  join awesome.issuers iss on iss.id = i.issuer_id
  where (p_client is null or i.bill_to_name ilike '%' || p_client || '%')
    and (p_issuer is null or iss.short_name ilike '%' || p_issuer || '%')
    and (p_status is null or i.status = p_status)
    and (p_from is null or i.invoice_date >= p_from)
    and (p_to is null or i.invoice_date <= p_to)
  order by i.invoice_number desc
  limit greatest(coalesce(p_limit, 20), 1);
$$;

-- Lock the surface.
revoke execute on function awesome.business_snapshot()                         from public;
revoke execute on function awesome.overdue_invoices()                          from public;
revoke execute on function awesome.client_summary(text)                        from public;
revoke execute on function awesome.find_invoices(text, text, text, date, date, int) from public;

grant execute on function awesome.business_snapshot()                         to service_role;
grant execute on function awesome.overdue_invoices()                          to service_role;
grant execute on function awesome.client_summary(text)                        to service_role;
grant execute on function awesome.find_invoices(text, text, text, date, date, int) to service_role;
