import "server-only";
import type { Agent } from "./auth";
import { todayInTimezone } from "@/lib/format";
import { getOrg } from "@/lib/data/org";
import {
  createInvoice,
  updateInvoice,
  markPaid,
  markUnpaid,
  cancelInvoice,
  reactivateInvoice,
  deleteInvoice,
  getInvoiceByRef,
  getGstPosition,
  type NewInvoiceItem,
} from "@/lib/data/invoices";
import {
  whoOwes,
  clientAccount,
  recentInvoices,
  billedInPeriod,
  fySummary,
  businessSnapshot,
  overdueInvoices,
  clientSummary,
  findInvoices,
} from "@/lib/data/reports";
import {
  listClients,
  createClient,
  updateClient,
  type ClientInput,
} from "@/lib/data/clients";
import { listIssuers } from "@/lib/data/issuers";
import { appBaseUrl } from "@/lib/app-url";
import { signDownloadToken, type DocRef } from "./download";
import {
  renderInvoiceDoc,
  renderClientStatementDoc,
  renderTaxStatementDoc,
  renderBackupDoc,
  toPdf,
  prepareClientEmail,
  prepareClientStatementEmail,
  resolveClient,
  resolveIssuer,
  type Pdf,
  type RenderedDoc,
} from "./documents";
import type { Client } from "@/lib/types";

export type ToolInput = Record<string, unknown>;
export type ToolContext = { agent: Agent };
export type ToolHandler = (input: ToolInput, ctx: ToolContext) => Promise<unknown>;
/**
 * `schema` is the JSON Schema handed to MCP clients. Without one an agent has to
 * infer arguments from the prose description, which is how invoices were once
 * created with a blank service_date. Declare it for anything whose arguments
 * are not obvious; the MCP route falls back to a permissive object otherwise.
 */
export type ToolDef = {
  description: string;
  handler: ToolHandler;
  schema?: Record<string, unknown>;
};

/** Build a JSON Schema object. Kept permissive on extra keys: several tools
 *  accept aliases (invoice / id / invoice_number) that agents already use. */
function objSchema(
  properties: Record<string, unknown>,
  required?: string[],
): Record<string, unknown> {
  return required?.length
    ? { type: "object", required, properties }
    : { type: "object", properties };
}

const DATE_FIELD = {
  type: "string",
  pattern: "^\\d{4}-\\d{2}-\\d{2}$",
} as const;

const NO_ARGS = objSchema({});

const INVOICE_REF = {
  type: ["string", "number"],
  description: "Invoice number (e.g. 1962) or its UUID.",
} as const;

/** client (name) or client_id (UUID); at least one is needed. */
const CLIENT_REF_PROPS = {
  client: { type: "string", description: "Client name. Case-insensitive." },
  client_id: { type: "string", description: "Client UUID, if you already have it." },
} as const;

const CLIENT_FIELDS = {
  address_line: { type: "string" },
  suburb: { type: "string" },
  state: { type: "string", description: "Defaults to NSW." },
  postcode: { type: "string" },
  email: { type: "string", description: "Where their invoices are sent." },
  default_issuer_id: {
    type: "string",
    description: "UUID of the ABN that normally invoices this client.",
  },
  default_description: {
    type: "string",
    description:
      "The work normally done for this client. Only businesses that agree it in advance use this.",
  },
  default_rate: {
    type: "number",
    description: "Agreed price. Changing it never alters past invoices.",
  },
} as const;

const INVOICE_ITEMS_SCHEMA = {
  type: "array",
  minItems: 1,
  description: "The line items. Editing replaces the whole list.",
  items: {
    type: "object",
    required: ["service_date", "rate"],
    properties: {
      service_date: {
        type: "string",
        pattern: "^\\d{4}-\\d{2}-\\d{2}$",
        description:
          "REQUIRED. The day the service was actually performed (YYYY-MM-DD). " +
          "Often different from invoice_date. Ask the user, do not guess.",
      },
      rate: {
        type: "number",
        exclusiveMinimum: 0,
        description: "Price for this line. Usually the client's default_rate.",
      },
      description: {
        type: "string",
        description:
          "What the work was. Optional only for a business that has a usual service set; otherwise required.",
      },
      quantity: { type: "number", exclusiveMinimum: 0, description: "Defaults to 1." },
    },
  },
} as const;

// -- tiny input helpers -----------------------------------------------------
function reqStr(input: ToolInput, key: string): string {
  const v = input[key];
  if (typeof v !== "string" || v.trim() === "") {
    throw new Error(`Missing required "${key}"`);
  }
  return v.trim();
}
function optStr(input: ToolInput, key: string): string | null {
  const v = input[key];
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}
function optNum(input: ToolInput, key: string): number | null {
  const v = input[key];
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (Number.isNaN(n)) throw new Error(`"${key}" must be a number`);
  return n;
}
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ask for the bytes as well as the link. Off by default: see `deliver`. */
const INCLUDE_BASE64 = {
  type: "boolean",
  description:
    "Also return the PDF as base64. Only ask for this if you are attaching it to something; it is a very large value.",
} as const;

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/**
 * Validate the line items an agent sent.
 *
 * This is the only path agents have into invoice creation, so it is where
 * completeness is enforced. `service_date` is required on purpose: an agent
 * that omits it used to produce an invoice with a blank service date, which is
 * an incomplete document for the client. Agents must ask the user which day the
 * service was performed rather than guess.
 */
function items(input: ToolInput): NewInvoiceItem[] {
  const raw = input.items;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`"items" must be a non-empty array`);
  }

  return raw.map((entry, i) => {
    const at = `items[${i}]`;
    if (typeof entry !== "object" || entry === null) {
      throw new Error(`${at} must be an object`);
    }
    const it = entry as Record<string, unknown>;

    const rate = Number(it.rate);
    if (it.rate === undefined || it.rate === null || it.rate === "" || Number.isNaN(rate)) {
      throw new Error(`${at}.rate is required and must be a number`);
    }
    if (rate <= 0) throw new Error(`${at}.rate must be greater than zero`);

    const serviceDate = typeof it.service_date === "string" ? it.service_date.trim() : "";
    if (!serviceDate) {
      throw new Error(
        `${at}.service_date is required (YYYY-MM-DD): the day the service was ` +
          `performed. If the user said something relative like "yesterday" or ` +
          `"last Wednesday", call the "today" tool and work the date out from ` +
          `that. Only ask them if it is genuinely unclear.`,
      );
    }
    if (!ISO_DATE.test(serviceDate) || Number.isNaN(Date.parse(serviceDate))) {
      throw new Error(`${at}.service_date must be a valid date as YYYY-MM-DD`);
    }

    const quantity =
      it.quantity === undefined || it.quantity === null || it.quantity === ""
        ? 1
        : Number(it.quantity);
    if (Number.isNaN(quantity) || quantity <= 0) {
      throw new Error(`${at}.quantity must be a number greater than zero`);
    }

    // Left as typed, blank included. What a blank line falls back to depends on
    // the business, and the database is the one place that knows which business
    // this is, so it decides: its usual service, or an error.
    const description =
      typeof it.description === "string" ? it.description.trim() : "";

    return { description, service_date: serviceDate, quantity, rate };
  });
}

/**
 * Resolve id / invoice / invoice_number (UUID or number) to the invoice UUID,
 * within the caller's organisation. An invoice belonging to anybody else reads
 * as "not found", which is both the safe answer and the honest one.
 */
async function resolveId(orgId: string, input: ToolInput): Promise<string> {
  const ref = String(
    input.id ?? input.invoice ?? input.invoice_number ?? "",
  ).trim();
  if (!ref) throw new Error(`Missing invoice reference (id or invoice number)`);
  const inv = await getInvoiceByRef(orgId, ref);
  if (!inv) throw new Error(`Invoice ${ref} not found`);
  return inv.id;
}

/**
 * Today, in the calling business's own time zone. An agent runs wherever it
 * runs; the invoice date has to follow the business, not the server.
 */
async function orgToday(orgId: string): Promise<string> {
  const org = await getOrg(orgId);
  return todayInTimezone(org?.timezone ?? "Australia/Sydney");
}

function clientInput(input: ToolInput): ClientInput {
  return {
    name: reqStr(input, "name"),
    address_line: optStr(input, "address_line"),
    suburb: optStr(input, "suburb"),
    state: optStr(input, "state"),
    postcode: optStr(input, "postcode"),
    email: optStr(input, "email"),
    default_issuer_id: optStr(input, "default_issuer_id"),
    default_description: optStr(input, "default_description"),
    default_rate: optNum(input, "default_rate"),
  };
}

/**
 * Which client is being billed: `client_id` (UUID) or `client` (name).
 *
 * A name is accepted because that is what the person says out loud, and an
 * agent that has just been told "invoice Newtown" should not need a lookup
 * round trip to obey. A `client_id` that is plainly not a UUID is treated as a
 * name too, since that is what the agent meant.
 */
async function clientFor(orgId: string, input: ToolInput): Promise<Client> {
  const id = optStr(input, "client_id");
  if (id && UUID.test(id)) return resolveClient(orgId, { client_id: id });
  const name = optStr(input, "client") ?? id;
  if (!name) {
    throw new Error(
      `Provide client_id (UUID from list_clients) or client (the client's name)`,
    );
  }
  return resolveClient(orgId, { client: name });
}

/**
 * Which ABN is billing, in the order that needs the fewest questions:
 * what the caller said, then the client's usual issuer, then the only issuer
 * the business has.
 *
 * That last step is the one that matters. A business that just signed up has
 * exactly one ABN and no clients yet, and `create_invoice` used to demand an
 * `issuer_id` that no tool would hand over: `list_clients` was empty, a new
 * client's `default_issuer_id` is null, and there was nothing to ask. The first
 * invoice of every new business was unreachable.
 */
async function issuerFor(
  orgId: string,
  input: ToolInput,
  ...preferred: (string | null | undefined)[]
): Promise<string> {
  const said = optStr(input, "issuer_id") ?? optStr(input, "issuer");
  if (said) {
    const issuer = await resolveIssuer(
      orgId,
      UUID.test(said) ? { issuer_id: said } : { issuer: said },
    );
    return issuer.id;
  }
  for (const candidate of preferred) {
    if (candidate) return candidate;
  }
  return onlyIssuer(orgId);
}

/** The business's single ABN, or an error naming the ones it has. */
async function onlyIssuer(orgId: string): Promise<string> {
  const active = (await listIssuers(orgId)).filter((i) => i.is_active);
  if (active.length === 1) return active[0].id;
  if (active.length === 0) {
    throw new Error(
      `This business has no ABN on file yet. Add one in the dashboard, under Settings.`,
    );
  }
  throw new Error(
    `This business bills under ${active.length} ABNs (${active
      .map((i) => i.short_name)
      .join(", ")}). Say which one with issuer: "<name>".`,
  );
}

/**
 * How a document reaches the person who asked for it.
 *
 * A PDF is around 45 KB, which is 60,000 characters of base64 on one line.
 * That is more than most assistants will accept as a tool result: Claude Code
 * refuses it outright and writes it to a temp file. So the answer is a signed,
 * short-lived link that renders the document again when it is opened, and the
 * base64 comes only when the caller says it needs the bytes to attach.
 */
async function deliver(
  orgId: string,
  doc: DocRef,
  rendered: RenderedDoc,
  input: ToolInput,
): Promise<Record<string, unknown>> {
  const { token, expiresAt } = signDownloadToken(orgId, doc);
  const base = await appBaseUrl();
  const isPdf = (rendered.contentType ?? "application/pdf") === "application/pdf";
  return {
    filename: rendered.filename,
    size_bytes: rendered.buffer.byteLength,
    download_url: `${base}/api/agent/download/${token}`,
    expires_at: expiresAt,
    how_to_use:
      "Give the user this link, or save the file to their Downloads folder if you can write files. It stops working in 30 minutes.",
    ...(input.include_base64 === true
      ? isPdf
        ? { pdf_base64: toPdf(rendered).pdf_base64 }
        : { file_base64: Buffer.from(rendered.buffer).toString("base64") }
      : {}),
  };
}

/**
 * Email attachments: a link as well as the bytes.
 *
 * These two tools exist to be handed to an email tool, so the base64 stays by
 * default; taking it away would quietly send empty envelopes. An agent whose
 * harness refuses a result that size can pass `include_base64: false` and
 * attach the files from their links instead.
 */
async function withLinks(
  orgId: string,
  attachments: Pdf[],
  docs: DocRef[],
  input: ToolInput,
): Promise<Record<string, unknown>[]> {
  const base = await appBaseUrl();
  return attachments.map((attachment, i) => {
    const { pdf_base64, ...rest } = attachment;
    const { token } = signDownloadToken(orgId, docs[i]);
    return {
      ...rest,
      download_url: `${base}/api/agent/download/${token}`,
      ...(input.include_base64 === false ? {} : { pdf_base64 }),
    };
  });
}

// -- the registry -----------------------------------------------------------
export const tools: Record<string, ToolDef> = {
  // reads
  business_snapshot: {
    description:
      "The daily pulse in one call: outstanding + overdue, unpaid count, billed this month / this FY / all time, and paid all time.",
    schema: NO_ARGS,
    handler: (_input, ctx) => businessSnapshot(ctx.agent.orgId),
  },
  today: {
    description:
      "Today's date in the business's own timezone, plus the last 14 days with their weekday " +
      "names. Use this to resolve what the user says (yesterday, last Wednesday, the 20th) into " +
      "a YYYY-MM-DD date. Never work it out from your own clock: agents run on servers in other " +
      "timezones and the business runs on its own.",
    schema: NO_ARGS,
    handler: async (_input, ctx) => {
      const org = await getOrg(ctx.agent.orgId);
      const timezone = org?.timezone ?? "Australia/Sydney";
      const today = todayInTimezone(timezone);
      const [y, m, d] = today.split("-").map(Number);
      const base = Date.UTC(y, m - 1, d);
      const recent = Array.from({ length: 14 }, (_, i) => {
        const day = new Date(base - i * 86_400_000);
        return {
          date: day.toISOString().slice(0, 10),
          weekday: WEEKDAYS[day.getUTCDay()],
          ...(i === 0 ? { is: "today" } : i === 1 ? { is: "yesterday" } : {}),
        };
      });
      return { today, timezone, recent_days: recent };
    },
  },
  who_owes: {
    description: "Every client with an unpaid balance: amount, count, overdue.",
    schema: NO_ARGS,
    handler: (_input, ctx) => whoOwes(ctx.agent.orgId),
  },
  overdue_invoices: {
    description:
      "Flat list of every overdue unpaid invoice: number, client, ABN, due date, days overdue, balance.",
    schema: NO_ARGS,
    handler: (_input, ctx) => overdueInvoices(ctx.agent.orgId),
  },
  client_summary: {
    description:
      "Per-client snapshot: billed all-time, paid, outstanding, unpaid/overdue counts, last invoice date. Args: client (name).",
    schema: objSchema({ client: CLIENT_REF_PROPS.client }, ["client"]),
    handler: (input, ctx) =>
      clientSummary(ctx.agent.orgId, reqStr(input, "client")),
  },
  find_invoices: {
    description:
      "Bounded invoice search. All optional: client, issuer, status (unpaid/paid/cancelled), from, to (YYYY-MM-DD), limit (default 20). Newest first.",
    schema: objSchema({
      client: CLIENT_REF_PROPS.client,
      issuer: { type: "string", description: "Issuer short name, e.g. Mavi or Andres." },
      status: { type: "string", enum: ["unpaid", "paid", "cancelled"] },
      from: { ...DATE_FIELD, description: "Earliest invoice_date." },
      to: { ...DATE_FIELD, description: "Latest invoice_date." },
      limit: { type: "number", description: "Defaults to 20." },
    }),
    handler: (input, ctx) =>
      findInvoices(ctx.agent.orgId, {
        client: optStr(input, "client"),
        issuer: optStr(input, "issuer"),
        status: optStr(input, "status"),
        from: optStr(input, "from"),
        to: optStr(input, "to"),
        limit: optNum(input, "limit"),
      }),
  },
  client_account: {
    description: "A client's unpaid invoices with balances. Args: client (name).",
    schema: objSchema({ client: CLIENT_REF_PROPS.client }, ["client"]),
    handler: (input, ctx) =>
      clientAccount(ctx.agent.orgId, reqStr(input, "client")),
  },
  recent_invoices: {
    description: "Latest invoices, optionally for one client. Args: client?, limit?.",
    schema: objSchema({
      client: CLIENT_REF_PROPS.client,
      limit: { type: "number", description: "Defaults to 10." },
    }),
    handler: (input, ctx) =>
      recentInvoices(
        ctx.agent.orgId,
        optStr(input, "client"),
        optNum(input, "limit"),
      ),
  },
  billed_in_period: {
    description:
      "Billed total per ABN in a date window. Args: from, to (YYYY-MM-DD), issuer?.",
    schema: objSchema(
      {
        from: DATE_FIELD,
        to: DATE_FIELD,
        issuer: { type: "string", description: "Issuer short name. Omit for all ABNs." },
      },
      ["from", "to"],
    ),
    handler: (input, ctx) =>
      billedInPeriod(
        ctx.agent.orgId,
        reqStr(input, "from"),
        reqStr(input, "to"),
        optStr(input, "issuer"),
      ),
  },
  gst_position: {
    description:
      "GST collected, on a cash basis: this BAS quarter, the financial year to date, and when the BAS is due. " +
      "The ONLY source of a GST figure. Prices include GST, so this is tax already inside what was charged, never an extra on top. Args: none.",
    schema: NO_ARGS,
    handler: async (_input, ctx) => {
      const org = await getOrg(ctx.agent.orgId);
      if (!org) throw new Error("Organisation not found");
      return getGstPosition(org);
    },
  },
  fy_summary: {
    description:
      "Billed and paid per ABN for a financial year. The amounts INCLUDE GST and are not GST figures: for GST use gst_position. " +
      "Args: fy_start? (defaults to current AU FY).",
    schema: objSchema({
      fy_start: {
        ...DATE_FIELD,
        description: "Start of the AU financial year, always YYYY-07-01.",
      },
    }),
    handler: (input, ctx) =>
      fySummary(ctx.agent.orgId, optStr(input, "fy_start")),
  },
  get_invoice: {
    description: "One invoice with its line items. Args: invoice (number or UUID).",
    schema: objSchema({ invoice: INVOICE_REF }, ["invoice"]),
    handler: async (input, ctx) =>
      getInvoiceByRef(ctx.agent.orgId, await refString(input)),
  },
  list_clients: {
    description: "All clients with their details (incl. internal email).",
    schema: NO_ARGS,
    handler: (_input, ctx) => listClients(ctx.agent.orgId),
  },
  list_issuers: {
    description:
      "The ABNs this business invoices under: id, name, ABN, ACN. Most businesses have exactly one, " +
      "and create_invoice already uses it on its own, so you rarely need this. Ask when the business " +
      "bills under more than one and you have to name which.",
    schema: NO_ARGS,
    handler: (_input, ctx) => listIssuers(ctx.agent.orgId),
  },
  create_backup: {
    description:
      "A full backup of the business (invoices, line items, clients, ABNs, company profile) as a " +
      "download link good for 30 minutes. Defaults to an Excel workbook, one sheet per table, which " +
      'is what somebody means when they ask for their data. Pass format: "json" only when they ask ' +
      "for JSON specifically: that is the complete, restorable copy, not the readable one. " +
      "Args: format? (excel | json), include_base64? (only if you need the bytes to attach).",
    schema: objSchema({
      format: {
        type: "string",
        enum: ["excel", "json"],
        description:
          'Defaults to "excel". Use "json" only when the user asks for JSON.',
      },
      include_base64: INCLUDE_BASE64,
    }),
    handler: async (input, ctx) => {
      const format = optStr(input, "format") === "json" ? "json" : "excel";
      const doc = await renderBackupDoc(ctx.agent.orgId, format);
      return {
        ...(await deliver(
          ctx.agent.orgId,
          { kind: "backup", ref: format },
          doc,
          input,
        )),
        format,
        counts: doc.counts,
      };
    },
  },

  // documents (a signed link by default; base64 only when asked for)
  get_invoice_pdf: {
    description:
      "The invoice as a PDF. Returns a download link good for 30 minutes, its filename and its size. " +
      "Give the link to the user, or save the file to their Downloads folder yourself. " +
      "Args: invoice (number or UUID), include_base64? (only if you need the bytes to attach).",
    schema: objSchema(
      { invoice: INVOICE_REF, include_base64: INCLUDE_BASE64 },
      ["invoice"],
    ),
    handler: async (input, ctx) => {
      const ref = await refString(input);
      const doc = await renderInvoiceDoc(ctx.agent.orgId, ref);
      return deliver(ctx.agent.orgId, { kind: "invoice", ref }, doc, input);
    },
  },
  get_client_statement: {
    description:
      "A client's outstanding-payment statement as a PDF. Returns a download link good for 30 minutes. " +
      "Only lists what is still unpaid, so ask for it before marking things paid, not after. " +
      "Args: client (name) or client_id, include_base64?.",
    schema: objSchema({ ...CLIENT_REF_PROPS, include_base64: INCLUDE_BASE64 }),
    handler: async (input, ctx) => {
      const c = await resolveClient(ctx.agent.orgId, {
        client: optStr(input, "client"),
        client_id: optStr(input, "client_id"),
      });
      const doc = await renderClientStatementDoc(ctx.agent.orgId, c.id);
      return deliver(
        ctx.agent.orgId,
        { kind: "client_statement", ref: c.id },
        doc,
        input,
      );
    },
  },
  get_tax_statement: {
    description:
      "Every invoice issued under one ABN in a financial year, as a PDF for the accountant. " +
      "Returns a download link good for 30 minutes. Args: issuer? (name; defaults to the only ABN " +
      "the business has), fy_start? (YYYY-07-01, defaults to the current FY), include_base64?.",
    schema: objSchema({
      issuer: { type: "string", description: "Issuer short name. Omit if the business has only one." },
      issuer_id: { type: "string", description: "Issuer UUID." },
      fy_start: { ...DATE_FIELD, description: "Always YYYY-07-01. Defaults to the current FY." },
      include_base64: INCLUDE_BASE64,
    }),
    handler: async (input, ctx) => {
      const said = optStr(input, "issuer_id") ?? optStr(input, "issuer");
      const issuerId = said
        ? (
            await resolveIssuer(
              ctx.agent.orgId,
              UUID.test(said) ? { issuer_id: said } : { issuer: said },
            )
          ).id
        : await onlyIssuer(ctx.agent.orgId);
      const fyStart = optStr(input, "fy_start");
      const doc = await renderTaxStatementDoc(ctx.agent.orgId, issuerId, fyStart);
      return deliver(
        ctx.agent.orgId,
        { kind: "tax_statement", ref: issuerId, fyStart },
        doc,
        input,
      );
    },
  },
  prepare_client_email: {
    description:
      "Recipient + filled template + the invoice PDFs, ready for your own email tool. " +
      "Each attachment carries both a download link and its base64. Args: client (name) or client_id, " +
      "invoices? (numbers; default = all unpaid), include_base64? (pass false if the bytes are too big for you to handle).",
    schema: objSchema({
      ...CLIENT_REF_PROPS,
      invoices: {
        type: "array",
        items: { type: "number" },
        description:
          "Invoice numbers to attach. Omit for every unpaid one. Numbers that do not belong to this client are rejected.",
      },
      include_base64: {
        type: "boolean",
        description: "Defaults to true, since attachments need the bytes. Pass false to get links only.",
      },
    }),
    handler: async (input, ctx) => {
      const email = await prepareClientEmail(ctx.agent.orgId, {
        client: optStr(input, "client"),
        client_id: optStr(input, "client_id"),
        invoices: Array.isArray(input.invoices)
          ? (input.invoices as number[])
          : null,
      });
      return {
        ...email,
        attachments: await withLinks(
          ctx.agent.orgId,
          email.attachments,
          email.invoice_numbers.map((n) => ({
            kind: "invoice" as const,
            ref: String(n),
          })),
          input,
        ),
      };
    },
  },
  prepare_client_statement_email: {
    description:
      "Recipient + filled template + that client's account statement, ready for your own email tool. " +
      "Recipient and statement are always the same client, so they can't be crossed. " +
      "Args: client (name) or client_id, include_base64? (pass false to get a link only).",
    schema: objSchema({
      ...CLIENT_REF_PROPS,
      include_base64: {
        type: "boolean",
        description: "Defaults to true, since attachments need the bytes. Pass false to get a link only.",
      },
    }),
    handler: async (input, ctx) => {
      const client = await resolveClient(ctx.agent.orgId, {
        client: optStr(input, "client"),
        client_id: optStr(input, "client_id"),
      });
      const email = await prepareClientStatementEmail(ctx.agent.orgId, {
        client_id: client.id,
      });
      return {
        ...email,
        attachments: await withLinks(
          ctx.agent.orgId,
          email.attachments,
          [{ kind: "client_statement", ref: client.id }],
          input,
        ),
      };
    },
  },

  // writes
  create_invoice: {
    description:
      "Create an invoice. Args: client (name) or client_id, items[], issuer? (only if the business bills under several ABNs), " +
      "invoice_date? (when it is BILLED, defaults to today where the business is), internal_notes?. " +
      "Each item is {service_date, rate, description?, quantity?}. service_date is REQUIRED and is the day the service was actually performed (YYYY-MM-DD); " +
      "it is often not the same as invoice_date, so ask the user which day it was instead of guessing. " +
      "description says what the work was; it can be left out only when the business or the client has a usual service set. quantity defaults to 1. " +
      "Use the client's default_rate unless told otherwise.",
    schema: {
      type: "object",
      required: ["items"],
      properties: {
        client: {
          type: "string",
          description: "The client's name. Use this or client_id.",
        },
        client_id: { type: "string", description: "Client UUID from list_clients." },
        issuer: {
          type: "string",
          description:
            "Name of the ABN billing. Omit it: the client's usual ABN is used, or the only one the business has.",
        },
        issuer_id: { type: "string", description: "Issuer UUID, if you have it." },
        items: INVOICE_ITEMS_SCHEMA,
        invoice_date: {
          type: "string",
          pattern: "^\\d{4}-\\d{2}-\\d{2}$",
          description: "When it is billed. Defaults to today in the business's timezone.",
        },
        internal_notes: {
          type: "string",
          description: "Never printed on the invoice. Dashboard only.",
        },
      },
    },
    handler: async (input, ctx) => {
      const client = await clientFor(ctx.agent.orgId, input);
      return createInvoice(ctx.agent.orgId, {
        client_id: client.id,
        issuer_id: await issuerFor(
          ctx.agent.orgId,
          input,
          client.default_issuer_id,
        ),
        invoice_date:
          optStr(input, "invoice_date") ?? (await orgToday(ctx.agent.orgId)),
        internal_notes: optStr(input, "internal_notes"),
        created_by: ctx.agent.label,
        items: items(input),
      });
    },
  },
  update_invoice: {
    description:
      "Edit an invoice (REPLACES all its items, so send the full list, not just the changed one). " +
      "Args: invoice, items[], and only what else is changing: client?, issuer?, invoice_date?, internal_notes?. " +
      "Anything you leave out keeps the value the invoice already has. " +
      "Each item is {service_date, rate, description?, quantity?}, with service_date REQUIRED (YYYY-MM-DD, the day the service was performed).",
    schema: {
      type: "object",
      required: ["invoice", "items"],
      properties: {
        invoice: {
          type: ["string", "number"],
          description: "Invoice number or UUID.",
        },
        client: { type: "string", description: "Only to move it to another client." },
        client_id: { type: "string" },
        issuer: { type: "string", description: "Only to bill it under another ABN." },
        issuer_id: { type: "string" },
        items: INVOICE_ITEMS_SCHEMA,
        invoice_date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        internal_notes: { type: "string" },
      },
    },
    handler: async (input, ctx) => {
      const orgId = ctx.agent.orgId;
      const current = await getInvoiceByRef(orgId, await refString(input));
      if (!current) throw new Error(`Invoice not found`);

      // Everything not mentioned stays as it is. This used to overwrite the
      // whole row from the arguments alone, so an agent fixing a typo in one
      // line silently re-dated the invoice to today and erased its notes.
      const moving =
        optStr(input, "client") !== null || optStr(input, "client_id") !== null;
      const client = moving ? await clientFor(orgId, input) : null;
      const clientId = client?.id ?? current.client_id;
      if (!clientId) {
        throw new Error(
          `Invoice ${current.invoice_number} has no client on file any more. Say who it belongs to with client: "<name>".`,
        );
      }

      return updateInvoice(orgId, current.id, {
        client_id: clientId,
        issuer_id: await issuerFor(
          orgId,
          input,
          client?.default_issuer_id,
          current.issuer_id,
        ),
        invoice_date: optStr(input, "invoice_date") ?? current.invoice_date,
        internal_notes:
          "internal_notes" in input
            ? optStr(input, "internal_notes")
            : current.internal_notes,
        items: items(input),
      });
    },
  },
  mark_paid: {
    description: "Mark an invoice paid in full. Args: invoice. There are no partial payments.",
    schema: objSchema({ invoice: INVOICE_REF }, ["invoice"]),
    handler: async (input, ctx) => {
      const id = await resolveId(ctx.agent.orgId, input);
      await markPaid(ctx.agent.orgId, id);
      return afterWrite(ctx.agent.orgId, id);
    },
  },
  mark_unpaid: {
    description: "Undo a payment. Args: invoice.",
    schema: objSchema({ invoice: INVOICE_REF }, ["invoice"]),
    handler: async (input, ctx) => {
      const id = await resolveId(ctx.agent.orgId, input);
      await markUnpaid(ctx.agent.orgId, id);
      return afterWrite(ctx.agent.orgId, id);
    },
  },
  cancel_invoice: {
    description:
      "Cancel an invoice (keeps the record and its number). Prefer this over deleting one that was already sent. Args: invoice.",
    schema: objSchema({ invoice: INVOICE_REF }, ["invoice"]),
    handler: async (input, ctx) => {
      const id = await resolveId(ctx.agent.orgId, input);
      await cancelInvoice(ctx.agent.orgId, id);
      return afterWrite(ctx.agent.orgId, id);
    },
  },
  reactivate_invoice: {
    description: "Undo a cancellation. Args: invoice.",
    schema: objSchema({ invoice: INVOICE_REF }, ["invoice"]),
    handler: async (input, ctx) => {
      const id = await resolveId(ctx.agent.orgId, input);
      await reactivateInvoice(ctx.agent.orgId, id);
      return afterWrite(ctx.agent.orgId, id);
    },
  },
  delete_invoice: {
    description:
      "PERMANENTLY delete an invoice. Args: invoice, confirm:true. Must confirm with the user first.",
    schema: objSchema(
      {
        invoice: INVOICE_REF,
        confirm: {
          type: "boolean",
          const: true,
          description: "Must be true, and only after the user has explicitly confirmed.",
        },
      },
      ["invoice", "confirm"],
    ),
    handler: async (input, ctx) => {
      if (input.confirm !== true) {
        throw new Error(
          "delete_invoice needs confirm:true — confirm with the user first",
        );
      }
      await deleteInvoice(
        ctx.agent.orgId,
        await resolveId(ctx.agent.orgId, input),
      );
      return { deleted: true };
    },
  },
  create_client: {
    description:
      "Add a client. Args: name (required), address_line?, suburb?, state?, postcode?, email?, default_issuer_id?, default_description?, default_rate?.",
    schema: objSchema(
      { name: { type: "string" }, ...CLIENT_FIELDS },
      ["name"],
    ),
    handler: (input, ctx) => createClient(ctx.agent.orgId, clientInput(input)),
  },
  update_client: {
    description:
      "Edit a client. Args: id (required) + only the fields to change. Changing default_rate never rewrites past invoices.",
    schema: objSchema(
      {
        id: { type: "string", description: "Client UUID from list_clients." },
        name: { type: "string" },
        ...CLIENT_FIELDS,
      },
      ["id"],
    ),
    handler: (input, ctx) => {
      const id = reqStr(input, "id");
      const patch: Partial<ClientInput> = {};
      if ("name" in input) patch.name = reqStr(input, "name");
      if ("address_line" in input) patch.address_line = optStr(input, "address_line");
      if ("suburb" in input) patch.suburb = optStr(input, "suburb");
      if ("state" in input) patch.state = optStr(input, "state");
      if ("postcode" in input) patch.postcode = optStr(input, "postcode");
      if ("email" in input) patch.email = optStr(input, "email");
      if ("default_issuer_id" in input)
        patch.default_issuer_id = optStr(input, "default_issuer_id");
      // optStr, not reqStr: sending "" is how you take a client's usual
      // service away again, and it used to come back as a missing-argument
      // error instead.
      if ("default_description" in input)
        patch.default_description = optStr(input, "default_description");
      if ("default_rate" in input) patch.default_rate = optNum(input, "default_rate");
      return updateClient(ctx.agent.orgId, id, patch);
    },
  },
};

/**
 * What a status change answers with: the invoice as it now stands.
 *
 * These used to answer with nothing. `undefined` survives as far as
 * `JSON.stringify`, which turns it into no value at all, and a tool message
 * with no content is rejected outright by the chat API: marking an invoice paid
 * changed the invoice and then failed the conversation. Handing back the row is
 * both a real value and the thing the caller wants to read out anyway (status,
 * number, total), without a second lookup.
 */
async function afterWrite(orgId: string, id: string) {
  const invoice = await getInvoiceByRef(orgId, id);
  return invoice ?? { ok: true, id };
}

async function refString(input: ToolInput): Promise<string> {
  const ref = String(input.invoice ?? input.id ?? input.invoice_number ?? "").trim();
  if (!ref) throw new Error(`Missing invoice reference (number or UUID)`);
  return ref;
}
