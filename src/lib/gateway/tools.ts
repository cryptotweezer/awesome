import "server-only";
import type { Agent } from "./auth";
import { todayInSydney } from "@/lib/format";
import {
  createInvoice,
  updateInvoice,
  markPaid,
  markUnpaid,
  cancelInvoice,
  reactivateInvoice,
  deleteInvoice,
  getInvoiceByRef,
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
import { createBackup } from "@/lib/data/backup";
import {
  renderInvoicePdf,
  renderClientStatementPdf,
  renderTaxStatementPdf,
  prepareClientEmail,
  prepareClientStatementEmail,
  resolveClient,
  resolveIssuer,
} from "./documents";

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
  default_description: { type: "string", description: "Defaults to 'Cleaning Service'." },
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
        description: "Defaults to 'Cleaning Service'.",
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
          `performed. Ask the user which day it was, do not guess or use today ` +
          `unless they said so.`,
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

    const description =
      typeof it.description === "string" && it.description.trim() !== ""
        ? it.description.trim()
        : "Cleaning Service";

    return { description, service_date: serviceDate, quantity, rate };
  });
}

/** Resolve id / invoice / invoice_number (UUID or number) to the invoice UUID. */
async function resolveId(input: ToolInput): Promise<string> {
  const ref = String(
    input.id ?? input.invoice ?? input.invoice_number ?? "",
  ).trim();
  if (!ref) throw new Error(`Missing invoice reference (id or invoice number)`);
  const inv = await getInvoiceByRef(ref);
  if (!inv) throw new Error(`Invoice ${ref} not found`);
  return inv.id;
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
    default_description: optStr(input, "default_description") ?? "Cleaning Service",
    default_rate: optNum(input, "default_rate"),
  };
}

// -- the registry -----------------------------------------------------------
export const tools: Record<string, ToolDef> = {
  // reads
  business_snapshot: {
    description:
      "The daily pulse in one call: outstanding + overdue, unpaid count, billed this month / this FY / all time, and paid all time.",
    schema: NO_ARGS,
    handler: () => businessSnapshot(),
  },
  who_owes: {
    description: "Every client with an unpaid balance: amount, count, overdue.",
    schema: NO_ARGS,
    handler: () => whoOwes(),
  },
  overdue_invoices: {
    description:
      "Flat list of every overdue unpaid invoice: number, client, ABN, due date, days overdue, balance.",
    schema: NO_ARGS,
    handler: () => overdueInvoices(),
  },
  client_summary: {
    description:
      "Per-client snapshot: billed all-time, paid, outstanding, unpaid/overdue counts, last invoice date. Args: client (name).",
    schema: objSchema({ client: CLIENT_REF_PROPS.client }, ["client"]),
    handler: (input) => clientSummary(reqStr(input, "client")),
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
    handler: (input) =>
      findInvoices({
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
    handler: (input) => clientAccount(reqStr(input, "client")),
  },
  recent_invoices: {
    description: "Latest invoices, optionally for one client. Args: client?, limit?.",
    schema: objSchema({
      client: CLIENT_REF_PROPS.client,
      limit: { type: "number", description: "Defaults to 10." },
    }),
    handler: (input) =>
      recentInvoices(optStr(input, "client"), optNum(input, "limit")),
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
    handler: (input) =>
      billedInPeriod(reqStr(input, "from"), reqStr(input, "to"), optStr(input, "issuer")),
  },
  fy_summary: {
    description:
      "Billed and paid per ABN for a financial year. Args: fy_start? (defaults to current AU FY).",
    schema: objSchema({
      fy_start: {
        ...DATE_FIELD,
        description: "Start of the AU financial year, always YYYY-07-01.",
      },
    }),
    handler: (input) => fySummary(optStr(input, "fy_start")),
  },
  get_invoice: {
    description: "One invoice with its line items. Args: invoice (number or UUID).",
    schema: objSchema({ invoice: INVOICE_REF }, ["invoice"]),
    handler: async (input) => getInvoiceByRef(await refString(input)),
  },
  list_clients: {
    description: "All clients with their details (incl. internal email).",
    schema: NO_ARGS,
    handler: () => listClients(),
  },
  create_backup: {
    description:
      "A full backup of the business (clients, issuers, invoices, line items, company profile) as a JSON file in base64, for safe-keeping off the database. Args: none. Returns filename, counts and json_base64.",
    schema: NO_ARGS,
    handler: async () => {
      const backup = await createBackup();
      const json = JSON.stringify(backup);
      return {
        filename: `awesome-backup-${backup.meta.date}.json`,
        generated_at: backup.meta.generated_at,
        counts: backup.counts,
        json_base64: Buffer.from(json).toString("base64"),
      };
    },
  },

  // documents (PDFs come back as base64; the agent attaches/forwards them)
  get_invoice_pdf: {
    description: "The invoice PDF as base64. Args: invoice (number or UUID).",
    schema: objSchema({ invoice: INVOICE_REF }, ["invoice"]),
    handler: async (input) => renderInvoicePdf(await refString(input)),
  },
  get_client_statement: {
    description:
      "A client's outstanding-payment statement PDF (base64). Args: client (name) or client_id.",
    schema: objSchema({ ...CLIENT_REF_PROPS }),
    handler: async (input) => {
      const c = await resolveClient({
        client: optStr(input, "client"),
        client_id: optStr(input, "client_id"),
      });
      return renderClientStatementPdf(c.id);
    },
  },
  get_tax_statement: {
    description:
      "FY tax statement PDF for one ABN (base64). Args: issuer (name) or issuer_id, fy_start? (YYYY-07-01).",
    schema: objSchema({
      issuer: { type: "string", description: "Issuer short name, e.g. Mavi or Andres." },
      issuer_id: { type: "string", description: "Issuer UUID." },
      fy_start: { ...DATE_FIELD, description: "Always YYYY-07-01. Defaults to the current FY." },
    }),
    handler: async (input) => {
      const iss = await resolveIssuer({
        issuer: optStr(input, "issuer"),
        issuer_id: optStr(input, "issuer_id"),
      });
      return renderTaxStatementPdf(iss.id, optStr(input, "fy_start"));
    },
  },
  prepare_client_email: {
    description:
      "Recipient + filled template + invoice PDFs (base64) to email a client. Args: client (name) or client_id, invoices? (numbers; default = all unpaid). The agent sends it with its own Gmail.",
    schema: objSchema({
      ...CLIENT_REF_PROPS,
      invoices: {
        type: "array",
        items: { type: "number" },
        description:
          "Invoice numbers to attach. Omit for every unpaid one. Numbers that do not belong to this client are rejected.",
      },
    }),
    handler: (input) =>
      prepareClientEmail({
        client: optStr(input, "client"),
        client_id: optStr(input, "client_id"),
        invoices: Array.isArray(input.invoices)
          ? (input.invoices as number[])
          : null,
      }),
  },
  prepare_client_statement_email: {
    description:
      "Recipient + filled template + that client's account-statement PDF (base64) to email a client. Args: client (name) or client_id. Recipient and statement are always the same client, so they can't be crossed.",
    schema: objSchema({ ...CLIENT_REF_PROPS }),
    handler: (input) =>
      prepareClientStatementEmail({
        client: optStr(input, "client"),
        client_id: optStr(input, "client_id"),
      }),
  },

  // writes
  create_invoice: {
    description:
      "Create an invoice. Args: client_id, issuer_id, items[], invoice_date? (when it is BILLED, defaults to today in Sydney), internal_notes?. " +
      "Each item is {service_date, rate, description?, quantity?}. service_date is REQUIRED and is the day the service was actually performed (YYYY-MM-DD); " +
      "it is often not the same as invoice_date, so ask the user which day it was instead of guessing. " +
      "description defaults to 'Cleaning Service' and quantity to 1. Use the client's default_rate unless told otherwise.",
    schema: {
      type: "object",
      required: ["client_id", "issuer_id", "items"],
      properties: {
        client_id: { type: "string", description: "UUID from list_clients." },
        issuer_id: {
          type: "string",
          description: "UUID of the ABN billing. Usually the client's default_issuer_id.",
        },
        items: INVOICE_ITEMS_SCHEMA,
        invoice_date: {
          type: "string",
          pattern: "^\\d{4}-\\d{2}-\\d{2}$",
          description: "When it is billed. Defaults to today in Sydney.",
        },
        internal_notes: {
          type: "string",
          description: "Never printed on the invoice. Dashboard only.",
        },
      },
    },
    handler: (input, ctx) =>
      createInvoice({
        client_id: reqStr(input, "client_id"),
        issuer_id: reqStr(input, "issuer_id"),
        invoice_date: optStr(input, "invoice_date") ?? todayInSydney(),
        internal_notes: optStr(input, "internal_notes"),
        created_by: ctx.agent.label,
        items: items(input),
      }),
  },
  update_invoice: {
    description:
      "Edit an invoice (REPLACES all its items, so send the full list, not just the changed one). " +
      "Args: invoice, client_id, issuer_id, items[], invoice_date?, internal_notes?. " +
      "Each item is {service_date, rate, description?, quantity?}, with service_date REQUIRED (YYYY-MM-DD, the day the service was performed).",
    schema: {
      type: "object",
      required: ["invoice", "client_id", "issuer_id", "items"],
      properties: {
        invoice: {
          type: ["string", "number"],
          description: "Invoice number or UUID.",
        },
        client_id: { type: "string" },
        issuer_id: { type: "string" },
        items: INVOICE_ITEMS_SCHEMA,
        invoice_date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        internal_notes: { type: "string" },
      },
    },
    handler: async (input) =>
      updateInvoice(await resolveId(input), {
        client_id: reqStr(input, "client_id"),
        issuer_id: reqStr(input, "issuer_id"),
        invoice_date: optStr(input, "invoice_date") ?? todayInSydney(),
        internal_notes: optStr(input, "internal_notes"),
        items: items(input),
      }),
  },
  mark_paid: {
    description: "Mark an invoice paid in full. Args: invoice. There are no partial payments.",
    schema: objSchema({ invoice: INVOICE_REF }, ["invoice"]),
    handler: async (input) => markPaid(await resolveId(input)),
  },
  mark_unpaid: {
    description: "Undo a payment. Args: invoice.",
    schema: objSchema({ invoice: INVOICE_REF }, ["invoice"]),
    handler: async (input) => markUnpaid(await resolveId(input)),
  },
  cancel_invoice: {
    description:
      "Cancel an invoice (keeps the record and its number). Prefer this over deleting one that was already sent. Args: invoice.",
    schema: objSchema({ invoice: INVOICE_REF }, ["invoice"]),
    handler: async (input) => cancelInvoice(await resolveId(input)),
  },
  reactivate_invoice: {
    description: "Undo a cancellation. Args: invoice.",
    schema: objSchema({ invoice: INVOICE_REF }, ["invoice"]),
    handler: async (input) => reactivateInvoice(await resolveId(input)),
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
    handler: async (input) => {
      if (input.confirm !== true) {
        throw new Error(
          "delete_invoice needs confirm:true — confirm with the user first",
        );
      }
      await deleteInvoice(await resolveId(input));
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
    handler: (input) => createClient(clientInput(input)),
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
    handler: (input) => {
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
      if ("default_description" in input)
        patch.default_description = reqStr(input, "default_description");
      if ("default_rate" in input) patch.default_rate = optNum(input, "default_rate");
      return updateClient(id, patch);
    },
  },
};

async function refString(input: ToolInput): Promise<string> {
  const ref = String(input.invoice ?? input.id ?? input.invoice_number ?? "").trim();
  if (!ref) throw new Error(`Missing invoice reference (number or UUID)`);
  return ref;
}
