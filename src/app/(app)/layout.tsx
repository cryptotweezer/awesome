import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { getCurrentOrg } from "@/lib/data/org";
import { createAdminClient } from "@/lib/supabase/admin";
import { ThemeToggle } from "@/components/theme-toggle";
import { NavLinks } from "./nav-links";

/**
 * The one place that answers "which business is this?" for the whole dashboard.
 * The proxy has already established there is a session; if that person has no
 * organisation yet they get sent to onboarding rather than an empty dashboard.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getCurrentOrg();
  if (!ctx) redirect("/onboarding");
  const { org, member } = ctx;
  const name = org.display_name ?? org.name;
  // Note: nothing marks activity here. The purge derives it from the data
  // instead (see awesome.purge_stale_demo_orgs), which is both more honest and
  // free, rather than writing a heartbeat on every page render.

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950">
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-3">
          <Link href="/" className="flex shrink-0 items-center gap-2.5">
            {/* Two files, one hidden per theme. Swapping in JS would flash. */}
            <Image
              src="/logo_black.png"
              alt={name}
              width={32}
              height={32}
              className="dark:hidden"
              priority
            />
            <Image
              src="/logo_white.png"
              alt=""
              width={32}
              height={32}
              className="hidden dark:block"
              priority
            />
            <span className="text-base font-bold tracking-tight text-slate-900 dark:text-slate-100">
              {name}
            </span>
            <span className="text-xs text-slate-400 dark:text-slate-500">
              Billing
            </span>
          </Link>

          <NavLinks />

          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-slate-500 md:inline dark:text-slate-400">
              {member.email}
            </span>
            <ThemeToggle />
            <a
              href="/auth/signout"
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Sign out
            </a>
          </div>
        </div>
      </header>

      {org.is_demo && <TrialBanner orgId={org.id} />}

      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
    </div>
  );
}

/**
 * What a trial account is, said plainly and on every page: how much room is
 * left and that it expires. Somebody who only finds this out when their data is
 * gone was not told, whatever the terms said.
 */
async function TrialBanner({ orgId }: { orgId: string }) {
  const db = createAdminClient();
  const head = { count: "exact" as const, head: true };
  const [org, invoices, clients] = await Promise.all([
    db
      .from("orgs")
      .select("max_invoices, max_clients")
      .eq("id", orgId)
      .single(),
    db.from("invoices").select("*", head).eq("org_id", orgId),
    db.from("clients").select("*", head).eq("org_id", orgId),
  ]);

  const maxInvoices = org.data?.max_invoices;
  const maxClients = org.data?.max_clients;

  return (
    <div className="border-b border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-6 py-2 text-xs text-amber-900 dark:text-amber-200">
        <p>
          <span className="font-semibold">Trial account.</span>{" "}
          {maxInvoices != null && (
            <>
              {invoices.count ?? 0} of {maxInvoices} invoices
              {maxClients != null && (
                <>
                  , {clients.count ?? 0} of {maxClients} clients
                </>
              )}
              .{" "}
            </>
          )}
          Deleted after 30 days without use, so export anything you want to keep.
        </p>
        <Link href="/guide" className="shrink-0 font-semibold underline">
          Take it with you
        </Link>
      </div>
    </div>
  );
}
