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

/**
 * What kind of client this is, which answers two questions at once: whether a
 * document is issued, and how the money arrives.
 *
 *   invoice   a document is issued, the money lands in the account
 *   transfer  no document, the money lands in the account
 *   cash      no document, money in hand on the day
 *
 * Only an `invoice` client can be invoiced. The other two exist for the savings
 * plan, and `awesome.assert_invoiceable` refuses them for every caller.
 */
export type BillingType = "invoice" | "transfer" | "cash";

/**
 * How often a client is normally done. `occasional` is the one with no rhythm:
 * they call when they want something, so they are worth nothing to a week until
 * the work actually happens.
 */
export type Cadence =
  | "weekly"
  | "fortnightly"
  | "monthly"
  | "every_n_weeks"
  | "occasional";

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
  // A cash client exists only for the savings plan: never invoiced, never in
  // the history, never on a document. Postgres refuses to bill one.
  billing_type: BillingType;
  cadence: Cadence;
  cadence_weeks: number | null; // only when cadence is 'every_n_weeks'
  // The two-week rotation. Both = done every week; neither = not on the
  // rotation, recorded in whichever week the work actually happened.
  // The day is where inside the week: ISO weekday, 1 = Monday. Null while the
  // client is in the week but the day is not decided.
  // A day is a route, so its order is the order it is worked, never
  // alphabetical. The position is reassigned to the end on every placement.
  in_week_1: boolean;
  in_week_2: boolean;
  week_1_day: number | null;
  week_2_day: number | null;
  week_1_seq: number | null;
  week_2_seq: number | null;
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

/**
 * What a week normally costs: a name and a standing weekly amount.
 *
 * Only the standing amount lives here. A week that cost something different,
 * and a one-off that happened once, belong to that week: editing this number
 * must never change a week already closed.
 */
export type ExpenseCategory = "australia" | "colombia" | "visa";

export interface ExpenseItem {
  id: string;
  org_id: string;
  name: string;
  weekly_amount: number;
  category: ExpenseCategory;
  is_active: boolean;
  /**
   * When this cost started, for one that has not always existed.
   *
   * Null means it has always been there, and every week counts it. A date means
   * only the week it falls in and the ones after it pay for it, so adding a
   * cost today cannot make a past week look as if it had been paying it.
   */
  starts_on: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

/**
 * Money owed. The first goal: the loans come out before any saving starts.
 *
 * `balance` and `paid` are worked out from the payments on read, never stored.
 * A stored balance is a second copy of the same truth that disagrees with the
 * payments the first time one is corrected.
 */
export interface Loan {
  id: string;
  org_id: string;
  name: string;
  principal: number;
  weekly_payment: number;
  /** Both optional: some loans are paid on a schedule, others whenever there is money. */
  started_on: string | null;
  ends_on: string | null;
  notes: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface LoanWithBalance extends Loan {
  paid: number;
  balance: number;
  /** Whole weeks left at the current weekly payment, null if nothing is paid weekly. */
  weeks_left: number | null;
}

export interface LoanPayment {
  id: string;
  org_id: string;
  loan_id: string;
  amount: number;
  /**
   * Which vault paid for it, when one did.
   *
   * Null is the ordinary case: the weekly loan payment is part of what a week
   * costs and the saving never sees it. A lump out of Vault AUS or COL to knock
   * a loan down is recorded here, once, and the vault reads it from this column
   * rather than keeping a movement of its own that could disagree.
   */
  from_vault: VaultName | null;
  paid_on: string;
  note: string | null;
  recorded_by: string | null;
  created_at: string;
}

/**
 * The two numbers the savings plan is steered by, one row per business.
 * The total over the horizon is derived from `weekly_target`, never stored.
 * `starts_on` is null until it is chosen: until the loans are gone there is no
 * start date, and a default would invent one.
 */
/**
 * One savings plan. A business runs them one after another and keeps them all.
 *
 * `ends_on` is a generated column: start date plus the horizon in weeks, worked
 * out by the database so nothing can hold a different answer. A plan is
 * FINISHED when that date has gone by, which is derived and never stored, for
 * the same reason an overdue invoice is.
 */
export interface SavingsPlan {
  id: string;
  org_id: string;
  /** Optional, so a history of plans reads as something: "Visa", "Car". */
  name: string | null;
  weekly_target: number;
  horizon_months: number;
  starts_on: string;
  /** Read-only: the database works it out from the two above. */
  ends_on: string;
  notes: string | null;
  /**
   * Filed away by the owner once its last weeks had closed.
   *
   * Finished is derived from `ends_on` and always will be. This is the decision
   * that follows it: until it is set, a finished plan stays on screen, because
   * its last weeks usually close after its last date.
   */
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * A week that actually happened.
 *
 * Three states, one stored column. `pending` is derived from the date, never
 * stored, for the same reason an overdue invoice is: a stored state goes stale
 * at midnight and needs somebody to remember to move it.
 */
export type WeekState = "open" | "pending" | "closed";

export interface SavingsWeek {
  id: string;
  org_id: string;
  /** The plan this week was run under. Plans never overlap, so there is one. */
  plan_id: string;
  week_start: string;
  week_end: string;
  rotation_week: 1 | 2;
  closed_at: string | null;
  closed_by: string | null;
  /** Frozen at close. Null while the week is still being worked out live. */
  income_total: number | null;
  expenses_total: number | null;
  saved_amount: number | null;
  target_amount: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type EntrySource = "rotation" | "adhoc" | "oneoff";
export type EntryStatus = "expected" | "done" | "skipped";
/**
 * How ONE week's line was settled, which is not always the client's usual way.
 *
 *   account   covered by an invoice, so the week needs that invoice paid
 *   transfer  money into the account with no invoice, confirmed when it lands
 *   cash      handed over on the day
 *
 * It lives on the line and not only on the client because a client who normally
 * transfers can hand over cash once, and saying so here is how that week
 * closes.
 */
export type PaymentMethod = "cash" | "account" | "transfer";

export interface WeekEntry {
  id: string;
  org_id: string;
  week_id: string;
  /** Null for a one-off job: it belongs to the week and creates no client. */
  client_id: string | null;
  client_name: string;
  source: EntrySource;
  status: EntryStatus;
  /** The day it actually happened, which can differ from the rotation's day. */
  day: number | null;
  amount: number;
  extra_amount: number;
  extra_note: string | null;
  method: PaymentMethod;
  paid: boolean;
  paid_on: string | null;
  /** The invoice covering this line, when there is one. Payment is read from it. */
  invoice_id: string | null;
  /**
   * The linked invoice, joined in on every read and never stored here.
   *
   * A week line is the primary record of the work; the invoice is the document
   * that bills it. Reading the number and the state instead of copying them is
   * what lets an invoice marked paid anywhere show up on its week with nothing
   * to keep in step.
   */
  invoice_number?: number | null;
  invoice_status?: InvoiceStatus | null;
  invoice_date?: string | null;
  note: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export type WeekExpenseKind = "override" | "oneoff" | "snapshot";

export interface WeekExpense {
  id: string;
  org_id: string;
  week_id: string;
  expense_item_id: string | null;
  name: string;
  category: ExpenseCategory;
  amount: number;
  kind: WeekExpenseKind;
  note: string | null;
  created_at: string;
  updated_at: string;
}

/** A done service whose money has not landed, and what it is waiting for. */
export interface CloseBlocker {
  entry_id: string;
  client_name: string;
  amount: number;
  /**
   * not_invoiced  on account, no invoice raised yet
   * not_paid      on account, invoice raised and not paid
   * not_received  transfer expected, nothing marked received
   */
  reason: "not_invoiced" | "not_paid" | "not_received";
  invoice_number: number | null;
}

/** A week with everything needed to show it, and its figures worked out. */
export interface WeekDetail {
  week: SavingsWeek;
  state: WeekState;
  entries: WeekEntry[];
  expenses: WeekExpense[];
  /** What the week took in: done entries plus their extras. */
  income: number;
  /**
   * What the week is worth if it goes to plan: every job not cancelled,
   * whether its day has come round yet or not. The figure a running week is
   * read on, since on Monday nothing has happened and `income` is near zero.
   */
  expected_income: number;
  /** Of that income, what has actually been received. */
  received: number;
  /** Still to arrive: done but not paid. This is what keeps a week open. */
  outstanding: number;
  expenses_total: number;
  /**
   * The week's money split by where it lands, over the same lines the headline
   * income is read on.
   *
   * `cash_in` is everything settled outside an invoice, so cash in hand AND a
   * transfer straight into the account: both are there the week the work is
   * done and both pay the bills. `invoiced_in` is the rest, which waits on an
   * invoice being raised and paid.
   */
  cash_in: number;
  invoiced_in: number;
  /** Of the week's costs, how much the cash covers. */
  covered_by_cash: number;
  /** What the cash did not reach, so the invoicing has to carry it. */
  short_from_invoicing: number;
  /** Cash left once the costs are paid. Zero when the cash fell short. */
  cash_left: number;
  /** income - expenses. The surplus, which is the saving. */
  saved: number;
  /**
   * expected_income - expenses. What the week is worth once everything is paid
   * for, and never the same thing as `saved`: a week 328 ahead can put 200 in
   * the vault. A closed week keeps both.
   */
  surplus: number;
  target: number;
  /** saved - target. Negative is what the plan is owed for this week. */
  against_target: number;
  /** What stops this week closing: invoiced work not billed, or not paid. */
  blockers: CloseBlocker[];
}

/**
 * The two vaults, both counted in AUD.
 *
 *   aus  every confirmed weekly saving lands here, and it is still spendable
 *   col  what has been sent to Colombia, and is frozen
 */
export type VaultName = "aus" | "col";

/**
 * Money MOVING between or out of the vaults. What sits still is never stored:
 * a balance is worked out from the weeks that closed and the movements here.
 *
 *   transfer    aus to col, carrying the rate of the day and the pesos that landed
 *   withdrawal  out of a vault for something else, with its reason
 *   deposit     in, and not from a week: replenishing, or outside money
 */
export type VaultMovementKind = "transfer" | "withdrawal" | "deposit";

export interface VaultMovement {
  id: string;
  org_id: string;
  kind: VaultMovementKind;
  /** The vault it leaves, or for a deposit the one it enters. */
  vault: VaultName;
  /** Always AUD, always positive. The kind says which way it went. */
  amount: number;
  /** Pesos per AUD on the day, on a transfer. Recorded, never recalculated. */
  rate: number | null;
  amount_cop: number | null;
  occurred_on: string;
  reason: string | null;
  note: string | null;
  recorded_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Where the saving stands, worked out from the closed weeks and the movements. */
export interface VaultStatus {
  /** Confirmed at close, summed over every closed week of the business. */
  from_weeks: number;
  weeks_closed: number;
  transferred_to_col: number;
  withdrawn_aus: number;
  withdrawn_col: number;
  deposited_aus: number;
  deposited_col: number;
  /** Loan payments taken out of each vault. They live on the payment itself. */
  loans_paid_aus: number;
  loans_paid_col: number;
  /** Which loans that money went to, so the figure can be read as a story. */
  loans_paid: {
    loan_id: string;
    name: string;
    aus: number;
    col: number;
    total: number;
    payments: number;
  }[];
  /** How many transfers have gone to Colombia, and the pesos they bought. */
  transfers_to_col: number;
  sent_cop: number;
  /** from_weeks + deposits - withdrawals - what was sent to Colombia. */
  aus: number;
  /** What was sent, plus deposits there, minus what came back out. */
  col: number;
  /** aus + col. The saving, as it really stands today. */
  total: number;
  /** The pesos sitting in Colombia, from the rates of the days they were sent. */
  col_cop: number;
  /** What the closed weeks asked for, so the vault can be read against the plan. */
  target_so_far: number;
}

/**
 * One line of the vault's history, whatever kind of thing it was.
 *
 * A loan paid out of the vault is not a `vault_movement`: it is a
 * `loan_payment` that says which vault paid for it, so the loan and the vault
 * read one record. It still belongs on this list, because from the vault's side
 * it is money that left on a day.
 */
export interface VaultEntry {
  id: string;
  kind: VaultMovementKind | "loan_payment";
  vault: VaultName;
  amount: number;
  rate: number | null;
  amount_cop: number | null;
  occurred_on: string;
  reason: string | null;
  note: string | null;
  recorded_by: string | null;
  /** The loan it paid, when it is a loan payment. */
  loan_id: string | null;
}

/**
 * The kinds of claim a deduction can be, kept short and fixed so a year can be
 * grouped and an agent cannot invent a new one each time. `other` plus the
 * description is the escape hatch.
 */
export type DeductionCategory =
  | "vehicle"
  | "tools"
  | "equipment"
  | "supplies"
  | "phone_internet"
  | "insurance"
  | "fees"
  | "travel"
  | "clothing"
  | "other";

/**
 * What the accountant takes off, for ONE ABN in one financial year.
 *
 * Not a weekly cost and never to be confused with one: an `expense_item`
 * belongs to a week and to the household, this belongs to a date and to the
 * person who claims it. The same fuel can be both, as two rows, because they
 * are two different questions asked of the same money.
 */
export interface TaxDeduction {
  id: string;
  org_id: string;
  issuer_id: string;
  spent_on: string;
  amount: number;
  category: DeductionCategory;
  description: string;
  note: string | null;
  recorded_by: string | null;
  created_at: string;
  updated_at: string;
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
