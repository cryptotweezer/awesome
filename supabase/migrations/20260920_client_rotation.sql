-- Which of the two weeks a client is done in.
--
-- Awesome runs on a two-week rotation. Some clients are done every week, some
-- in one of the two, and a few on no rhythm at all. Two booleans rather than a
-- single "week 1 or week 2" column, because the common case is a client who is
-- in BOTH, and a single column cannot say that without a third value that means
-- "both" and has to be special-cased everywhere it is read.
--
-- Two flags also make the screen match the decision being made. Andres is not
-- answering "which week is this client in", he is filling two weeks from the
-- same list, and a client can go in either, both or neither.
--
-- Neither means the client is not on the rotation: the monthly ones, the
-- every-few-weeks ones and the ones who call when they want something. They are
-- not forgotten, they are recorded in the week they actually happened, which is
-- the only honest thing to do with work that has no schedule.
--
-- This is the plan, not the record. A week that actually happened keeps its own
-- figures, so moving a client between weeks changes what is expected from here
-- on and never rewrites a week already closed.

alter table awesome.clients
  add column if not exists in_week_1 boolean not null default false,
  add column if not exists in_week_2 boolean not null default false;

comment on column awesome.clients.in_week_1 is
  'On the rotation in week 1. A client done every week is in both weeks; one on no rhythm is in neither and is recorded in the week it happened.';
