-- A client with no rhythm at all.
--
-- The four cadences shipped an hour ago all assume the work comes back: every
-- week, every second week, every month, every N weeks. Some of Awesome's
-- clients are not like that. They call when they want something done, and
-- there is no next time to predict.
--
-- They are not the same as "every N weeks" with a large N, and pretending
-- otherwise would put a number in front of the savings plan that nobody chose
-- and that would quietly be counted as money due. 'occasional' says the true
-- thing: this client is worth nothing to a week until the work actually
-- happens, at which point it is recorded in the week it happened, like any
-- other cadence that does not fit the two-week rotation.
--
-- The constraint is replaced rather than added to, because a check constraint
-- cannot be extended in place.

alter table awesome.clients
  drop constraint if exists clients_cadence_check;

alter table awesome.clients
  add constraint clients_cadence_check
  check (cadence in ('weekly', 'fortnightly', 'monthly', 'every_n_weeks', 'occasional'));

comment on column awesome.clients.cadence is
  'How often this client is normally done. weekly and fortnightly form the rotation; monthly and every_n_weeks are placed in the week they happened; occasional has no rhythm and is worth nothing to a week until the work is done. Drives the savings plan, not the invoicing.';
