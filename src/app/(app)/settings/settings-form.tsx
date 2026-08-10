"use client";

import { useActionState, useEffect, useState } from "react";
import {
  saveSettingsAction,
  uploadLogoAction,
  removeLogoAction,
  deleteAccountAction,
  type SettingsState,
} from "./actions";
import {
  BusinessFields,
  Card,
  LogoPreview,
} from "@/components/business/business-fields";
import type { Issuer, Org } from "@/lib/types";

const initial: SettingsState = { ok: false };

/**
 * Business details: the same fields the sign-up form asks for, filled in.
 *
 * The logo and the danger zone are their own forms. The logo posts a file and
 * should not need the rest of the page filled in first; closing the account is
 * not something to hide behind a Save button.
 */
export function SettingsForm({
  org,
  issuers,
  signature,
}: {
  org: Org;
  issuers: Issuer[];
  signature: string;
}) {
  const [state, action, pending] = useActionState(saveSettingsAction, initial);

  // With one entity the tax numbers are simply this business's own and can be
  // corrected here. With several (Awesome bills under two ABNs) there is no
  // single value a field could stand for, so they are shown and not edited.
  const sole = issuers.length === 1 ? issuers[0] : null;

  return (
    <div className="space-y-8">
      <LogoCard org={org} />

      <form action={action} className="space-y-8">
        {/* Remounted on every answer, so a refused save comes back with what
            was typed instead of with what is stored: React clears a form once
            its action returns. */}
        <BusinessFields
          key={state.attempt ?? 0}
          mode="edit"
          org={org}
          issuer={sole}
          issuers={issuers}
          signature={signature}
          values={state.error ? state.values : undefined}
        />

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

      {org.is_demo && <DangerZone org={org} />}
    </div>
  );
}

/**
 * Closing the account. Last on the page, visually separate, and only for trial
 * businesses: Awesome cannot be deleted from a web form, and the database would
 * refuse anyway.
 *
 * The export comes first on purpose. Somebody who wanted to leave and lost
 * their invoices in the process was not warned, they were processed.
 */
function DangerZone({ org }: { org: Org }) {
  const [state, remove, pending] = useActionState(deleteAccountAction, initial);
  const expected = (org.display_name ?? org.name).trim();
  const [typed, setTyped] = useState("");

  return (
    <section className="space-y-4 rounded-2xl border border-red-200 bg-red-50/50 p-6 dark:border-red-900 dark:bg-red-950/20">
      <div>
        <h2 className="text-sm font-semibold text-red-900 dark:text-red-200">
          Close this account
        </h2>
        <p className="mt-1 text-xs text-red-800/80 dark:text-red-300/80">
          Deletes the business, its clients, its invoices and its agent keys.
          There is no undo and no copy kept.
        </p>
      </div>

      <p className="text-sm text-red-900 dark:text-red-200">
        <a href="/backup" className="font-semibold underline">
          Download a backup first
        </a>{" "}
        if you want to keep any of it.
      </p>

      <form action={remove} className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-red-900 dark:text-red-200">
            Type {expected} to confirm
          </span>
          <input
            name="confirm_name"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            className="input"
          />
        </label>
        <button
          type="submit"
          disabled={pending || typed.trim() !== expected}
          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-40"
        >
          {pending ? "Deleting..." : "Delete everything"}
        </button>
      </form>

      {state.error && (
        <p className="rounded-lg bg-red-100 px-4 py-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-300">
          {state.error}
        </p>
      )}
    </section>
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

  // A blob URL for the file sitting in the picker, so the preview costs no
  // round trip and works before anything is uploaded. Revoked when it is
  // replaced or the card goes away, or the browser holds the file forever.
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => () => { if (picked) URL.revokeObjectURL(picked); }, [picked]);

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setPicked((old) => {
      if (old) URL.revokeObjectURL(old);
      return file ? URL.createObjectURL(file) : null;
    });
  }

  // Once the upload has gone through, the chosen file IS the current logo, so
  // showing it twice would be noise. Derived rather than cleared in an effect:
  // one less thing that can be out of step with what was saved.
  const preview = upState.saved || rmState.saved ? null : picked;

  return (
    <Card
      title="Your logo"
      hint="Printed in the top corner of your invoices and statements. PNG or JPEG, up to 1 MB. Without one, documents show your business name on its own."
    >
      {/* Uploading blind is how you end up printing the wrong image on an
          invoice: what is set now and what is about to replace it are both
          shown, side by side, before anything is sent. */}
      <div className="flex flex-wrap items-center gap-6">
        <LogoPreview
          label="Now"
          src={org.logo_path ? `/org-logo?v=${org.updated_at}` : null}
          empty="No logo yet"
        />
        {preview && (
          <>
            <span aria-hidden className="text-slate-300 dark:text-slate-600">
              &rarr;
            </span>
            <LogoPreview label="Chosen file" src={preview} empty="" />
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <form action={upload} className="flex flex-wrap items-center gap-3">
          <input
            type="file"
            name="logo"
            accept="image/png,image/jpeg"
            required
            onChange={onPick}
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
    </Card>
  );
}
