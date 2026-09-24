-- What the accountant takes off, per ABN.
--
-- This is the other half of a tax year and the app had nothing for it: the
-- invoices say what came IN under each ABN, and until now nothing said what went
-- out against it. A deduction is not a weekly cost and must never be confused
-- with one:
--
--   expense_items / week_expenses  the household's and the business's running
--                                  costs, which the savings plan lives on. They
--                                  belong to a WEEK, they are never per ABN, and
--                                  no accountant sees them.
--   tax_deductions (this table)    what one PERSON claims against one ABN in a
--                                  financial year. It belongs to a DATE and an
--                                  ABN, it never touches a week, the vault or
--                                  what a week saved, and it prints on that
--                                  ABN's tax statement.
--
-- Some real costs are both, and that is fine: the same fuel can be a weekly cost
-- on the savings side and a claim here. They are two different questions asked of
-- the same money, so they are two rows, and neither is derived from the other.
--
-- `issuer_id` is required on purpose. A deduction belongs to the person who will
-- claim it, and a cost shared between the two is entered twice, split, because
-- that is what each of them is claiming.
create table if not exists awesome.tax_deductions (
  id          uuid          not null default gen_random_uuid(),
  org_id      uuid          not null,
  -- Whose claim it is. Not nullable: a deduction against no ABN is a note.
  issuer_id   uuid          not null,
  -- The day the money was spent, which is what puts it in a financial year.
  spent_on    date          not null,
  amount      numeric(12,2) not null,
  -- The kind of claim, kept to a short fixed list so a year can be grouped and
  -- an agent cannot invent a new one every time. `other` plus the description is
  -- the escape hatch for anything that does not fit.
  category    text          not null default 'other',
  description text          not null,
  -- Anything worth remembering. Never printed on a client's document, because
  -- this table never reaches one.
  note        text,
  -- A person's name, or an agent's label.
  recorded_by text,
  created_at  timestamptz   not null default now(),
  updated_at  timestamptz   not null default now(),
  constraint tax_deductions_pkey primary key (id),
  constraint tax_deductions_amount_positive check (amount > 0),
  constraint tax_deductions_description_not_blank
    check (btrim(description) <> ''),
  constraint tax_deductions_category_check check (category in (
    'vehicle',        -- fuel, rego, repairs, the car it takes to get there
    'tools',          -- what the work is done with
    'equipment',      -- a machine, a phone, a laptop
    'supplies',       -- what gets used up: chemicals, bags, cloths
    'phone_internet',
    'insurance',
    'fees',           -- accountant, bank, licences, subscriptions
    'travel',
    'clothing',       -- uniforms and protective gear
    'other'
  )),
  constraint tax_deductions_issuer_fkey foreign key (issuer_id)
    references awesome.issuers(id) on delete cascade,
  constraint tax_deductions_org_fkey foreign key (org_id)
    references awesome.orgs(id) on delete cascade
);

create index if not exists tax_deductions_org_idx
  on awesome.tax_deductions (org_id, spent_on desc);
create index if not exists tax_deductions_issuer_idx
  on awesome.tax_deductions (issuer_id, spent_on desc);

drop trigger if exists trg_tax_deductions_touch on awesome.tax_deductions;
create trigger trg_tax_deductions_touch
  before update on awesome.tax_deductions
  for each row execute function awesome.touch_updated_at();

alter table awesome.tax_deductions enable row level security;
revoke all on awesome.tax_deductions from public, anon, authenticated;
grant all on awesome.tax_deductions to service_role;
