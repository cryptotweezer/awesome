-- The vault: where the saving actually lives.
--
-- A week's EXCESS and what was SAVED are two different numbers, and this table
-- exists because of the gap between them. A week can come out 328 ahead and
-- only 200 of it ever reaches the vault, because the rest was needed for
-- something. The week records the excess; closing it confirms what really went
-- in. Only the confirmed figure counts as saved.
--
-- TWO VAULTS, ONE CURRENCY.
--
--   Vault AUS  every confirmed weekly saving lands here, in AUD. It is real,
--              spendable money: an unexpected expense can still come out of it.
--   Vault COL  what has been sent to Colombia through Wise, and is frozen.
--
-- Both balances are kept in AUD so that "total saved" is one number that means
-- something. A transfer also records the rate Wise gave on the day and what
-- arrived in pesos, because that is the figure he will be asked about in
-- Colombia, and the rate on the day is unrecoverable afterwards.
--
-- NOTHING IS STORED THAT CAN BE DERIVED. There is no balance column and no
-- deposit row per week. Vault AUS is the sum of what the closed weeks confirmed,
-- minus what has left it; Vault COL is what has been sent minus what has been
-- taken back out. Reopening a week and correcting what it saved therefore fixes
-- the vault on its own, with no second record to keep in step. This is the same
-- reason a loan has no balance column and an overdue invoice has no flag.
--
-- So this table holds only the money MOVING, never the money sitting still:
--
--   transfer    AUS to COL, with the rate and the pesos that arrived
--   withdrawal  money leaving a vault for something else, with its reason
--   deposit     money going in that is not a week's saving: replenishing after
--               a withdrawal, or outside money put away

create table if not exists awesome.vault_movements (
  id          uuid          not null default gen_random_uuid(),
  org_id      uuid          not null,
  kind        text          not null,
  -- Which vault the money leaves (transfer, withdrawal) or enters (deposit).
  vault       text          not null,
  -- Always AUD, always positive. The direction is the kind's job, not the
  -- sign's: a negative amount and a kind that disagrees with it is a row
  -- nobody can read twice the same way.
  amount      numeric(12,2) not null,
  -- Pesos per AUD, and what arrived, on a transfer to Colombia. Optional
  -- everywhere else. Recorded, never recalculated: the rate belonged to that
  -- minute on that platform.
  rate        numeric(14,4),
  amount_cop  numeric(16,2),
  -- The day the money actually moved, not the day it was typed in.
  occurred_on date          not null,
  -- Why. Required for a withdrawal, because a withdrawal with no reason is the
  -- one movement nobody can explain a year later.
  reason      text,
  note        text,
  -- A person's name, or an agent's label.
  recorded_by text,
  created_at  timestamptz   not null default now(),
  updated_at  timestamptz   not null default now(),
  constraint vault_movements_pkey primary key (id),
  constraint vault_movements_kind_check
    check (kind in ('transfer', 'withdrawal', 'deposit')),
  constraint vault_movements_vault_check check (vault in ('aus', 'col')),
  -- A transfer is one-way by definition: out of AUS, into COL. Money coming
  -- back from Colombia is a withdrawal from COL, which is what it feels like.
  constraint vault_movements_transfer_check
    check (kind <> 'transfer' or vault = 'aus'),
  constraint vault_movements_amount_positive check (amount > 0),
  constraint vault_movements_rate_positive check (rate is null or rate > 0),
  constraint vault_movements_cop_positive
    check (amount_cop is null or amount_cop > 0),
  constraint vault_movements_reason_check
    check (kind <> 'withdrawal' or btrim(coalesce(reason, '')) <> ''),
  constraint vault_movements_org_fkey foreign key (org_id)
    references awesome.orgs(id) on delete cascade
);

create index if not exists vault_movements_org_idx
  on awesome.vault_movements (org_id, occurred_on desc, created_at desc);

drop trigger if exists trg_vault_movements_touch on awesome.vault_movements;
create trigger trg_vault_movements_touch
  before update on awesome.vault_movements
  for each row execute function awesome.touch_updated_at();

alter table awesome.vault_movements enable row level security;

revoke all on awesome.vault_movements from public, anon, authenticated;
grant all on awesome.vault_movements to service_role;
