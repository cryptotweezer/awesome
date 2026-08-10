import { getCurrentOrg, signatureFor } from "@/lib/data/org";
import { listIssuers } from "@/lib/data/issuers";
import { OnboardingForm } from "@/components/onboarding/onboarding-form";
import { SettingsForm } from "./settings-form";

/**
 * Business details, which is also where a business is born.
 *
 * Creating it and editing it are the same page on purpose: the person who just
 * filled this in knows exactly where to come back to, and there is only one
 * screen to keep consistent instead of two that drift.
 */
export default async function SettingsPage() {
  const ctx = await getCurrentOrg();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          Business details
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {ctx
            ? "What gets printed on your invoices and statements"
            : "Your business name and your ABN are enough to start. Everything else can wait."}
        </p>
      </div>

      {ctx ? (
        <SettingsForm
          org={ctx.org}
          issuers={await listIssuers(ctx.org.id)}
          signature={signatureFor(ctx.member)}
        />
      ) : (
        <OnboardingForm />
      )}
    </div>
  );
}
