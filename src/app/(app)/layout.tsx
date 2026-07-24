import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/server";
import { ThemeToggle } from "@/components/theme-toggle";
import { NavLinks } from "./nav-links";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950">
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-3">
          <Link href="/" className="flex shrink-0 items-center gap-2.5">
            {/* Two files, one hidden per theme. Swapping in JS would flash. */}
            <Image
              src="/logo_black.png"
              alt="Awesome Services"
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
              Awesome Services
            </span>
            <span className="text-xs text-slate-400 dark:text-slate-500">
              Billing
            </span>
          </Link>

          <NavLinks />

          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-slate-500 md:inline dark:text-slate-400">
              {user?.email}
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

      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
    </div>
  );
}
