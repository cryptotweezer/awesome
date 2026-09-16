import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * Read from the environment rather than from the request, because metadata is
 * resolved where `headers()` is not welcome, and because this is the address
 * other people's link previews have to fetch, not the host that happens to be
 * serving. Baked in at build, like everywhere else APP_URL is used: changing
 * it in the host does nothing until something rebuilds.
 */
const BASE_URL =
  process.env.APP_URL?.trim().replace(/\/+$/, "") || "http://localhost:3000";

/**
 * What a messaging app shows when the link is pasted. The description is the
 * public pitch, not an internal note: this text is read by strangers, so it
 * names no client and no business.
 *
 * The card is `public/og-cover.png`, a 1200x630 shot of the landing hero.
 * Replacing it means writing a new filename here too: every scraper caches the
 * image by URL, so reusing the name leaves the old card in circulation.
 */
const DESCRIPTION =
  "Tell an AI to bill the job and it is billed. Invoices, reminders, client statements and your whole financial year, from a sentence. Bring the AI you already use, or use the one built in.";

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: "AI Billing Service",
  description: DESCRIPTION,
  applicationName: "AI Billing Service",
  openGraph: {
    type: "website",
    locale: "en_AU",
    url: BASE_URL,
    siteName: "AI Billing Service",
    title: "Invoicing an AI can actually run.",
    description: DESCRIPTION,
    images: [
      {
        url: "/og-cover.png",
        width: 1200,
        height: 630,
        alt: "AI Billing Service landing page",
        type: "image/png",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Invoicing an AI can actually run.",
    description: DESCRIPTION,
    images: ["/og-cover.png"],
  },
};

/**
 * Applies the saved theme before the first paint, so switching pages or
 * reloading never flashes the wrong one. The ThemeToggle reads and writes the
 * same `dark` class on <html>.
 */
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark')}else{document.documentElement.classList.remove('dark')}}catch(e){}})()`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
