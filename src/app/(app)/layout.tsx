import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { AWESOME_ORG_ID, getCurrentOrg } from "@/lib/data/org";
import { createAdminClient } from "@/lib/supabase/admin";
import { ThemeToggle } from "@/components/theme-toggle";
import { AssistantWidget } from "@/components/assistant/assistant-widget";
import { DashboardTour } from "@/components/tour/dashboard-tour";
import { createClient } from "@/lib/supabase/server";
import { daysSince } from "@/lib/format";
import { NavLinks } from "./nav-links";

/**
 * The one place that answers "which business is this?" for the whole dashboard.
 *
 * An account with no business yet gets the same dashboard as everybody else,
 * empty and switched off, with the tour running over it. It is not sent to a
 * form: being asked for a tax number by an application you have never seen is
 * the worst possible first screen, and it hides the very thing that would
 * explain why the number is wanted.
 *
 * Pages other than the overview and Business details need a business to show
 * anything, and `orgForPage()` sends them back here when there is none.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getCurrentOrg();

  // No business yet: the session is still the source of the email in the
  // header, and the proxy has already established there is one.
  let email = ctx?.member.email ?? "";
  if (!ctx) {
    const auth = await createClient();
    const {
      data: { user },
    } = await auth.auth.getUser();
    if (!user?.email) redirect("/login");
    email = user.email;
  }

  const org = ctx?.org ?? null;
  const name = org ? (org.display_name ?? org.name) : "Your business";
  const isAwesome = org?.id === AWESOME_ORG_ID;

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950">
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-3">
          <Link href="/" className="flex shrink-0 items-center gap-2.5">
            {/*
              Each business wears its own mark. Awesome ships two files, one per
              theme, and swapping them in JS would flash. Anybody else uploaded
              a single image, served from the private bucket by /org-logo, and a
              business with no logo shows none: the built-in one is Awesome's
              identity, not a placeholder.
            */}
            {org?.logo_path ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src="/org-logo"
                alt={name}
                width={32}
                height={32}
                className="h-8 w-8 rounded object-contain"
              />
            ) : isAwesome ? (
              <>
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
              </>
            ) : null}
            <span className="text-base font-bold tracking-tight text-slate-900 dark:text-slate-100">
              {name}
            </span>
            <span className="text-xs text-slate-400 dark:text-slate-500">
              Billing
            </span>
          </Link>

          <NavLinks disabled={!org} />

          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-slate-500 md:inline dark:text-slate-400">
              {email}
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

      {org?.is_demo && <TrialBanner orgId={org.id} />}

      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>

      {/* Not a page: a panel over whatever page you are on, because the
          question is nearly always about what is on the screen. */}
      {org && (
        <AssistantWidget
          orgId={org.id}
          remaining={
            org.max_ai_messages === null
              ? null
              : Math.max(0, org.max_ai_messages - org.ai_messages_used)
          }
          suggestions={[
            "What am I owed?",
            "Which invoices are overdue?",
            "Show me my recent invoices",
            "What did I bill this financial year?",
          ]}
        />
      )}

      {/* Mounted here because it points at things in the header as well as
          things on the page. It draws nothing until it has a reason to. */}
      <DashboardTour
        hasOrg={Boolean(org)}
        done={Boolean(org?.onboarding?.tour_done)}
      />
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
      .select("max_invoices, max_clients, created_at")
      .eq("id", orgId)
      .single(),
    db.from("invoices").select("*", head).eq("org_id", orgId),
    db.from("clients").select("*", head).eq("org_id", orgId),
  ]);

  const maxInvoices = org.data?.max_invoices;
  const maxClients = org.data?.max_clients;

  // Whole days left of the thirty, floored at zero: the purge runs once a day,
  // so "0 days left" honestly means "any time now".
  const daysLeft = org.data?.created_at
    ? Math.max(0, 30 - daysSince(org.data.created_at))
    : null;

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
          {daysLeft == null
            ? "Deleted 30 days after sign-up, used or not, so export anything you want to keep."
            : `Deleted in ${daysLeft} ${daysLeft === 1 ? "day" : "days"}, used or not, so export anything you want to keep.`}
        </p>
        <Link href="/guide" className="shrink-0 font-semibold underline">
          Take it with you
        </Link>
      </div>
    </div>
  );
}
