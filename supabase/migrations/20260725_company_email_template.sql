-- Email template for sending invoices, stored once in company_profile so every
-- agent sends the same wording. The gateway fills the placeholders:
--   {client_name}    the client's name
--   {invoice_list}   the invoice number(s), e.g. "1954" or "1954, 1955 and 1956"
--   {business_name}  company_profile.business_name (the printed/legal name)
--
-- The client email itself lives in clients.email (internal only, never printed).

alter table awesome.company_profile
  add column if not exists email_subject_template text not null
    default 'Invoice {invoice_list} from {business_name}',
  add column if not exists email_body_template text not null
    default 'Hi {client_name},

Please find attached invoice {invoice_list} from {business_name}. Payment details are on the invoice; if you have any questions, just reply to this email.

Thanks,
{business_name}';
