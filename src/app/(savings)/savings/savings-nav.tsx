"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The sections of the savings dashboard, including the ones that do not exist
 * yet.
 *
 * The unbuilt ones are shown greyed rather than hidden, for the same reason the
 * billing navigation disables its links before a business exists: a menu that
 * grows an item every week teaches nobody the shape of the thing. Seeing where
 * the rotation and the weeks are going to live is worth more than a tidy list.
 */
const SECTIONS: { href: string; label: string; ready: boolean }[] = [
  { href: "/savings/overview", label: "Overview", ready: true },
  { href: "/savings/weeks", label: "Weeks", ready: true },
  { href: "/savings/rotation", label: "Rotation", ready: true },
  { href: "/savings/clients", label: "Clients", ready: true },
  { href: "/savings/expenses", label: "Expenses", ready: true },
  { href: "/savings/loans", label: "Loans", ready: true },
  { href: "/savings/plan", label: "Plan", ready: true },
  { href: "/savings/vault", label: "Vault", ready: true },
];

/**
 * The same list, two shapes.
 *
 * `sidebar` is the column on a wide screen. `bar` is a row that scrolls
 * sideways, for a phone, where the sidebar is hidden: without it there was no
 * way to leave the page you landed on, which is not a navigation at all.
 */
export function SavingsNav({
  variant = "sidebar",
}: {
  variant?: "sidebar" | "bar";
}) {
  const pathname = usePathname();

  if (variant === "bar") {
    return (
      <nav className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1">
        {SECTIONS.map((s) => {
          const active = pathname.startsWith(s.href);
          if (!s.ready) {
            return (
              <span
                key={s.href}
                aria-disabled="true"
                className="shrink-0 cursor-not-allowed rounded-lg px-3 py-2 text-sm font-medium text-slate-400 dark:text-slate-600"
              >
                {s.label}
              </span>
            );
          }
          return (
            <Link
              key={s.href}
              href={s.href}
              className={`shrink-0 rounded-lg px-3 py-2 text-sm font-medium transition ${
                active
                  ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                  : "bg-white text-slate-600 dark:bg-slate-900 dark:text-slate-400"
              }`}
            >
              {s.label}
            </Link>
          );
        })}
      </nav>
    );
  }

  return (
    <nav className="space-y-1">
      {SECTIONS.map((s) => {
        if (!s.ready) {
          return (
            <span
              key={s.href}
              aria-disabled="true"
              title="Coming in a later phase"
              className="block cursor-not-allowed rounded-lg px-3 py-2 text-sm font-medium text-slate-400 dark:text-slate-600"
            >
              {s.label}
            </span>
          );
        }

        const active = pathname.startsWith(s.href);

        return (
          <Link
            key={s.href}
            href={s.href}
            className={`block rounded-lg px-3 py-2 text-sm font-medium transition ${
              active
                ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                : "text-slate-600 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-800"
            }`}
          >
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}
