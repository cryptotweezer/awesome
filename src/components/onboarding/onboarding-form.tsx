"use client";

import { useActionState } from "react";
import { createOrgAction, type OnboardingState } from "@/app/onboarding/actions";
import { BusinessFields, LogoPicker } from "@/components/business/business-fields";

const initial: OnboardingState = { ok: false };

/**
 * Creating the business. The same fields Business details shows afterwards, so
 * nothing moves or gets renamed between signing up and coming back to edit it.
 *
 * Only the business name and the ABN are required; everything else can be
 * filled in later from that same page. Nothing is pre-filled from the Google
 * account: seeing your own name and email offered as examples reads as the app
 * knowing more about you than it should, and an example is easy to mistake for
 * a value that was saved.
 */
export function OnboardingForm() {
  const [state, action, pending] = useActionState(createOrgAction, initial);

  return (
    <form action={action} className="space-y-6">
      {/*
        The key is what makes a rejected form survive. React clears a form once
        its action returns, so the fields have to be remounted for the values
        that came back to become their defaults again. Without it, one wrong
        digit in an ABN costs the whole page of details, which is exactly what
        happened in testing.
      */}
      <BusinessFields
        key={state.attempt ?? 0}
        mode="create"
        values={state.values}
      />
      <LogoPicker key={`logo-${state.attempt ?? 0}`} />

      {state.error && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          <p>{state.error}</p>
          {state.logoLost && (
            <p className="mt-1 text-xs">
              Everything else is still here, but you will have to choose your
              logo file again: browsers never hand a file back.
            </p>
          )}
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
      >
        {pending ? "Creating..." : "Create my business"}
      </button>
    </form>
  );
}
