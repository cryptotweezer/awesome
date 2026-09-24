-- Closing the book on a plan that has finished.
--
-- FINISHED is still derived from the date and always will be: a plan is over
-- once `ends_on` has gone by, the same way an invoice is overdue. But finished
-- is not the same as done with. The last weeks of a plan often close days or
-- weeks after its last date, with money that arrived late, and until they do the
-- plan has to stay in front of the owner rather than drop into the history the
-- moment the calendar passes it.
--
-- So this column is the owner saying "that one is settled, file it". It is a
-- decision, not a fact about the date, which is exactly why it is stored.
alter table awesome.savings_plans
  add column if not exists archived_at timestamptz;
