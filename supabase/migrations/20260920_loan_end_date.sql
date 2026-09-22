-- A loan can have an end date, or none.
--
-- Some of these are paid on a schedule and have a date they are meant to be
-- gone by. Others are paid whenever there is money to pay them with, and any
-- date put against those would be a guess that later reads as a fact. So the
-- column is nullable and stays empty for the second kind, the same way
-- savings_plan.starts_on stays empty until the plan actually starts.
--
-- It is a target, not a rule: nothing closes a loan on this date. The balance
-- is what says whether a loan is finished, and the balance comes from the
-- payments.

alter table awesome.loans
  add column if not exists ends_on date;

comment on column awesome.loans.ends_on is
  'The day this is meant to be paid off, when there is one. A target only: the balance decides when a loan is finished.';
