// Domain types for the `awesome` billing schema.
// Kept hand-written (not generated) so this repo stays isolated from the
// resume/pis schemas that share the same Supabase project.

// Clients always pay the full invoice, there is no partial state. Anything
// unusual about a payment goes in `internal_notes`.
export type InvoiceStatus = "unpaid" | "paid" | "cancelled";

/**
 * One business. Everything below belongs to exactly one of these, and no query
 * may cross the boundary. Awesome is the first row (AWESOME_ORG_ID); every
 * other row is somebody who signed up to try the app on their own data.
 */
export interface Org {
  id: string;

  name: string; // PRINTED on documents (the legal/trading name)
  display_name: string | null; // shown in the dashboard
  entity_type: "sole_trader" | "company" | "partnership" | "trust";
  // No TFN: that is a person's private tax number and never goes on an invoice.
  tax_id_label: "ABN" | "ACN";

  address_line: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  email: string | null;
  phone: string | null;

  bank_name: string | null;
  bank_bsb: string | null;
  bank_account_no: string | null;
  bank_account_name: string | null;
  payment_note: string | null;

  email_subject_template: string;
  email_body_template: string;
  statement_subject_template: string;
  statement_body_template: string;

  // What this business always sells, if it always sells the same thing. Empty
  // for everyone except Awesome, which cleans and nothing else.
  default_service_description: string;

  // Whether a client carries an agreed service and rate (Awesome) or the work
  // is described on each invoice line (everyone else).
  per_client_defaults: boolean;

  // 10% GST, charged only by registered businesses. Prices include it, so this
  // changes how an amount is explained, never what it is.
  gst_registered: boolean;

  terms_days: number; // payment window; Awesome is 7
  timezone: string; // 'today' is resolved here, never in UTC
  fy_start_month: number; // 7 = Australian financial year

  logo_path: string | null; // in the org-logos bucket; null = built-in logo

  invoice_number_start: number;
  next_invoice_number: number;

  is_demo: boolean;
  max_invoices: number | null; // null = unlimited
  max_clients: number | null;
  max_agent_keys: number | null;
  max_ai_messages: number | null;
  ai_messages_used: number;

  onboarding: Record<string, boolean>;

  last_active_at: string;
  created_at: string;
  updated_at: string;
}

/** Which Supabase user belongs to which org. One org per user, for now. */
export interface OrgMember {
  org_id: string;
  user_id: string;
  email: string;
  display_name: string | null; // signs `invoices.created_by`
  role: "owner" | "member";
  created_at: string;
}

export interface Issuer {
  id: string;
  org_id: string;
  full_name: string;
  short_name: string; // 'Mavi' | 'Andres'
  abn: string; // eleven digits, no spaces
  acn: string | null; // nine digits; companies print both
  is_active: boolean;
  created_at: string;
}

export interface Client {
  id: string;
  org_id: string;
  name: string;
  address_line: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  email: string | null;
  default_issuer_id: string | null;
  default_description: string | null; // the usual work, if there is one
  default_rate: number | null;
  is_active: boolean;
  created_at: string;
}

/**
 * The shape the printed documents still speak. It used to be a table with a
 * single row; it is now derived from an `Org` by `companyProfileFromOrg()`.
 * The PDF layer keeps this shape until F2 gives every org its own logo.
 */
export interface CompanyProfile {
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
  statement_subject_template: string;
  statement_body_template: string;
}

export interface AgentKey {
  id: string;
  org_id: string;
  label: string;
  is_active: boolean;
  /** What this key may do: read | write | delete. */
  scopes: string[];
  /** Null means it does not expire. */
  expires_at: string | null;
  created_at: string;
  last_used_at: string | null;
}

export interface Invoice {
  id: string;
  org_id: string;
  invoice_number: number;

  issuer_id: string;
  issuer_name: string;
  issuer_abn: string;
  issuer_acn: string | null;

  client_id: string | null;
  bill_to_name: string;
  bill_to_address_line: string | null;
  bill_to_suburb: string | null;
  bill_to_state: string | null;
  bill_to_postcode: string | null;

  invoice_date: string; // when billed
  terms: string; // 'NET7', stamped from the org's terms_days at creation
  due_date: string; // invoice_date + the term stamped above

  currency: string; // 'AUD'
  subtotal: number;
  total: number; // GST included: this is what the client pays
  gst_rate: number; // 0.10 when issued under GST, 0 otherwise. Frozen at issue.
  gst_amount: number; // the tax inside `total`, not on top of it
  paid_amount: number;
  balance_due: number;
  status: InvoiceStatus;
  paid_at: string | null; // the day it was paid, in the org's timezone

  internal_notes: string | null; // not printed
  created_by: string | null; // internal signature of who made it (Ema/Claude/...)

  created_at: string;
  updated_at: string;
}

export interface InvoiceItem {
  id: string;
  org_id: string;
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
