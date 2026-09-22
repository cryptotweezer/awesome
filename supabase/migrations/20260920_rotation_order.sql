-- The order a day is actually worked in.
--
-- A day on the rotation is a route: first this one, then that one, then the one
-- on the way home. Sorting it alphabetically throws that away and leaves a list
-- nobody can follow, which is the one thing this screen exists to be.
--
-- So each week carries a position per client, and a client placed on a day goes
-- to the end of it. Reading a day means ordering by this number, which is the
-- order they were put there, which is the order they are done in.
--
-- The position is per WEEK rather than per day, and is reassigned every time a
-- client is placed. That is what makes moving somebody from Tuesday to Thursday
-- put them at the end of Thursday instead of dropping them into the middle of
-- it carrying a number that meant something on another day.
--
-- Null sorts last: a client placed before this column existed has no position
-- until they are next moved, and ending up at the bottom of their day is a
-- better guess than pretending they are first.

alter table awesome.clients
  add column if not exists week_1_seq integer,
  add column if not exists week_2_seq integer;

comment on column awesome.clients.week_1_seq is
  'Position within rotation week 1, in the order the day is worked. Reassigned to the end whenever the client is placed.';
