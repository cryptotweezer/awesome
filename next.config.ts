import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The PDF route reads the logo off disk at render time — keep it in the
  // serverless trace so it survives the Vercel build.
  outputFileTracingIncludes: {
    "/invoices/[id]/pdf": ["./public/logo_black.png"],
    "/statements/client/[clientId]/pdf": ["./public/logo_black.png"],
    "/statements/fy/[issuerId]/pdf": ["./public/logo_black.png"],
  },
};

export default nextConfig;
