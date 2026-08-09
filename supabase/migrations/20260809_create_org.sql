-- Onboarding: one call that turns a signed-in stranger into a working business.
--
-- Three inserts have to succeed together or not at all: the organisation, the
-- membership that grants its owner access, and the single issuer that ends up
-- printed on their invoices. A half-created org would leave someone signed in
-- with no way forward and no way back, so this is one function.
--
-- Guests get is_demo = true and the trial quotas from the column defaults. Only
-- Awesome (org #1) has null quotas, and nothing here can grant them.

create or replace function awesome.create_org(
  p_user_id      uuid,
  p_email        text,
  p_display_name text,          -- how this person signs their invoices
  p_name         text,          -- the business name, PRINTED on documents
  p_issuer_name  text,          -- who holds the ABN/TFN; often the same
  p_tax_id       text,
  p_tax_id_label text default 'ABN',
  p_entity_type  text default 'sole_trader',
  p_address_line text default null,
  p_suburb       text default null,
  p_state        text default null,
  p_postcode     text default null,
  p_contact_email text default null,
  p_phone        text default null,
  p_bank_name         text default null,
  p_bank_bsb          text default null,
  p_bank_account_no   text default null,
  p_bank_account_name text default null,
  p_payment_note      text default null,
  p_terms_days   integer default 7,
  p_timezone     text default 'Australia/Sydney'
)
returns awesome.orgs
language plpgsql
security definer
set search_path to 'awesome', 'pg_catalog'
as $$
declare
  v_org awesome.orgs;
begin
  if p_user_id is null then
    raise exception 'create_org: a signed-in user is required';
  end if;
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'create_org: the business name is required';
  end if;
  if coalesce(btrim(p_tax_id), '') = '' then
    raise exception 'create_org: the % is required', coalesce(p_tax_id_label, 'ABN');
  end if;

  -- One organisation per person, for now. The unique index on org_members
  -- would catch this anyway; this just says so in words the UI can show.
  if exists (select 1 from awesome.org_members m where m.user_id = p_user_id) then
    raise exception 'create_org: this account already belongs to a business';
  end if;

  insert into awesome.orgs (
    name, display_name, entity_type, tax_id_label,
    address_line, suburb, state, postcode, email, phone,
    bank_name, bank_bsb, bank_account_no, bank_account_name, payment_note,
    terms_days, timezone,
    invoice_number_start, next_invoice_number,
    is_demo
  ) values (
    btrim(p_name),
    btrim(p_name),
    coalesce(p_entity_type, 'sole_trader'),
    coalesce(p_tax_id_label, 'ABN'),
    p_address_line, p_suburb, coalesce(p_state, 'NSW'), p_postcode,
    coalesce(p_contact_email, p_email), p_phone,
    p_bank_name, p_bank_bsb, p_bank_account_no, p_bank_account_name,
    p_payment_note,
    coalesce(p_terms_days, 7),
    coalesce(p_timezone, 'Australia/Sydney'),
    1, 1,
    true
  )
  returning * into v_org;

  insert into awesome.org_members (org_id, user_id, email, display_name, role)
  values (
    v_org.id,
    p_user_id,
    p_email,
    coalesce(nullif(btrim(p_display_name), ''), split_part(p_email, '@', 1)),
    'owner'
  );

  -- Exactly one issuer, built from the onboarding details. A guest never picks
  -- an ABN on the invoice form because there is only ever one to pick.
  insert into awesome.issuers (org_id, full_name, short_name, abn)
  values (
    v_org.id,
    coalesce(nullif(btrim(p_issuer_name), ''), btrim(p_name)),
    left(coalesce(nullif(btrim(p_issuer_name), ''), btrim(p_name)), 20),
    btrim(p_tax_id)
  );

  return v_org;
end;
$$;

revoke execute on function awesome.create_org(
  uuid, text, text, text, text, text, text, text, text, text, text, text,
  text, text, text, text, text, text, text, integer, text
) from public;
grant execute on function awesome.create_org(
  uuid, text, text, text, text, text, text, text, text, text, text, text,
  text, text, text, text, text, text, text, integer, text
) to service_role;
