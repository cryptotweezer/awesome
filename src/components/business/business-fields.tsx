"use client";

import { useEffect, useState } from "react";
import type { Issuer, Org } from "@/lib/types";

/**
 * The business details, asked once and reused twice: when a business is created
 * and when it is edited afterwards.
 *
 * There used to be two forms with nearly the same fields, and they had already
 * drifted apart. Editing one and forgetting the other is not a hypothetical:
 * the ABN was editable in neither, the payment note only in one, and a person
 * met different labels for the same thing depending on the door they came in
 * through. One component means a change lands in both places or in neither.
 *
 * The only real difference is the tax number. Creating a business asks for it;
 * editing one may not be allowed to, because a business billing under several
 * ABNs (Awesome does) has no single value this form could stand for.
 */

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

export type BusinessFieldsProps = {
  /** "create": nothing exists yet, so everything starts blank. */
  mode: "create" | "edit";
  /** Current values, when editing. */
  org?: Org;
  /**
   * The entity whose tax number gets printed, when there is exactly one and it
   * can therefore be edited here. Null when the business bills under several.
   */
  issuer?: Pick<Issuer, "id" | "full_name" | "abn" | "acn"> | null;
  /** Shown read-only when there is more than one, instead of the fields. */
  issuers?: Pick<Issuer, "short_name" | "abn" | "acn">[];
  /** How this person signs the invoices they create by hand. */
  signature?: string;
  /**
   * What was typed on an attempt the server refused, handed back so it can be
   * corrected instead of retyped. Wins over everything else when present.
   */
  values?: Record<string, string>;
};

type BankDetails = {
  bank: string;
  accountName: string;
  bsb: string;
  accountNo: string;
};

/**
 * The line that tells a client how to pay, written from the bank details.
 *
 * The four bank fields are stored but never printed: the only thing that
 * reaches the footer of an invoice is this note. Somebody who fills in their
 * BSB and account number has every reason to think the client will see them,
 * and until now nobody did. So the note writes itself as those fields are
 * typed, and stays editable, because plenty of businesses want to say
 * something else entirely.
 */
export function composePaymentNote({
  bank,
  accountName,
  bsb,
  accountNo,
}: BankDetails): string {
  const who = [accountName.trim(), bank.trim()].filter(Boolean).join(", ");
  const numbers = [
    bsb.trim() && `BSB ${bsb.trim()}`,
    accountNo.trim() && `Account ${accountNo.trim()}`,
  ]
    .filter(Boolean)
    .join(", ");
  const where = [who, numbers].filter(Boolean).join(", ");
  if (!where) return "";
  return `Please pay by bank transfer to ${where}. Use the invoice number as the payment reference.`;
}

export function BusinessFields({
  mode,
  org,
  issuer,
  issuers,
  signature,
  values,
}: BusinessFieldsProps) {
  const editing = mode === "edit";

  /** The typed value if this form is coming back from a refusal, else the saved one. */
  const v = (name: string, saved: string | null | undefined) =>
    values?.[name] ?? saved ?? "";
  const ticked = (name: string, saved: boolean) =>
    values ? values[name] === "on" : saved;

  const [bank, setBank] = useState(() => v("bank_name", org?.bank_name));
  const [accountName, setAccountName] = useState(() =>
    v("bank_account_name", org?.bank_account_name),
  );
  const [bsb, setBsb] = useState(() => v("bank_bsb", org?.bank_bsb));
  const [accountNo, setAccountNo] = useState(() =>
    v("bank_account_no", org?.bank_account_no),
  );
  const [typedNote, setTypedNote] = useState(() =>
    v("payment_note", org?.payment_note),
  );

  /**
   * Whether the note is the person's own words. A saved note that is not
   * exactly what we would have written is theirs, and typing in the box makes
   * it theirs. Either way we stop rewriting it under them.
   */
  const [ownNote, setOwnNote] = useState(() => {
    const saved = v("payment_note", org?.payment_note);
    return (
      saved.trim() !== "" &&
      saved !==
        composePaymentNote({
          bank: v("bank_name", org?.bank_name),
          accountName: v("bank_account_name", org?.bank_account_name),
          bsb: v("bank_bsb", org?.bank_bsb),
          accountNo: v("bank_account_no", org?.bank_account_no),
        })
    );
  });

  // Derived, not stored: while the note is ours, it simply IS the bank details
  // rendered as a sentence, and follows every keystroke in the fields above.
  const note = ownNote
    ? typedNote
    : composePaymentNote({ bank, accountName, bsb, accountNo });

  return (
    <>
      <Card
        title="Your business"
        hint="The name and the tax number printed at the top of every invoice."
      >
        <Field label="Business name" required>
          <input
            name="name"
            required
            defaultValue={v("name", org?.name)}
            autoFocus={!editing}
            className="input"
          />
        </Field>

        <Field label="Business type">
          <select
            name="entity_type"
            defaultValue={v("entity_type", org?.entity_type ?? "sole_trader")}
            className="input"
          >
            <option value="sole_trader">Sole trader</option>
            <option value="company">Company (Pty Ltd)</option>
            <option value="partnership">Partnership</option>
            <option value="trust">Trust</option>
          </select>
        </Field>

        {issuer !== null ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="ABN" required>
                {/* Counted in the browser as well as on the server: a wrong
                    digit should not cost a round trip and a page of retyping. */}
                <input
                  name="tax_id"
                  required
                  inputMode="numeric"
                  maxLength={14}
                  pattern="(\s*\d\s*){11}"
                  title="Eleven digits. Spaces are fine."
                  defaultValue={v("tax_id", issuer?.abn)}
                  className="input"
                />
              </Field>
              <Field label="ACN">
                <input
                  name="acn"
                  inputMode="numeric"
                  maxLength={12}
                  pattern="(\s*\d\s*){9}"
                  title="Nine digits, or leave it empty."
                  defaultValue={v("acn", issuer?.acn)}
                  className="input"
                />
              </Field>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              The ABN is eleven digits and goes on every invoice you send. The
              ACN is nine digits and only companies have one; leave it empty if
              you are a sole trader. Spaces are fine, they are ignored.
            </p>

            <Field label="Legal name registered to the ABN">
              <input
                name="issuer_name"
                defaultValue={v("issuer_name", issuer?.full_name)}
                className="input"
              />
            </Field>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Your own full name if you are a sole trader, or the company name
              if you are a company. Leave it empty to use the business name.
            </p>
          </>
        ) : (
          <div className="space-y-2">
            <p className="text-xs font-medium text-slate-600 dark:text-slate-400">
              Tax numbers
            </p>
            <ul className="space-y-1 text-sm text-slate-700 dark:text-slate-300">
              {(issuers ?? []).map((i) => (
                <li key={i.abn}>
                  {i.short_name} · ABN {i.abn}
                  {i.acn && ` · ACN ${i.acn}`}
                </li>
              ))}
            </ul>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              This business invoices under more than one ABN, so they are not
              edited here: there is no single value this form could stand for.
              Invoices already sent keep the number they were issued under
              either way.
            </p>
          </div>
        )}
      </Card>

      <Card title="Address and contact" hint="Printed under your business name.">
        <Field label="Street address">
          <input
            name="address_line"
            defaultValue={v("address_line", org?.address_line)}
            className="input"
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Suburb">
            <input
              name="suburb"
              defaultValue={v("suburb", org?.suburb)}
              className="input"
            />
          </Field>
          <Field label="State">
            <input
              name="state"
              defaultValue={v("state", org?.state ?? (editing ? "" : "NSW"))}
              className="input"
            />
          </Field>
          <Field label="Postcode">
            <input
              name="postcode"
              defaultValue={v("postcode", org?.postcode)}
              className="input"
            />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Contact email">
            <input
              name="email"
              type="email"
              defaultValue={v("email", org?.email)}
              className="input"
            />
          </Field>
          <Field label="Phone">
            <input
              name="phone"
              defaultValue={v("phone", org?.phone)}
              className="input"
            />
          </Field>
        </div>
      </Card>

      <Card
        title="How you get paid"
        hint="Your bank details are not printed as they are. They go into the payment note below, which is what appears in the footer of every invoice and statement."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Bank">
            <input
              name="bank_name"
              value={bank}
              onChange={(e) => setBank(e.target.value)}
              className="input"
            />
          </Field>
          <Field label="Account name">
            <input
              name="bank_account_name"
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              className="input"
            />
          </Field>
          <Field label="BSB">
            <input
              name="bank_bsb"
              value={bsb}
              onChange={(e) => setBsb(e.target.value)}
              className="input"
            />
          </Field>
          <Field label="Account number">
            <input
              name="bank_account_no"
              value={accountNo}
              onChange={(e) => setAccountNo(e.target.value)}
              className="input"
            />
          </Field>
        </div>
        <Field label="Payment note">
          <input
            name="payment_note"
            value={note}
            onChange={(e) => {
              setOwnNote(true);
              setTypedNote(e.target.value);
            }}
            placeholder="Please pay by the due date. Thank you."
            className="input"
          />
        </Field>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {ownNote ? (
            <>
              This is your own wording, so it stays as you left it.{" "}
              <button
                type="button"
                onClick={() => setOwnNote(false)}
                className="underline underline-offset-2 hover:text-slate-700 dark:hover:text-slate-200"
              >
                Write it from my bank details again
              </button>
              .
            </>
          ) : (
            "Written for you from the details above, and kept up to date as you change them. Edit it and it stays exactly as you leave it."
          )}
        </p>
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
              defaultValue={v("terms_days", String(org?.terms_days ?? 7))}
              className="input"
            />
          </Field>
          <Field label="Time zone">
            <select
              name="timezone"
              defaultValue={v("timezone", org?.timezone ?? "Australia/Sydney")}
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

        <Field label="Who creates the invoices">
          <input name="display_name" defaultValue={v("display_name", signature)} className="input" />
        </Field>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Your name, so you can tell who issued each invoice.
        </p>
      </Card>

      <Card
        title="GST"
        hint="Only if you are registered. In Australia that is compulsory once you turn over $75,000 a year, and it needs an ABN."
      >
        <label className="flex items-start gap-3 text-sm text-slate-700 dark:text-slate-300">
          <input
            type="checkbox"
            name="gst_registered"
            defaultChecked={ticked("gst_registered", org?.gst_registered ?? false)}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 dark:border-slate-600"
          />
          <span>
            My business is registered for GST
            <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
              Your prices already include GST, so nothing you charge changes.
              New invoices are titled &ldquo;Tax invoice&rdquo; and show the
              10% inside the total, and the dashboard starts adding up what you
              have collected for the quarter. Invoices already sent are never
              touched.
            </span>
          </span>
        </label>
      </Card>

      {/* Not on a trial. Somebody trying the app is here to see whether it
          bills, and this asks them to decide how they price their work before
          they have raised a single invoice. Left off, which is what a trial
          already defaults to, the client form asks who the client is and the
          price is set on each invoice line, which needs no explanation. A
          business that agrees rates in advance turns it on once it is real. */}
      {editing && !org?.is_demo && (
        <Card
          title="How you bill"
          hint="Only about how much the forms fill in for you. Nothing here changes an invoice that already exists."
        >
          <Field label="Your usual service">
            <input
              name="default_service_description"
              defaultValue={v("default_service_description", org?.default_service_description)}
              placeholder="Leave empty if it is different every time"
              className="input"
            />
          </Field>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            If you sell the same thing over and over, put it here and every new
            invoice line starts with it. If not, leave it empty and say what the
            work was on each line.
          </p>

          <label className="flex items-start gap-3 text-sm text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              name="per_client_defaults"
              defaultChecked={ticked("per_client_defaults", org?.per_client_defaults ?? false)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 dark:border-slate-600"
            />
            <span>
              Agree a service and a rate with each client
              <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                For work priced in advance and repeated. With this off, the
                client form only asks who they are, and the price is set on each
                invoice line.
              </span>
            </span>
          </label>
        </Card>
      )}
    </>
  );
}

/**
 * The logo, while the business is being created. There is nothing to compare it
 * against yet, so this is only the file and what it looks like: the "now versus
 * next" pair belongs to Settings, where a logo already exists.
 */
export function LogoPicker() {
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(
    () => () => {
      if (picked) URL.revokeObjectURL(picked);
    },
    [picked],
  );

  return (
    <Card
      title="Your logo"
      hint="Printed in the top corner of your invoices and statements. PNG or JPEG, up to 1 MB. You can add it later."
    >
      <div className="flex flex-wrap items-center gap-6">
        <LogoPreview label="Preview" src={picked} empty="No logo" />
        <input
          type="file"
          name="logo"
          accept="image/png,image/jpeg"
          onChange={(e) => {
            const file = e.target.files?.[0];
            setPicked((old) => {
              if (old) URL.revokeObjectURL(old);
              return file ? URL.createObjectURL(file) : null;
            });
          }}
          className="text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white dark:text-slate-400 dark:file:bg-slate-100 dark:file:text-slate-900"
        />
      </div>
    </Card>
  );
}

/**
 * One thumbnail on a neutral tile. The tile is deliberately plain white in both
 * themes: a logo made for paper is judged against paper, and a dark panel would
 * flatter a mark that will print badly.
 */
export function LogoPreview({
  label,
  src,
  empty,
}: {
  label: string;
  src: string | null;
  empty: string;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <div className="flex h-20 w-20 items-center justify-center rounded-xl border border-slate-200 bg-white p-2 dark:border-slate-700">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={label}
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <span className="px-1 text-center text-[10px] leading-tight text-slate-400">
            {empty}
          </span>
        )}
      </div>
    </div>
  );
}

export function Card({
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

export function Field({
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
