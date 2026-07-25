-- Separate email template for sending a client their account statement (the
-- outstanding-payment reminder). Different wording from the invoice email.
-- Placeholders the gateway fills: {client_name}, {business_name}.

alter table awesome.company_profile
  add column if not exists statement_subject_template text not null
    default 'Account statement from {business_name}',
  add column if not exists statement_body_template text not null
    default 'Hi {client_name},

Please find attached your current account statement from {business_name}, showing the invoices still outstanding. Payment details are on each invoice; if you have any questions, just reply to this email.

Thanks,
{business_name}';
