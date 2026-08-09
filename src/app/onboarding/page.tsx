import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/data/org";
import { ThemeToggle } from "@/components/theme-toggle";
import { OnboardingForm } from "./onboarding-form";

/**
 * The first screen after signing in with no business attached. It lives outside
 * the (app) group on purpose: that layout redirects here when there is no
 * organisation, so being inside it would loop.
 */
export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) redirect("/login");

  // Somebody who already has a business has no business being here.
  if (await getCurrentOrg()) redirect("/");

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950">
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-6 py-3">
          <span className="text-base font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Set up your business
          </span>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-slate-500 md:inline dark:text-slate-400">
              {user.email}
            </span>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          Tell us who is invoicing
        </h1>
        <p className="mt-1 mb-8 text-sm text-slate-500 dark:text-slate-400">
          Everything here goes on your invoices, and only yours. You can change
          any of it later, and only the first two fields are needed to start.
        </p>

        <OnboardingForm email={user.email} />
      </main>
    </div>
  );
}
