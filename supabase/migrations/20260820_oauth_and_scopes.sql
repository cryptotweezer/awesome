-- =====================================================================
--  OAuth 2.1 for agents, plus scopes on every credential.
--
--  The app becomes its own authorization server. It deliberately does NOT
--  use Supabase's OAuth server: that binds the consent screen to the
--  project's single Site URL, which this project shares with `resume` and
--  `pis`. Owning the flow here keeps the three projects uncoupled and
--  leaves the shared slot free for any of them to use later.
--
--  The hard part of being an authorization server is authenticating the
--  human, and we skip it: the person approving is already signed in to
--  this app through Supabase Auth. We only record consent and issue
--  tokens.
--
--  Nothing here changes an existing key. Every one keeps working, with
--  every scope, which is what the default on `scopes` is for.
-- =====================================================================

-- ---------------------------------------------------------------------
--  Scopes on API keys. 'read' | 'write' | 'delete'.
-- ---------------------------------------------------------------------
alter table awesome.agent_keys
  add column if not exists scopes text[] not null default array['read','write','delete'];

alter table awesome.agent_keys
  add column if not exists expires_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'agent_keys_scopes_check'
  ) then
    alter table awesome.agent_keys
      add constraint agent_keys_scopes_check
      check (scopes <@ array['read','write','delete'] and array_length(scopes, 1) >= 1);
  end if;
end $$;

comment on column awesome.agent_keys.scopes is
  'What this key may do. A tool declares the scope it needs and the gateway refuses the call without it.';
comment on column awesome.agent_keys.expires_at is
  'Optional. Null means the key does not expire.';

-- ---------------------------------------------------------------------
--  OAuth clients. Registered dynamically by the assistant itself, so a
--  row here is NOT a trusted party: it is a name the user will be shown
--  on the consent screen before deciding. Clients are global, not
--  per-org, because a client registers before it knows who will approve.
-- ---------------------------------------------------------------------
create table if not exists awesome.oauth_clients (
  id                uuid        not null default gen_random_uuid(),
  client_id         text        not null,
  client_name       text        not null,
  redirect_uris     text[]      not null,
  -- Public clients (PKCE, no secret) are the norm for assistants running on
  -- somebody's machine. A secret is stored hashed when a client sends one.
  client_secret_hash text,
  created_at        timestamptz not null default now(),
  last_used_at      timestamptz,
  constraint oauth_clients_pkey primary key (id),
  constraint oauth_clients_client_id_key unique (client_id),
  constraint oauth_clients_redirects_check check (array_length(redirect_uris, 1) >= 1)
);

-- ---------------------------------------------------------------------
--  Authorization codes. Single use, short lived, bound to one PKCE
--  challenge and one redirect URI.
-- ---------------------------------------------------------------------
create table if not exists awesome.oauth_codes (
  id             uuid        not null default gen_random_uuid(),
  code_hash      text        not null,
  client_id      text        not null,
  org_id         uuid        not null,
  user_id        uuid        not null,
  user_label     text        not null,
  scopes         text[]      not null,
  redirect_uri   text        not null,
  code_challenge text        not null,
  expires_at     timestamptz not null,
  used_at        timestamptz,
  created_at     timestamptz not null default now(),
  constraint oauth_codes_pkey primary key (id),
  constraint oauth_codes_code_hash_key unique (code_hash),
  constraint oauth_codes_org_fkey foreign key (org_id)
    references awesome.orgs(id) on delete cascade
);

-- ---------------------------------------------------------------------
--  Issued tokens. Stored hashed, exactly like an API key, so the table
--  alone cannot be replayed. Access tokens are short lived; the refresh
--  token is what the assistant keeps, and revoking the row kills both.
-- ---------------------------------------------------------------------
create table if not exists awesome.oauth_tokens (
  id                 uuid        not null default gen_random_uuid(),
  org_id             uuid        not null,
  user_id            uuid        not null,
  client_id          text        not null,
  client_name        text        not null,
  -- Signs this connection's writes, e.g. 'Claude Desktop (Andres)'.
  label              text        not null,
  scopes             text[]      not null,
  access_token_hash  text,
  access_expires_at  timestamptz,
  refresh_token_hash text,
  revoked_at         timestamptz,
  last_used_at       timestamptz,
  created_at         timestamptz not null default now(),
  constraint oauth_tokens_pkey primary key (id),
  constraint oauth_tokens_access_hash_key unique (access_token_hash),
  constraint oauth_tokens_refresh_hash_key unique (refresh_token_hash),
  constraint oauth_tokens_org_fkey foreign key (org_id)
    references awesome.orgs(id) on delete cascade
);

create index if not exists oauth_codes_expiry_idx  on awesome.oauth_codes (expires_at);
create index if not exists oauth_tokens_org_idx    on awesome.oauth_tokens (org_id);
create index if not exists oauth_tokens_live_idx   on awesome.oauth_tokens (org_id, created_at desc)
  where revoked_at is null;

-- ---------------------------------------------------------------------
--  Same posture as every other table here: RLS on with no policies, so
--  only service_role reaches them, and only from the server.
-- ---------------------------------------------------------------------
alter table awesome.oauth_clients enable row level security;
alter table awesome.oauth_codes   enable row level security;
alter table awesome.oauth_tokens  enable row level security;

grant all on awesome.oauth_clients to service_role;
grant all on awesome.oauth_codes   to service_role;
grant all on awesome.oauth_tokens  to service_role;

-- ---------------------------------------------------------------------
--  Housekeeping. Codes are worthless once used or expired, and a table of
--  dead codes is a table nobody prunes.
-- ---------------------------------------------------------------------
create or replace function awesome.purge_expired_oauth_codes()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed integer;
begin
  delete from awesome.oauth_codes
   where expires_at < now() - interval '1 hour';
  get diagnostics removed = row_count;
  return removed;
end $$;

revoke all on function awesome.purge_expired_oauth_codes() from public;
grant execute on function awesome.purge_expired_oauth_codes() to service_role;
