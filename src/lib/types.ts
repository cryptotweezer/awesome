// Domain types for the `awesome` billing schema.
// Kept hand-written (not generated) so this repo stays isolated from the
// resume/pis schemas that share the same Supabase project.

// Clients always pay the full invoice — there is no partial state. Anything
// unusual about a payment goes in `internal_notes`.
export type InvoiceStatus = "unpaid" | "paid" | "cancelled";

export interface Issuer {
  id: string;
  full_name: string;
  short_name: string; // 'Mavi' | 'Andres'
  abn: string;
  is_active: boolean;
  created_at: string;
}

export interface Client {
  id: string;
  name: string;
  address_line: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  email: string | null;
  default_issuer_id: string | null;
  default_description: string;
  default_rate: number | null;
  is_active: boolean;
  created_at: string;
}

export interface CompanyProfile {
  id: number;
  business_name: string;
  address_line: string;
  suburb: string;
  state: string;
  postcode: string;
  email: string;
  phone: string;
  bank_name: string;
  bank_bsb: string;
  bank_account_no: string;
  bank_account_name: string;
  payment_note: string;
  email_subject_template: string;
  email_body_template: string;
}

export interface AgentKey {
  id: string;
  label: string;
  is_active: boolean;
  created_at: string;
  last_used_at: string | null;
}

export interface Invoice {
  id: string;
  invoice_number: number;

  issuer_id: string;
  issuer_name: string;
  issuer_abn: string;

  client_id: string | null;
  bill_to_name: string;
  bill_to_address_line: string | null;
  bill_to_suburb: string | null;
  bill_to_state: string | null;
  bill_to_postcode: string | null;

  invoice_date: string; // when billed
  terms: string; // 'NET7'
  due_date: string; // invoice_date + 7

  currency: string; // 'AUD'
  subtotal: number;
  total: number;
  paid_amount: number;
  balance_due: number;
  status: InvoiceStatus;

  internal_notes: string | null; // not printed
  created_by: string | null; // internal signature of who made it (Ema/Claude/...)

  created_at: string;
  updated_at: string;
}

export interface InvoiceItem {
  id: string;
  invoice_id: string;
  description: string;
  service_date: string | null; // when the service was performed
  quantity: number;
  rate: number;
  amount: number; // quantity * rate
  sort_order: number;
  created_at: string;
}

/** An invoice with its line items joined in. */
export interface InvoiceWithItems extends Invoice {
  invoice_items: InvoiceItem[];
}

/** A client joined with its default issuer (for lists / statements). */
export interface ClientWithIssuer extends Client {
  issuer: Pick<Issuer, "short_name" | "abn"> | null;
}
