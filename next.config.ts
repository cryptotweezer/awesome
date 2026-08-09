import type { NextConfig } from "next";

const LOGO = "./public/logo_black.png";

const nextConfig: NextConfig = {
  // Arcjet's analysis engine is WebAssembly, loaded through generated `_virtual`
  // paths that the bundler cannot resolve. Left to itself the build fails with
  // "Module not found" on those paths. Marking it external means Node requires
  // it at runtime instead, which is how packages carrying native or wasm
  // artefacts are meant to be handled.
  serverExternalPackages: ["@arcjet/next", "arcjet", "@arcjet/analyze-wasm"],

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
