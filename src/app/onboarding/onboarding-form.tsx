"use client";

import { useActionState } from "react";
import { createOrgAction, type OnboardingState } from "./actions";

const initial: OnboardingState = { ok: false };

/**
 * One screen, one form. Everything asked here ends up printed on the person's
 * invoices, so the labels say where each field will show up rather than naming
 * the column. Only the business name and the tax number are required; the rest
 * can be filled in later from Settings.
 */
export function OnboardingForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState(createOrgAction, initial);

  return (
    <form action={action} className="space-y-8">
      <section className="space-y-4">
        <SectionTitle
          title="Your business"
          hint="This is the name printed at the top of every invoice."
        />
        <Field label="Business name" required>
          <input name="name" required autoFocus className="input" />
        </Field>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Business type">
            <select name="entity_type" defaultValue="sole_trader" className="input">
              <option value="sole_trader">Sole trader</option>
              <option value="company">Company (Pty Ltd)</option>
              <option value="partnership">Partnership</option>
              <option value="trust">Trust</option>
            </select>
          </Field>
          <Field label="Tax number type">
            <select name="tax_id_label" defaultValue="ABN" className="input">
              <option value="ABN">ABN</option>
              <option value="TFN">TFN</option>
              <option value="ACN">ACN</option>
            </select>
          </Field>
          <Field label="Tax number" required>
            <input name="tax_id" required className="input" />
          </Field>
        </div>

        <Field label="Name on the tax number">
          <input
            name="issuer_name"
            placeholder="Leave blank to use the business name"
            className="input"
          />
        </Field>
      </section>

      <section className="space-y-4">
        <SectionTitle
          title="Where you are"
          hint="Printed under your business name. You can leave this for later."
        />
        <Field label="Street address">
          <input name="address_line" className="input" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Suburb">
            <input name="suburb" className="input" />
          </Field>
          <Field label="State">
            <input name="state" defaultValue="NSW" className="input" />
          </Field>
          <Field label="Postcode">
            <input name="postcode" className="input" />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Contact email">
            <input
              name="email"
              type="email"
              placeholder={email}
              className="input"
            />
          </Field>
          <Field label="Phone">
            <input name="phone" className="input" />
          </Field>
        </div>
      </section>

      <section className="space-y-4">
        <SectionTitle
          title="How you get paid"
          hint="These details appear in the footer of every invoice."
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Bank">
            <input name="bank_name" className="input" />
          </Field>
          <Field label="Account name">
            <input name="bank_account_name" className="input" />
          </Field>
          <Field label="BSB">
            <input name="bank_bsb" className="input" />
          </Field>
          <Field label="Account number">
            <input name="bank_account_no" className="input" />
          </Field>
        </div>
        <Field label="Payment note">
          <input
            name="payment_note"
            placeholder="Please pay by the due date. Thank you."
            className="input"
          />
        </Field>
      </section>

      <section className="space-y-4">
        <SectionTitle
          title="Your terms"
          hint="How long a client has to pay before an invoice counts as overdue."
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Payment terms (days)">
            <input
              name="terms_days"
              type="number"
              min={0}
              max={365}
              defaultValue={7}
              className="input"
            />
          </Field>
          <Field label="How you sign your invoices">
            <input
              name="display_name"
              placeholder={email.split("@")[0]}
              className="input"
            />
          </Field>
        </div>
      </section>

      {state.error && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {state.error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
        >
          {pending ? "Creating..." : "Create my business"}
        </button>
        <a
          href="/auth/signout"
          className="text-sm text-slate-500 hover:underline dark:text-slate-400"
        >
          Sign out
        </a>
      </div>
    </form>
  );
}

function SectionTitle({ title, hint }: { title: string; hint: string }) {
  return (
    <div>
      <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
        {title}
      </h2>
      <p className="text-xs text-slate-500 dark:text-slate-400">{hint}</p>
    </div>
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
