import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
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
    <div className="min-h-screen bg-slate-100">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-3">
          <Link href="/" className="shrink-0">
            <span className="text-base font-bold tracking-tight text-slate-900">
              Awesome Cleaning
            </span>
            <span className="ml-2 text-xs text-slate-400">Billing</span>
          </Link>

          <NavLinks />

          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-slate-500 md:inline">
              {user?.email}
            </span>
            <a
              href="/auth/signout"
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
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
