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
} from "@/lib/data/reports";
import {
  listClients,
  createClient,
  updateClient,
  type ClientInput,
} from "@/lib/data/clients";
import {
  renderInvoicePdf,
  renderClientStatementPdf,
  renderTaxStatementPdf,
  prepareClientEmail,
  resolveClient,
  resolveIssuer,
} from "./documents";

export type ToolInput = Record<string, unknown>;
export type ToolContext = { agent: Agent };
export type ToolHandler = (input: ToolInput, ctx: ToolContext) => Promise<unknown>;
export type ToolDef = { description: string; handler: ToolHandler };

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
function items(input: ToolInput): NewInvoiceItem[] {
  const raw = input.items;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`"items" must be a non-empty array`);
  }
  return raw as NewInvoiceItem[];
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
  who_owes: {
    description: "Every client with an unpaid balance: amount, count, overdue.",
    handler: () => whoOwes(),
  },
  client_account: {
    description: "A client's unpaid invoices with balances. Args: client (name).",
    handler: (input) => clientAccount(reqStr(input, "client")),
  },
  recent_invoices: {
    description: "Latest invoices, optionally for one client. Args: client?, limit?.",
    handler: (input) =>
      recentInvoices(optStr(input, "client"), optNum(input, "limit")),
  },
  billed_in_period: {
    description:
      "Billed total per ABN in a date window. Args: from, to (YYYY-MM-DD), issuer?.",
    handler: (input) =>
      billedInPeriod(reqStr(input, "from"), reqStr(input, "to"), optStr(input, "issuer")),
  },
  fy_summary: {
    description:
      "Billed and paid per ABN for a financial year. Args: fy_start? (defaults to current AU FY).",
    handler: (input) => fySummary(optStr(input, "fy_start")),
  },
  get_invoice: {
    description: "One invoice with its line items. Args: invoice (number or UUID).",
    handler: async (input) => getInvoiceByRef(await refString(input)),
  },
  list_clients: {
    description: "All clients with their details (incl. internal email).",
    handler: () => listClients(),
  },

  // documents (PDFs come back as base64; the agent attaches/forwards them)
  get_invoice_pdf: {
    description: "The invoice PDF as base64. Args: invoice (number or UUID).",
    handler: async (input) => renderInvoicePdf(await refString(input)),
  },
  get_client_statement: {
    description:
      "A client's outstanding-payment statement PDF (base64). Args: client (name) or client_id.",
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
    handler: (input) =>
      prepareClientEmail({
        client: optStr(input, "client"),
        client_id: optStr(input, "client_id"),
        invoices: Array.isArray(input.invoices)
          ? (input.invoices as number[])
          : null,
      }),
  },

  // writes
  create_invoice: {
    description:
      "Create an invoice. Args: client_id, issuer_id, items[], invoice_date? (defaults today Sydney), internal_notes?.",
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
      "Edit an invoice (replaces items). Args: invoice, client_id, issuer_id, items[], invoice_date?, internal_notes?.",
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
    description: "Mark an invoice paid in full. Args: invoice.",
    handler: async (input) => markPaid(await resolveId(input)),
  },
  mark_unpaid: {
    description: "Undo a payment. Args: invoice.",
    handler: async (input) => markUnpaid(await resolveId(input)),
  },
  cancel_invoice: {
    description: "Cancel an invoice (keeps its number). Args: invoice.",
    handler: async (input) => cancelInvoice(await resolveId(input)),
  },
  reactivate_invoice: {
    description: "Undo a cancellation. Args: invoice.",
    handler: async (input) => reactivateInvoice(await resolveId(input)),
  },
  delete_invoice: {
    description:
      "PERMANENTLY delete an invoice. Args: invoice, confirm:true. Must confirm with the user first.",
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
    handler: (input) => createClient(clientInput(input)),
  },
  update_client: {
    description: "Edit a client. Args: id (required) + any client fields to change.",
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
