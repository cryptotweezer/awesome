"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The moving parts of the landing page, kept in one client file so the page
 * itself stays a server component.
 *
 * Nothing here is decoration for its own sake: the reveal gives each section a
 * moment of its own on the way down, the progress bar says how much page is
 * left, and the nav highlights where you actually are. All three degrade to
 * "everything visible, nothing highlighted" if JavaScript never arrives.
 */

/** Reveals its children the first time they come into view, then stops watching. */
export function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: React.ReactNode;
  /** Milliseconds, for staggering a row of cards. */
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      // Old browser: show it rather than hide it forever.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      // A little before the edge, so the animation finishes as it arrives
      // rather than starting once it is already in the middle of the screen.
      { rootMargin: "0px 0px -12% 0px", threshold: 0.05 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`reveal ${shown ? "reveal-in" : ""} ${className}`}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}

/** How far down the page you are, as a hairline across the top. */
export function ScrollProgress() {
  const [pct, setPct] = useState(0);

  useEffect(() => {
    const onScroll = () => {
      const max = document.body.scrollHeight - window.innerHeight;
      setPct(max > 0 ? Math.min(1, window.scrollY / max) : 0);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      className="fixed inset-x-0 top-0 z-30 h-0.5 origin-left bg-slate-900 dark:bg-slate-100"
      style={{ transform: `scaleX(${pct})` }}
    />
  );
}

/** A line of configuration you are meant to paste somewhere, with the paste half done. */
export function CopyLine({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-xl bg-slate-950 p-4 pr-20 text-xs leading-relaxed text-slate-100 ring-1 ring-slate-800">
        {text}
      </pre>
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
        className="absolute right-3 top-3 rounded-lg bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-200 opacity-80 transition hover:bg-slate-700 hover:opacity-100"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/**
 * The section links in the header, with the one you are reading marked.
 *
 * Scroll position is the only honest source for that: the hash in the address
 * bar is whatever you last clicked, which stops being true the moment you
 * scroll away from it.
 */
export function SectionLinks({
  items,
}: {
  items: { id: string; label: string }[];
}) {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      // Only the band under the header counts as "where you are".
      { rootMargin: "-20% 0px -70% 0px" },
    );
    for (const { id } of items) {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [items]);

  return (
    <nav className="hidden items-center gap-1 md:flex">
      {items.map((item) => (
        <a
          key={item.id}
          href={`#${item.id}`}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
            active === item.id
              ? "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100"
              : "text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          }`}
        >
          {item.label}
        </a>
      ))}
    </nav>
  );
}
