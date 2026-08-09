-- Multi-tenant, step 2 of 3: every row learns which organisation it belongs to.
--
-- Purely additive and reversible in spirit: no row is rewritten beyond gaining
-- an org_id, and every existing row belongs to organisation #1. The app keeps
-- working untouched while this lands, because nothing reads org_id yet.
--
-- What deliberately does NOT happen here: the `nextval` default on
-- invoice_number stays, and so does the sequence. They are only retired in
-- step 3, once create_invoice hands out numbers from orgs.next_invoice_number.
-- Dropping the default earlier would break every insert in between.

-- ---------------------------------------------------------------------------
-- 1. Add the column, nullable for now.
-- ---------------------------------------------------------------------------
alter table awesome.issuers       add column if not exists org_id uuid;
alter table awesome.clients       add column if not exists org_id uuid;
alter table awesome.invoices      add column if not exists org_id uuid;
alter table awesome.invoice_items add column if not exists org_id uuid;
alter table awesome.agent_keys    add column if not exists org_id uuid;

-- ---------------------------------------------------------------------------
-- 2. Backfill. Everything that exists today is Awesome's.
-- ---------------------------------------------------------------------------
update awesome.issuers    set org_id = '00000000-0000-0000-0000-000000000001' where org_id is null;
update awesome.clients    set org_id = '00000000-0000-0000-0000-000000000001' where org_id is null;
update awesome.invoices   set org_id = '00000000-0000-0000-0000-000000000001' where org_id is null;
update awesome.agent_keys set org_id = '00000000-0000-0000-0000-000000000001' where org_id is null;

-- Line items follow their invoice rather than a constant, so this statement is
-- still correct the day a second organisation exists.
update awesome.invoice_items it
   set org_id = i.org_id
  from awesome.invoices i
 where i.id = it.invoice_id and it.org_id is null;

-- ---------------------------------------------------------------------------
-- 3. Make it mandatory and enforced.
-- ---------------------------------------------------------------------------
alter table awesome.issuers       alter column org_id set not null;
alter table awesome.clients       alter column org_id set not null;
alter table awesome.invoices      alter column org_id set not null;
alter table awesome.invoice_items alter column org_id set not null;
alter table awesome.agent_keys    alter column org_id set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'issuers_org_fkey') then
    alter table awesome.issuers add constraint issuers_org_fkey
      foreign key (org_id) references awesome.orgs(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'clients_org_fkey') then
    alter table awesome.clients add constraint clients_org_fkey
      foreign key (org_id) references awesome.orgs(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'invoices_org_fkey') then
    alter table awesome.invoices add constraint invoices_org_fkey
      foreign key (org_id) references awesome.orgs(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'invoice_items_org_fkey') then
    alter table awesome.invoice_items add constraint invoice_items_org_fkey
      foreign key (org_id) references awesome.orgs(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'agent_keys_org_fkey') then
    alter table awesome.agent_keys add constraint agent_keys_org_fkey
      foreign key (org_id) references awesome.orgs(id) on delete cascade;
  end if;
end $$;

-- Every scoped query filters on org_id first, so every table gets an index on
-- it, and the hot lookups get a composite one.
create index if not exists issuers_org_idx        on awesome.issuers (org_id);
create index if not exists clients_org_idx        on awesome.clients (org_id);
create index if not exists agent_keys_org_idx     on awesome.agent_keys (org_id);
create index if not exists invoice_items_org_idx  on awesome.invoice_items (org_id);
create index if not exists invoices_org_status_idx on awesome.invoices (org_id, status);
create index if not exists invoices_org_date_idx   on awesome.invoices (org_id, invoice_date desc);

-- ---------------------------------------------------------------------------
-- 4. Uniqueness becomes per organisation.
--
-- Invoice numbers: two businesses must both be able to have a #1. This is the
-- constraint that made per-org numbering impossible before.
-- ABNs: globally unique in the real world, but a guest typing a made-up number
-- must not collide with, or learn about, another organisation's row.
-- ---------------------------------------------------------------------------
alter table awesome.invoices drop constraint if exists invoices_invoice_number_key;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'invoices_org_number_key') then
    alter table awesome.invoices add constraint invoices_org_number_key
      unique (org_id, invoice_number);
  end if;
end $$;

alter table awesome.issuers drop constraint if exists issuers_abn_key;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'issuers_org_abn_key') then
    alter table awesome.issuers add constraint issuers_org_abn_key
      unique (org_id, abn);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Line items can never drift from their invoice.
--
-- org_id on invoice_items is denormalised on purpose (it makes scoped reads and
-- purges single-table), so it must not be possible to set it wrong. The trigger
-- that already computes `amount` now also stamps the owner, ignoring whatever
-- the caller passed.
-- ---------------------------------------------------------------------------
create or replace function awesome.item_before_write()
returns trigger
language plpgsql
set search_path to ''
as $function$
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
