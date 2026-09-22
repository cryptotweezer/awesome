-- A third kind of client: paid into the account, never invoiced.
--
-- Until now a client was one of two things, and the two questions were welded
-- together: 'invoice' meant a document is issued AND the money arrives by
-- transfer; 'cash' meant no document AND the money is handed over on the day.
-- Awesome has clients who are neither: the money lands in the bank like an
-- invoiced client's, and no invoice is ever raised.
--
-- They were loaded as 'invoice' clients, so every week asked for an invoice
-- that was never going to exist and refused to close without it. Marking them
-- 'cash' would have been the other lie: it would say money was collected in
-- person and pay the line automatically the day the work is done.
--
--   invoice   document issued, money into the account
--   transfer  no document, money into the account, confirmed when it lands
--   cash      no document, money in hand on the day
--
-- Only an 'invoice' client can be invoiced. `transfer` is refused exactly like
-- `cash`, by the one guard all three callers go through.

-- ---------------------------------------------------------------------
--  1. The client's kind.
-- ---------------------------------------------------------------------
alter table awesome.clients
  drop constraint if exists clients_billing_type_check;
alter table awesome.clients
  add constraint clients_billing_type_check
  check (billing_type in ('invoice', 'transfer', 'cash'));

comment on column awesome.clients.billing_type is
  'invoice = a document is issued and the money arrives in the account. '
  'transfer = no document, the money arrives in the account and is confirmed '
  'when it lands. cash = no document, money in hand on the day. Only an '
  'invoice client can be invoiced: the other two are refused by '
  'assert_invoiceable.';

-- ---------------------------------------------------------------------
--  2. How one week's line was settled.
-- ---------------------------------------------------------------------
-- The week's own column mirrors the three kinds, because it is the line that
-- decides what the week needs, not the client: a client who normally transfers
-- can hand over cash once, and saying so on the line is how a week closes.
alter table awesome.week_entries
  drop constraint if exists week_entries_method_check;
alter table awesome.week_entries
  add constraint week_entries_method_check
  check (method in ('cash', 'account', 'transfer'));

comment on column awesome.week_entries.method is
  'How THIS week was settled, which is not always the client''s usual way. '
  'account = covered by an invoice, so the week cannot close until that '
  'invoice exists and is paid. transfer = money into the account with no '
  'invoice, so the week cannot close until it is marked received. cash = '
  'handed over on the day.';

-- ---------------------------------------------------------------------
--  3. Who can be invoiced.
-- ---------------------------------------------------------------------
-- One function, so there is one refusal and one wording, and so a caller added
-- later cannot ship without it.
create or replace function awesome.assert_invoiceable(p_client awesome.clients)
returns void
language plpgsql immutable
set search_path to 'awesome', 'pg_catalog'
as $$
begin
  if p_client.billing_type <> 'invoice' then
    raise exception
      '% is a % client and is never invoiced. They are tracked in the savings plan, not in billing. Change them to an invoiced client first if that is what you meant.',
      p_client.name, p_client.billing_type;
  end if;
end;
$$;

-- CREATE FUNCTION hands EXECUTE to PUBLIC, and the lockdown loop in
-- schema.sql ran long ago: without this, recreating a function quietly
-- reopens it. This is how create_invoice came unlocked once before.
revoke all on function awesome.assert_invoiceable(awesome.clients)
  from public, anon, authenticated;
grant execute on function awesome.assert_invoiceable(awesome.clients)
  to service_role;
