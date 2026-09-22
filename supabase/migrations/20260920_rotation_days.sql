-- Which day of each rotation week a client is done on.
--
-- The rotation said who was due in week 1 and week 2, which is enough to add up
-- the money and useless for actually working. The week is worked a day at a
-- time: Monday's clients, Tuesday's clients, and when something moves it moves
-- to another day, not to another fortnight.
--
-- One day per client per week, held as the ISO weekday (1 = Monday, 7 =
-- Sunday). Null with the week flag still true means "in this week, day not
-- decided", which is a real state while a week is being arranged and should not
-- be forced into an invented Monday.
--
-- The flags stay. `in_week_1` is what says a client belongs to that week at
-- all, and the day is where inside it. Deriving the flag from "has a day" would
-- make the undecided state impossible to express.
--
-- Still the plan and not the record: moving a client from Tuesday to Thursday
-- changes what is expected from here on and never touches a week already
-- closed, which keeps its own figures.

alter table awesome.clients
  add column if not exists week_1_day smallint,
  add column if not exists week_2_day smallint;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'clients_week_1_day_check'
  ) then
    alter table awesome.clients
      add constraint clients_week_1_day_check
      check (week_1_day is null or week_1_day between 1 and 7);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'clients_week_2_day_check'
  ) then
    alter table awesome.clients
      add constraint clients_week_2_day_check
      check (week_2_day is null or week_2_day between 1 and 7);
  end if;
end $$;

comment on column awesome.clients.week_1_day is
  'ISO weekday (1 = Monday) this client is done on in rotation week 1. Null with in_week_1 true means the day is not decided yet.';
