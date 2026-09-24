-- A loan payment can come out of the vault, or not.
--
-- The weekly loan payment is part of what a week costs and never touches the
-- saving. But a lump out of Vault AUS or Vault COL to knock a loan down is a
-- real thing, and the loans come first in this plan, so it has to be recordable.
--
-- ONE RECORD, NOT TWO. The payment stays in `loan_payments`, which is where the
-- loan's balance already comes from, and this column says which vault paid for
-- it. The vault reads it. A second row in `vault_movements` describing the same
-- payment would be a copy of the same truth, and the first time one of them was
-- corrected the two would disagree with no way to tell which is right.
--
-- Null means what it has always meant: paid out of the week's money, and the
-- vault knows nothing about it.
alter table awesome.loan_payments
  add column if not exists from_vault text;

alter table awesome.loan_payments
  drop constraint if exists loan_payments_from_vault_check;
alter table awesome.loan_payments
  add constraint loan_payments_from_vault_check
  check (from_vault is null or from_vault in ('aus', 'col'));

create index if not exists loan_payments_vault_idx
  on awesome.loan_payments (org_id, from_vault, paid_on desc)
  where from_vault is not null;
