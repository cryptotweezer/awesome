"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Overview", tour: "nav-overview" },
  { href: "/history", label: "History", tour: "nav-history" },
  { href: "/invoices/new", label: "New Invoice", tour: "nav-invoices" },
  { href: "/clients", label: "Clients", tour: "nav-clients" },
  { href: "/statements", label: "Statements", tour: "nav-statements" },
];

/**
 * The five places to go. Business details and the setup guide are deliberately
 * not here: they are things you do once, and they live at the bottom of the
 * overview where they do not compete with the daily work.
 *
 * Before the business exists every one of these is switched off rather than
 * hidden. Hiding them would mean a new arrival never learns the app has a
 * History or a Statements page, which is half of what the tour is for.
 */
export function NavLinks({ disabled = false }: { disabled?: boolean }) {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-1">
      {LINKS.map((link) => {
        const active =
          !disabled &&
          (link.href === "/" ? pathname === "/" : pathname.startsWith(link.href));

        if (disabled) {
          return (
            <span
              key={link.href}
              data-tour={link.tour}
              aria-disabled="true"
              title="Create your business first"
              className="cursor-not-allowed rounded-lg px-3 py-1.5 text-sm font-medium text-slate-400 dark:text-slate-600"
            >
              {link.label}
            </span>
          );
        }

        return (
          <Link
            key={link.href}
            href={link.href}
            data-tour={link.tour}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              active
                ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
