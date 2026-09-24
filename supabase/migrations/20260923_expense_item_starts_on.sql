-- A fixed cost that did not always exist.
--
-- The standing list is "what a normal week costs", and until now every item on
-- it applied to every week, including the ones before it started. Adding a new
-- insurance payment in October made September look as if it had been paying it
-- too, which is wrong in the one direction that matters: it rewrites the past.
--
-- Null is the old behaviour and the common case: this cost has always been
-- there, count it in every week. A date means it counts only from the week that
-- date falls in onwards. Closed weeks were already safe, because they froze
-- their own costs at close; this protects the open ones.
alter table awesome.expense_items
  add column if not exists starts_on date;
