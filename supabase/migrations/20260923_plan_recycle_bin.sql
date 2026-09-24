-- Thirty days to change your mind about deleting a plan.
--
-- Deleting a plan deletes its weeks, and with them the part of Vault AUS they
-- had filled, because the vault keeps no balance of its own. That is correct
-- when it is meant and unrecoverable when it is not: there is no other copy of
-- what was done each day, what was paid and what each week cost.
--
-- WHY A COPY AND NOT A FLAG. A `deleted_at` on the plan would have been less
-- code and more risk: every read of `savings_weeks` anywhere in the app would
-- have to remember to exclude the weeks of a deleted plan, and the first one
-- that forgot would quietly put a deleted plan's money back in the vault. The
-- rows here are really gone from the live tables, so nothing else needs to know
-- this table exists, the vault drops the moment the delete happens, and the
-- undo is an insert.
--
-- The payload is the plan, its weeks, the work recorded on them and what they
-- cost, exactly as they were. A restore puts them back under their ORIGINAL
-- ids, so an invoice still linked to a week line finds it again.
--
-- After thirty days `purge_deleted_plans` removes them for good, on the same
-- daily cron that trims the agent tables.
create table if not exists awesome.deleted_plans (
  id          uuid          not null default gen_random_uuid(),
  org_id      uuid          not null,
  -- The plan's own id, kept so a restore is the same plan and not a copy of it.
  plan_id     uuid          not null,
  name        text,
  starts_on   date          not null,
  ends_on     date          not null,
  -- What it held, for the line the screen shows without opening the payload.
  weeks       integer       not null default 0,
  saved       numeric(12,2) not null default 0,
  deleted_at  timestamptz   not null default now(),
  -- A person's name, or an agent's label.
  deleted_by  text,
  -- { plan, weeks, entries, expenses }, as they were.
  payload     jsonb         not null,
  constraint deleted_plans_pkey primary key (id),
  constraint deleted_plans_plan_key unique (org_id, plan_id),
  constraint deleted_plans_org_fkey foreign key (org_id)
    references awesome.orgs(id) on delete cascade
);

create index if not exists deleted_plans_org_idx
  on awesome.deleted_plans (org_id, deleted_at desc);

alter table awesome.deleted_plans enable row level security;
revoke all on awesome.deleted_plans from public, anon, authenticated;
grant all on awesome.deleted_plans to service_role;

-- The undo window, closed. Called every day by the same cron that trims the
-- agent log; thirty days is long enough to notice a mistake and short enough
-- that the bin is not a second database.
create or replace function awesome.purge_deleted_plans(p_days integer default 30)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed integer;
begin
  delete from awesome.deleted_plans
  where deleted_at < now() - (p_days || ' days')::interval;
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function awesome.purge_deleted_plans(integer) from public, anon, authenticated;
grant execute on function awesome.purge_deleted_plans(integer) to service_role;
