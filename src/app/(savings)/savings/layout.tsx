import Link from "next/link";
import Image from "next/image";
import { awesomeForPage } from "@/lib/data/org";
import { ThemeToggle } from "@/components/theme-toggle";
import { SavingsNav } from "./savings-nav";

/**
 * The savings dashboard: Awesome's own, and nobody else's.
 *
 * It deliberately does not sit inside the billing dashboard's chrome. The two
 * answer different questions. Billing is about what was sent to a client and
 * whether it was paid; this is about what the household and the business take
 * in, what they spend, and what is left. Sharing a header would suggest they
 * are two views of one thing, and the first mistake anybody would make is to
 * expect a cash client to turn up in the invoice history.
 *
 * What they DO share is everything underneath: the same sign-in, the same
 * clients, the same database and the same agent gateway. That is the whole
 * reason this is not a second application.
 *
 * `awesomeForPage()` is the gate. A guest business that types the URL is
 * returned to its own overview, because for them this section does not exist.
 */
export default async function SavingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const org = await awesomeForPage();
  const name = org.display_name ?? org.name;

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950">
      {/* Full width on purpose. The billing dashboard is a column of forms and
          reads better centred; this one is tables of weeks and money side by
          side, and every pixel given back to a margin is a column somebody has
          to scroll for. */}
      {/* On a phone the sidebar is gone, so the same links become a row that
          scrolls sideways. Without it the section had no navigation at all
          below the md breakpoint: you could reach a page and not leave it. */}
      <div className="space-y-3 px-4 py-4 md:hidden">
        <div className="flex items-center justify-between gap-3">
          <Link href="/savings" className="flex items-center gap-2.5">
            <Image
              src="/logo_black.png"
              alt={name}
              width={26}
              height={26}
              className="dark:hidden"
              priority
            />
            <Image
              src="/logo_white.png"
              alt=""
              width={26}
              height={26}
              className="hidden dark:block"
              priority
            />
            <div className="leading-tight">
              <p className="text-sm font-bold tracking-tight text-slate-900 dark:text-slate-100">
                {name}
              </p>
              <p className="text-[11px] text-slate-400 dark:text-slate-500">
                Savings
              </p>
            </div>
          </Link>
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="text-xs font-medium text-slate-500 underline-offset-2 hover:underline dark:text-slate-400"
            >
              Billing
            </Link>
            <ThemeToggle />
          </div>
        </div>
        <SavingsNav variant="bar" />
      </div>

      <div className="flex gap-6 px-4 pb-6 md:px-6 md:py-6">
        <aside className="hidden w-56 shrink-0 md:block">
          <div className="sticky top-6 space-y-4">
            <Link href="/savings" className="flex items-center gap-2.5 px-2">
              <Image
                src="/logo_black.png"
                alt={name}
                width={28}
                height={28}
                className="dark:hidden"
                priority
              />
              <Image
                src="/logo_white.png"
                alt=""
                width={28}
                height={28}
                className="hidden dark:block"
                priority
              />
              <div className="leading-tight">
                <p className="text-sm font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  {name}
                </p>
                <p className="text-[11px] text-slate-400 dark:text-slate-500">
                  Savings
                </p>
              </div>
            </Link>

            <SavingsNav />

            <div className="space-y-2 px-2 pt-2">
              <Link
                href="/"
                className="block text-xs font-medium text-slate-500 underline-offset-2 hover:underline dark:text-slate-400"
              >
                Back to billing
              </Link>
              <ThemeToggle />
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
