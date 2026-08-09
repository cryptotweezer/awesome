"use client";

import { useActionState } from "react";
import {
  saveSettingsAction,
  uploadLogoAction,
  removeLogoAction,
  type SettingsState,
} from "./actions";
import type { Org } from "@/lib/types";

const initial: SettingsState = { ok: false };

const TIMEZONES = [
  "Australia/Sydney",
  "Australia/Melbourne",
  "Australia/Brisbane",
  "Australia/Adelaide",
  "Australia/Perth",
  "Australia/Darwin",
  "Australia/Hobart",
  "Pacific/Auckland",
  "UTC",
];

export function SettingsForm({ org }: { org: Org }) {
  const [state, action, pending] = useActionState(saveSettingsAction, initial);

  return (
    <div className="space-y-8">
      <LogoCard org={org} />
      <form action={action} className="space-y-8">
        <Card
          title="Your business"
          hint="The name and details printed at the top of every invoice."
        >
          <Field label="Business name" required>
            <input
              name="name"
              required
              defaultValue={org.name}
              className="input"
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Business type">
              <select
                name="entity_type"
                defaultValue={org.entity_type}
                className="input"
              >
                <option value="sole_trader">Sole trader</option>
                <option value="company">Company (Pty Ltd)</option>
                <option value="partnership">Partnership</option>
                <option value="trust">Trust</option>
              </select>
            </Field>
            <Field label="Tax number type">
              <select
                name="tax_id_label"
                defaultValue={org.tax_id_label}
                className="input"
              >
                <option value="ABN">ABN</option>
                <option value="TFN">TFN</option>
                <option value="ACN">ACN</option>
              </select>
            </Field>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            The tax number itself lives on the entity that issues your invoices
            and is not edited here, because past invoices keep the number they
            were issued under.
          </p>
        </Card>

        <Card
          title="Address and contact"
          hint="Printed under your business name."
        >
          <Field label="Street address">
            <input
              name="address_line"
              defaultValue={org.address_line ?? ""}
              className="input"
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Suburb">
              <input
                name="suburb"
                defaultValue={org.suburb ?? ""}
                className="input"
              />
            </Field>
            <Field label="State">
              <input
                name="state"
                defaultValue={org.state ?? ""}
                className="input"
              />
            </Field>
            <Field label="Postcode">
              <input
                name="postcode"
                defaultValue={org.postcode ?? ""}
                className="input"
              />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Contact email">
              <input
                name="email"
                type="email"
                defaultValue={org.email ?? ""}
                className="input"
              />
            </Field>
            <Field label="Phone">
              <input
                name="phone"
                defaultValue={org.phone ?? ""}
                className="input"
              />
            </Field>
          </div>
        </Card>

        <Card
          title="How you get paid"
          hint="These appear in the footer of every invoice and statement."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Bank">
              <input
                name="bank_name"
                defaultValue={org.bank_name ?? ""}
                className="input"
              />
            </Field>
            <Field label="Account name">
              <input
                name="bank_account_name"
                defaultValue={org.bank_account_name ?? ""}
                className="input"
              />
            </Field>
            <Field label="BSB">
              <input
                name="bank_bsb"
                defaultValue={org.bank_bsb ?? ""}
                className="input"
              />
            </Field>
            <Field label="Account number">
              <input
                name="bank_account_no"
                defaultValue={org.bank_account_no ?? ""}
                className="input"
              />
            </Field>
          </div>
          <Field label="Payment note">
            <input
              name="payment_note"
              defaultValue={org.payment_note ?? ""}
              className="input"
            />
          </Field>
        </Card>

        <Card
          title="Terms and time"
          hint="Changing your terms affects new invoices only. Invoices already issued keep the terms they were issued under."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Payment terms (days)">
              <input
                name="terms_days"
                type="number"
                min={0}
                max={365}
                defaultValue={org.terms_days}
                className="input"
              />
            </Field>
            <Field label="Time zone">
              <select
                name="timezone"
                defaultValue={org.timezone}
                className="input"
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Your time zone decides what counts as today, which is what makes an
            invoice overdue and which financial year it lands in.
          </p>
        </Card>

        {state.error && (
          <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {state.error}
          </p>
        )}
        {state.saved && !state.error && (
          <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
            Saved. New documents will use these details.
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
        >
          {pending ? "Saving..." : "Save changes"}
        </button>
      </form>
    </div>
  );
}

/**
 * The logo is its own form because it posts a file, and because uploading one
 * should not require filling in the rest of the page first.
 */
function LogoCard({ org }: { org: Org }) {
  const [upState, upload, uploading] = useActionState(
    uploadLogoAction,
    initial,
  );
  const [rmState, remove, removing] = useActionState(removeLogoAction, initial);
  const error = upState.error ?? rmState.error;

  return (
    <section className="space-y-4 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
      <div>
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Your logo
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Printed in the top corner of your invoices and statements. PNG or
          JPEG, up to 1 MB. Without one, documents show your business name on
          its own.
        </p>
      </div>

      <p className="text-sm text-slate-700 dark:text-slate-300">
        {org.logo_path ? "A logo is set." : "No logo yet."}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <form action={upload} className="flex flex-wrap items-center gap-3">
          <input
            type="file"
            name="logo"
            accept="image/png,image/jpeg"
            required
            className="text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white dark:text-slate-400 dark:file:bg-slate-100 dark:file:text-slate-900"
          />
          <button
            type="submit"
            disabled={uploading}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300 transition hover:bg-slate-50 disabled:opacity-60 dark:text-slate-200 dark:ring-slate-700 dark:hover:bg-slate-800"
          >
            {uploading ? "Uploading..." : "Upload"}
          </button>
        </form>

        {org.logo_path && (
          <form action={remove}>
            <button
              type="submit"
              disabled={removing}
              className="rounded-lg px-4 py-2 text-sm font-medium text-slate-500 transition hover:text-red-600 disabled:opacity-60 dark:text-slate-400 dark:hover:text-red-400"
            >
              {removing ? "Removing..." : "Remove"}
            </button>
          </form>
        )}
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
    </section>
  );
}

function Card({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
      <div>
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          {title}
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">{hint}</p>
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </span>
      {children}
    </label>
  );
}
