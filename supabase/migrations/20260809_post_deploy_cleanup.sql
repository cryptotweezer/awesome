-- The last two steps of the tenancy migration, both of which had to wait until
-- the multi-business code was deployed and verified against production.
--
-- Applied 2026-08-09, after the isolation suite passed 42/42 against the live
-- gateway.

-- ---------------------------------------------------------------------
-- 1. p_org_id becomes mandatory.
--
-- It carried a default of the Awesome organisation for exactly one reason: to
-- keep the previously deployed app working in between. Leaving it would be the
-- worst kind of bug waiting to happen, because a caller that forgot the
-- organisation would not fail, it would quietly read and write the real
-- business's data.
--
-- Postgres will not remove a default with CREATE OR REPLACE, and will not let
-- a parameter without a default follow one that has it, so each function is
-- dropped and recreated with every default stripped. Every caller already
-- passes every argument by name, and this matches how schema.sql declares
-- them, so a fresh install and this database end up identical.
--
-- The definitions are taken from the catalogue rather than retyped, so the
-- bodies cannot drift from what is already running. Grants do not survive a
-- drop, so they are reapplied. One transaction: either every function ends up
-- mandatory, or nothing changes.
-- ---------------------------------------------------------------------
do $$
declare
  sigs text[];
  defs text[];
  i    integer;
  head text;
  body text;
  nl   integer;
begin
  -- Collected up front: the loop modifies pg_proc, so it must not be reading
  -- from it at the same time.
  select array_agg(p.oid::regprocedure::text order by p.proname),
         array_agg(pg_get_functiondef(p.oid) order by p.proname)
    into sigs, defs
    from pg_proc p
   where p.pronamespace = 'awesome'::regnamespace
     and pg_get_function_arguments(p.oid) like '%00000000-0000-0000-0000-000000000001%';

  if sigs is null then
    raise notice 'nothing to do: no function defaults to the Awesome organisation';
    return;
  end if;

  for i in 1 .. array_length(sigs, 1) loop
    -- The argument list is always the first line; RETURNS starts the second.
    nl   := position(E'\n' in defs[i]);
    head := regexp_replace(left(defs[i], nl - 1), ' DEFAULT [^,)]+', '', 'g');
    body := substr(defs[i], nl);

    execute format('drop function %s', sigs[i]);
    execute head || body;
    execute format('revoke all on function %s from public', sigs[i]);
    execute format('grant execute on function %s to service_role', sigs[i]);
  end loop;

  raise notice 'made p_org_id mandatory on % functions', array_length(sigs, 1);
end $$;

do $$
declare v_left integer;
begin
  select count(*) into v_left
    from pg_proc p
   where p.pronamespace = 'awesome'::regnamespace
     and pg_get_function_arguments(p.oid) like '%00000000-0000-0000-0000-000000000001%';
  if v_left <> 0 then
    raise exception '% functions still default to the Awesome organisation', v_left;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. The last two pieces of the single-business era.
--
-- `company_profile` held one row, id = 1, checked by a constraint so there
-- could never be a second. Its contents moved into `orgs` and nothing reads
-- the table any more.
--
-- `invoice_number_seq` handed out invoice numbers globally, which is precisely
-- what made it impossible for two businesses to each have a #1. Numbers now
-- come from `orgs.next_invoice_number`, one counter per business.
--
-- Guard first: refuse to drop anything if the data did not actually make it
-- across. A missing name or bank detail would only show up later, on a
-- printed invoice.
-- ---------------------------------------------------------------------
do $$
declare
  v_org awesome.orgs;
begin
  select * into v_org
    from awesome.orgs
   where id = '00000000-0000-0000-0000-000000000001';

  if not found then
    raise exception 'the original business is not in orgs; company_profile stays';
  end if;
  if coalesce(v_org.name, '') = '' or coalesce(v_org.payment_note, '') = ''
     or coalesce(v_org.bank_account_no, '') = '' then
    raise exception 'the original business is missing printed details; company_profile stays';
  end if;
  if v_org.next_invoice_number <= 1 then
    raise exception 'numbering did not carry over; the sequence stays';
  end if;
end $$;

drop table if exists awesome.company_profile;
drop sequence if exists awesome.invoice_number_seq;
