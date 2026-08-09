import { requireOrg } from "@/lib/data/org";
import { listIssuers } from "@/lib/data/issuers";
import { SettingsForm } from "./settings-form";

export default async function SettingsPage() {
  const { org } = await requireOrg();
  const issuers = await listIssuers(org.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          Business details
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          What gets printed on your invoices and statements
        </p>
      </div>

      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          {issuers.length === 1 ? "Who issues your invoices" : "Who issues invoices"}
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Each entry is a separate legal entity and gets its own tax statement.
        </p>
        <ul className="mt-3 space-y-1.5">
          {issuers.map((i) => (
            <li key={i.id} className="text-sm text-slate-700 dark:text-slate-300">
              {i.full_name}{" "}
              <span className="text-slate-400 dark:text-slate-500">
                {org.tax_id_label} {i.abn}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <SettingsForm org={org} />
    </div>
  );
}
