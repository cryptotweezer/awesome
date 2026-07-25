-- Per-agent API keys for the gateway. Each agent (Claude, Codex, OpenClaw, Emma)
-- gets its own revocable key. We store only a SHA-256 hash of the raw key; the
-- raw key is shown once at mint time and never persisted.
--
-- RLS on, no policies (same pattern as the rest of `awesome`): only the
-- server-side service_role client reaches this table.

create table if not exists awesome.agent_keys (
  id           uuid primary key default gen_random_uuid(),
  label        text not null,          -- signs the agent's writes (created_by)
  key_hash     text not null unique,   -- sha256 hex of (pepper + raw key)
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);

alter table awesome.agent_keys enable row level security;

comment on table awesome.agent_keys is
  'Gateway API keys, one per AI agent. Only the hash is stored; service_role only.';
