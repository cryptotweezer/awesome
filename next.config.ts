import type { NextConfig } from "next";

const LOGO = "./public/logo_black.png";

const nextConfig: NextConfig = {
  // Arcjet's analysis engine is WebAssembly, loaded through generated `_virtual`
  // paths that the bundler cannot resolve. Left to itself the build fails with
  // "Module not found" on those paths. Marking it external means Node requires
  // it at runtime instead, which is how packages carrying native or wasm
  // artefacts are meant to be handled.
  serverExternalPackages: ["@arcjet/next", "arcjet", "@arcjet/analyze-wasm"],

  experimental: {
    // A logo may be up to 1 MB (the bucket says so), and it is posted together
    // with the whole business form when somebody signs up. The default limit
    // for a Server Action body is exactly 1 MB, which would reject that
    // request as a whole rather than just the file.
    serverActions: { bodySizeLimit: "3mb" },
  },

  /**
   * Sent on every response. None of these replace a check on the server; they
   * shrink what a mistake elsewhere can be turned into.
   *
   * No Content-Security-Policy yet: Next injects inline scripts for hydration
   * and this app has one of its own for the theme, so a policy strict enough to
   * be worth having needs per-request nonces. A half-strict policy that has to
   * allow 'unsafe-inline' buys nothing and reads as if it does.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Never let a browser guess a type. The logo route serves whatever
          // bytes were uploaded under an image type it chose itself, and this
          // is what stops a browser deciding those bytes are HTML.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Nothing here is meant to be framed, and clickjacking a dashboard
          // whose buttons delete invoices is worth ruling out.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // This app asks for none of these, so it should be unable to.
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
          // No Strict-Transport-Security here on purpose: Vercel already sends
          // a two-year one, and setting our own would replace it with a
          // shorter promise, which is worse than saying nothing.
        ],
      },
    ];
  },

  // These routes read files off disk at request time, so the files have to
  // survive the Vercel build and land in the serverless bundle.
  outputFileTracingIncludes: {
    // The built-in logo, used by the business that owns this deployment when
    // it has not uploaded one to storage. See src/lib/pdf/logo.ts.
    "/invoices/[id]/pdf": [LOGO],
    "/statements/client/[clientId]/pdf": [LOGO],
    "/statements/fy/[issuerId]/pdf": [LOGO],
    "/api/agent/[tool]": [LOGO],
    "/api/mcp": [LOGO],
    // The installer handed to anyone who wants to run their own copy.
    "/guide/schema.sql": ["./supabase/schema.sql"],
  },
};

export default nextConfig;
