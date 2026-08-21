-- =====================================================================
--  Two things a gateway needs once real agents are using it: a retry
--  that cannot bill a client twice, and a record of what was attempted.
--
--  1. `agent_writes` remembers the answer a create already gave, keyed
--     by a value the caller can reproduce. An agent whose request timed
--     out retries with the same key and gets the SAME invoice back
--     instead of raising a second one. Entries live a day: long enough
--     for any retry, short enough that the table stays small.
--
--  2. `agent_calls` is an append-only log of every tool call, including
--     the ones that were refused. The denials are the useful rows: a run
--     of them is an agent asking for something it was never granted.
--     Deliberately NOT stored: the arguments and the results. They are
--     the business's data, and a log that duplicates the database is a
--     second copy to protect for no gain.
-- =====================================================================

create table if not exists awesome.agent_writes (
  id              uuid        not null default gen_random_uuid(),
  org_id          uuid        not null,
  tool            text        not null,
  idempotency_key text        not null,
  result          jsonb       not null,
  created_at      timestamptz not null default now(),
  constraint agent_writes_pkey primary key (id),
  -- What makes a retry safe. The org is part of it so two businesses can
  -- use the same key value without ever seeing each other's answer.
  constraint agent_writes_key_unique unique (org_id, tool, idempotency_key),
  constraint agent_writes_org_fkey foreign key (org_id)
    references awesome.orgs(id) on delete cascade
);

comment on table awesome.agent_writes is
  'Remembered results of idempotent creates, so a retried call returns the original record instead of making a second one. Expires after a day.';

create table if not exists awesome.agent_calls (
  id               uuid        not null default gen_random_uuid(),
  org_id           uuid        not null,
  at               timestamptz not null default now(),
  -- The credential's own id, kept without a foreign key on purpose: a key
  -- can be deleted, and the history of what it did must survive it.
  credential_id    uuid,
  credential_label text        not null,
  via              text        not null,
  tool             text        not null,
  outcome          text        not null,
  -- Short, and never the arguments: the error, or which permission was
  -- missing.
  detail           text,
  -- The one obvious record involved, when there is one (an invoice
  -- number, a client's name). Enough to read the log without opening it
  -- against the database.
  target           text,
  constraint agent_calls_pkey primary key (id),
  constraint agent_calls_outcome_check check (outcome in ('ok', 'denied', 'error')),
  constraint agent_calls_via_check check (via in ('key', 'oauth', 'session')),
  constraint agent_calls_org_fkey foreign key (org_id)
    references awesome.orgs(id) on delete cascade
);

comment on table awesome.agent_calls is
  'Append-only record of every gateway tool call, refusals included. Arguments and results are never stored.';

create index if not exists agent_calls_org_idx    on awesome.agent_calls (org_id, at desc);
create index if not exists agent_calls_cred_idx   on awesome.agent_calls (credential_id, at desc);
create index if not exists agent_writes_age_idx   on awesome.agent_writes (created_at);

alter table awesome.agent_writes enable row level security;
alter table awesome.agent_calls  enable row level security;

grant all on all tables in schema awesome to service_role;

-- ---------------------------------------------------------------------
--  Retention. A log with no expiry becomes the biggest table in the
--  database and nobody notices until it matters. Called daily by the
--  same cron that purges dormant trials.
-- ---------------------------------------------------------------------
create or replace function awesome.purge_agent_history(
  p_call_days  integer default 90,
  p_write_days integer default 1
)
returns table (purged_calls integer, purged_writes integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_calls  integer;
  v_writes integer;
begin
  delete from awesome.agent_calls
   where at < now() - make_interval(days => greatest(p_call_days, 1));
  get diagnostics v_calls = row_count;

  delete from awesome.agent_writes
   where created_at < now() - make_interval(days => greatest(p_write_days, 1));
  get diagnostics v_writes = row_count;

  return query select v_calls, v_writes;
end $$;

revoke all on function awesome.purge_agent_history(integer, integer) from public;
grant execute on function awesome.purge_agent_history(integer, integer) to service_role;
