-- The dashboard assistant's allowance drops from 20 messages to 10.
--
-- It runs on this deployment's own AI account, so every message a trial sends
-- is billed here. Ten is enough to see what the assistant does and to decide
-- whether connecting an AI of your own is worth it, which is the only thing
-- the allowance was ever there to buy. Anybody who wants more connects their
-- own assistant, which runs on their account and has no ceiling here.
--
-- Both halves matter. The default is what every business created from now on
-- gets; the update is what the ones already here get, because a limit that
-- only applies to future sign-ups is not the limit, it is two limits.
--
-- Awesome is not a trial and its allowance is null, meaning unlimited, so
-- neither statement can reach it: one only changes a default, and the other is
-- fenced on is_demo and on the allowance not already being null.

alter table awesome.orgs alter column max_ai_messages set default 10;

update awesome.orgs
   set max_ai_messages = 10
 where is_demo
   and max_ai_messages is not null;
