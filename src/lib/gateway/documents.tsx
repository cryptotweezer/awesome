import "server-only";
import { renderToBuffer } from "@react-pdf/renderer";
import { createAdminClient } from "@/lib/supabase/admin";
import { getInvoiceByRef, financialYearStart } from "@/lib/data/invoices";
import { getClientStatement, getFyStatement } from "@/lib/data/statements";
import { companyProfileFromOrg } from "@/lib/data/company";
import { createBackup } from "@/lib/data/backup";
import {
  createBackupWorkbook,
  XLSX_CONTENT_TYPE,
} from "@/lib/data/backup-excel";
import { getOrg } from "@/lib/data/org";
import { loadLogo } from "@/lib/pdf/logo";
import { todayInTimezone } from "@/lib/format";
import { InvoiceDocument } from "@/lib/pdf/invoice-pdf";
import { ClientStatementDocument } from "@/lib/pdf/client-statement-pdf";
import { FyStatementDocument } from "@/lib/pdf/fy-statement-pdf";
import type { DocRef } from "./download";
import type { Client, Issuer } from "@/lib/types";

/** A document as bytes, before anybody decides how to hand it over. */
export type RenderedDoc = {
  filename: string;
  buffer: Uint8Array;
  /** Defaults to PDF, which is what every document but the backup is. */
  contentType?: string;
};
export type Pdf = { filename: string; size_bytes: number; pdf_base64: string };

function slug(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
}

/** The base64 form, for the tools that hand an agent the bytes to attach. */
export function toPdf({ filename, buffer }: RenderedDoc): Pdf {
  return {
    filename,
    size_bytes: buffer.byteLength,
    pdf_base64: Buffer.from(buffer).toString("base64"),
  };
}

/** Join invoice numbers as "1954", "1954 and 1955", "1954, 1955 and 1956". */
export function formatInvoiceList(numbers: number[]): string {
  if (numbers.length === 0) return "";
  if (numbers.length === 1) return String(numbers[0]);
  const head = numbers.slice(0, -1).join(", ");
  return `${head} and ${numbers[numbers.length - 1]}`;
}

// -- resolvers --------------------------------------------------------------

/**
 * Resolve a client by id or a loose name match, inside one organisation.
 * Throws if none / ambiguous. The org filter is not optional: without it, a
 * one-letter name match would list somebody else's customers back to the agent.
 */
export async function resolveClient(
  orgId: string,
  input: {
    client_id?: string | null;
    client?: string | null;
  },
): Promise<Client> {
  const supabase = createAdminClient();
  if (input.client_id) {
    const { data } = await supabase
      .from("clients")
      .select("*")
      .eq("org_id", orgId)
      .eq("id", input.client_id)
      .maybeSingle();
    if (!data) throw new Error(`Client ${input.client_id} not found`);
    return data as Client;
  }
  const name = input.client?.trim();
  if (!name) throw new Error(`Provide client (name) or client_id`);
  const { data } = await supabase
    .from("clients")
    .select("*")
    .eq("org_id", orgId)
    .ilike("name", `%${name}%`)
    .order("name");
  const rows = (data ?? []) as Client[];
  if (rows.length === 0) throw new Error(`No client matches "${name}"`);
  if (rows.length > 1) {
    // Prefer an exact (case-insensitive) hit if there is one.
    const exact = rows.find((r) => r.name.toLowerCase() === name.toLowerCase());
    if (exact) return exact;
    throw new Error(
      `"${name}" matches ${rows.length} clients: ${rows.map((r) => r.name).join(", ")}. Be more specific.`,
    );
  }
  return rows[0];
}

/** Resolve an issuer (ABN) by id or short/full name, inside one organisation. */
export async function resolveIssuer(
  orgId: string,
  input: {
    issuer_id?: string | null;
    issuer?: string | null;
  },
): Promise<Issuer> {
  const supabase = createAdminClient();
  if (input.issuer_id) {
    const { data } = await supabase
      .from("issuers")
      .select("*")
      .eq("org_id", orgId)
      .eq("id", input.issuer_id)
      .maybeSingle();
    if (!data) throw new Error(`Issuer ${input.issuer_id} not found`);
    return data as Issuer;
  }
  const name = input.issuer?.trim();
  if (!name) throw new Error(`Provide issuer (name) or issuer_id`);
  const { data } = await supabase
    .from("issuers")
    .select("*")
    .eq("org_id", orgId)
    .or(`short_name.ilike.%${name}%,full_name.ilike.%${name}%`);
  const rows = (data ?? []) as Issuer[];
  if (rows.length === 0) throw new Error(`No ABN matches "${name}"`);
  if (rows.length > 1) {
    const exact = rows.find(
      (r) => r.short_name.toLowerCase() === name.toLowerCase(),
    );
    if (exact) return exact;
    throw new Error(
      `"${name}" matches ${rows.length} ABNs: ${rows.map((r) => r.short_name).join(", ")}. Be more specific.`,
    );
  }
  return rows[0];
}

// -- PDF renderers ----------------------------------------------------------

/** The business behind an agent key, loaded once per document. */
async function loadOrg(orgId: string) {
  const org = await getOrg(orgId);
  if (!org) throw new Error(`Organisation ${orgId} not found`);
  return org;
}

export async function renderInvoiceDoc(
  orgId: string,
  ref: string,
): Promise<RenderedDoc> {
  const [invoice, org] = await Promise.all([
    getInvoiceByRef(orgId, ref),
    loadOrg(orgId),
  ]);
  const company = companyProfileFromOrg(org);
  if (!invoice) throw new Error(`Invoice ${ref} not found`);
  const buffer = await renderToBuffer(
    <InvoiceDocument
      invoice={invoice}
      company={company}
      logo={await loadLogo(org)}
      taxIdLabel={org.tax_id_label}
    />,
  );
  return {
    filename: `Invoice-${invoice.invoice_number}-${slug(invoice.bill_to_name)}.pdf`,
    buffer,
  };
}

export async function renderClientStatementDoc(
  orgId: string,
  clientId: string,
): Promise<RenderedDoc> {
  const org = await loadOrg(orgId);
  const statement = await getClientStatement(org, clientId);
  const company = companyProfileFromOrg(org);
  if (!statement) throw new Error(`Nothing outstanding for that client`);
  const buffer = await renderToBuffer(
    <ClientStatementDocument
      statement={statement}
      company={company}
      logo={await loadLogo(org)}
    />,
  );
  return {
    filename: `Statement-${slug(statement.client.name)}-${statement.statementDate}.pdf`,
    buffer,
  };
}

export async function renderTaxStatementDoc(
  orgId: string,
  issuerId: string,
  fyStart?: string | null,
): Promise<RenderedDoc> {
  const org = await loadOrg(orgId);
  const start =
    fyStart ||
    financialYearStart(todayInTimezone(org.timezone), org.fy_start_month);
  const statement = await getFyStatement(org, issuerId, start);
  const company = companyProfileFromOrg(org);
  if (!statement) throw new Error(`ABN not found`);
  const buffer = await renderToBuffer(
    <FyStatementDocument
      statement={statement}
      company={company}
      logo={await loadLogo(org)}
      taxIdLabel={org.tax_id_label}
    />,
  );
  return {
    // Slugged like every other filename: the issuer's own name is the one
    // place a space used to survive into "Invoices-FY-2026-27-Pitsypet PTY.pdf".
    filename: `Invoices-${statement.fyLabel.replace(/\s/g, "-")}-${slug(statement.issuer.short_name)}.pdf`,
    buffer,
  };
}

/**
 * Render whatever a download token points at. The token is the only caller:
 * it already fixed the organisation and the document when it was signed, so
 * there is nothing here to be talked into fetching something else.
 */
export async function renderDoc(
  orgId: string,
  doc: DocRef,
): Promise<RenderedDoc> {
  switch (doc.kind) {
    case "invoice":
      return renderInvoiceDoc(orgId, doc.ref);
    case "client_statement":
      return renderClientStatementDoc(orgId, doc.ref);
    case "tax_statement":
      return renderTaxStatementDoc(orgId, doc.ref, doc.fyStart);
    case "backup":
      return renderBackupDoc(orgId, doc.ref);
  }
}

/**
 * The whole business as a file. Excel by default because that is what somebody
 * means when they ask for "my data"; JSON only when they say so, since that is
 * the restorable copy rather than the readable one.
 */
export async function renderBackupDoc(
  orgId: string,
  format: "excel" | "json",
): Promise<RenderedDoc & { counts: Record<string, number> }> {
  if (format === "json") {
    const backup = await createBackup(orgId);
    return {
      filename: `awesome-backup-${backup.meta.date}.json`,
      buffer: new TextEncoder().encode(JSON.stringify(backup, null, 2)),
      contentType: "application/json; charset=utf-8",
      counts: backup.counts,
    };
  }
  const wb = await createBackupWorkbook(orgId);
  return {
    filename: wb.filename,
    buffer: wb.buffer,
    contentType: XLSX_CONTENT_TYPE,
    counts: wb.counts,
  };
}

export async function renderInvoicePdf(orgId: string, ref: string): Promise<Pdf> {
  return toPdf(await renderInvoiceDoc(orgId, ref));
}

export async function renderClientStatementPdf(
  orgId: string,
  clientId: string,
): Promise<Pdf> {
  return toPdf(await renderClientStatementDoc(orgId, clientId));
}

// -- prepare_client_email ---------------------------------------------------

export type ClientEmail = {
  to: string | null;
  client_name: string;
  subject: string;
  body: string;
  invoice_numbers: number[];
  attachments: Pdf[];
  warning?: string;
};

/**
 * Everything an agent needs to email a client their invoice(s): the recipient,
 * the filled template, and the PDF attachments. The agent sends it with its own
 * Gmail. `invoices` picks specific numbers; omitted = every unpaid invoice.
 */
export async function prepareClientEmail(
  orgId: string,
  input: {
    client_id?: string | null;
    client?: string | null;
    invoices?: number[] | null;
  },
): Promise<ClientEmail> {
  const client = await resolveClient(orgId, input);
  const supabase = createAdminClient();

  let numbers: number[];
  if (Array.isArray(input.invoices) && input.invoices.length > 0) {
    numbers = input.invoices.map(Number).filter((n) => !Number.isNaN(n));
    // Safety: explicit numbers must all belong to this client, so an agent can
    // never attach one client's invoice to another client's email. The org
    // filter matters as much as the client one now that invoice numbers repeat
    // across businesses: without it, #1 could resolve to a stranger's invoice.
    const { data } = await supabase
      .from("invoices")
      .select("invoice_number, client_id")
      .eq("org_id", orgId)
      .in("invoice_number", numbers);
    const found = (data ?? []) as { invoice_number: number; client_id: string | null }[];
    const missing = numbers.filter(
      (n) => !found.some((f) => f.invoice_number === n),
    );
    if (missing.length) {
      throw new Error(`Invoice(s) not found: ${missing.join(", ")}`);
    }
    const wrong = found
      .filter((f) => f.client_id !== client.id)
      .map((f) => f.invoice_number);
    if (wrong.length) {
      throw new Error(
        `Invoice(s) ${wrong.join(", ")} do not belong to ${client.name}`,
      );
    }
  } else {
    const { data } = await supabase
      .from("invoices")
      .select("invoice_number")
      .eq("org_id", orgId)
      .eq("client_id", client.id)
      .eq("status", "unpaid")
      .order("invoice_number", { ascending: true });
    numbers = ((data ?? []) as { invoice_number: number }[]).map(
      (r) => r.invoice_number,
    );
  }
  if (numbers.length === 0) {
    throw new Error(`No invoices to send for ${client.name}`);
  }

  const company = companyProfileFromOrg(await loadOrg(orgId));
  const invoiceList = formatInvoiceList(numbers);
  const fill = (t: string) =>
    t
      .replaceAll("{client_name}", client.name)
      .replaceAll("{invoice_list}", invoiceList)
      .replaceAll("{business_name}", company.business_name);

  const attachments = await Promise.all(
    numbers.map((n) => renderInvoicePdf(orgId, String(n))),
  );

  return {
    to: client.email ?? null,
    client_name: client.name,
    subject: fill(company.email_subject_template),
    body: fill(company.email_body_template),
    invoice_numbers: numbers,
    attachments,
    warning: client.email ? undefined : "Client has no email on file",
  };
}

export type ClientStatementEmail = {
  to: string | null;
  client_name: string;
  subject: string;
  body: string;
  attachments: Pdf[];
  warning?: string;
};

/**
 * Everything an agent needs to email a client their account statement. The
 * client is resolved once; the recipient is THAT client's email and the PDF is
 * THAT client's statement, so a statement can never reach the wrong client.
 */
export async function prepareClientStatementEmail(
  orgId: string,
  input: {
    client_id?: string | null;
    client?: string | null;
  },
): Promise<ClientStatementEmail> {
  const client = await resolveClient(orgId, input);
  const statement = await renderClientStatementPdf(orgId, client.id);
  const company = companyProfileFromOrg(await loadOrg(orgId));

  const fill = (t: string) =>
    t
      .replaceAll("{client_name}", client.name)
      .replaceAll("{business_name}", company.business_name);

  return {
    to: client.email ?? null,
    client_name: client.name,
    subject: fill(company.statement_subject_template),
    body: fill(company.statement_body_template),
    attachments: [statement],
    warning: client.email ? undefined : "Client has no email on file",
  };
}
