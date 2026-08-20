/**
 * What a credential is allowed to do. Three, on purpose: this list is shown to
 * a person on a consent screen and chosen by a person on a mint form, and
 * nobody makes a good decision about fourteen checkboxes.
 *
 * Deliberately NOT a mirror of the tables. `delete` is separated from `write`
 * because deleting an invoice is the one action that is irreversible and that
 * an AI must always confirm first: it deserves to be refusable on its own.
 */

export const SCOPES = ["read", "write", "delete"] as const;
export type Scope = (typeof SCOPES)[number];

export const ALL_SCOPES: Scope[] = [...SCOPES];

/** What each scope means, in the words the consent screen and the mint form use. */
export const SCOPE_LABELS: Record<Scope, { title: string; detail: string }> = {
  read: {
    title: "See your billing data",
    detail:
      "Invoices, clients, what is owed, GST position, and the PDF documents.",
  },
  write: {
    title: "Create and edit",
    detail:
      "Raise invoices, edit them, mark them paid or unpaid, cancel and reactivate, add and update clients.",
  },
  delete: {
    title: "Delete invoices",
    detail:
      "Permanently remove an invoice. This cannot be undone, and it frees the invoice number for reuse.",
  },
};

export function isScope(value: unknown): value is Scope {
  return typeof value === "string" && (SCOPES as readonly string[]).includes(value);
}

/**
 * Read a scope list from anywhere untrusted (a stored row, an OAuth request).
 * Unknown entries are dropped rather than rejected: the caller asking for
 * something we do not grant should get what we do grant, not an error, which
 * is what an OAuth server is expected to do.
 */
export function parseScopes(value: unknown): Scope[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\s,]+/)
      : [];
  const seen = new Set<Scope>();
  for (const entry of raw) if (isScope(entry)) seen.add(entry);
  return ALL_SCOPES.filter((s) => seen.has(s));
}

/** `read` is implied by the others: an agent that can edit can obviously look. */
export function effectiveScopes(granted: Scope[]): Scope[] {
  if (granted.length === 0) return [];
  const set = new Set(granted);
  if (set.has("write") || set.has("delete")) set.add("read");
  return ALL_SCOPES.filter((s) => set.has(s));
}

export function hasScope(granted: Scope[], required: Scope): boolean {
  return effectiveScopes(granted).includes(required);
}
