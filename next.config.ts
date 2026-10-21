import type { NextConfig } from "next";
import { networkInterfaces } from "node:os";
import { createRequire } from "node:module";

const cloudflare = process.env.FOUR_V_FOUR_DEPLOY_TARGET === "cloudflare";
const require = createRequire(import.meta.url);

const nextConfig: NextConfig = {
  ...(cloudflare ? {
    serverExternalPackages: ["@libsql/isomorphic-ws"],
    outputFileTracingIncludes: {
      "/api/**": ["./node_modules/@libsql/isomorphic-ws/web.*"],
    },
    // Bundle the HTTP-only driver rather than SQLite's native Node addon.
    webpack(config) {
      config.resolve.alias = { ...config.resolve.alias, "@prisma/adapter-libsql$": require.resolve("@prisma/adapter-libsql/web") };
      return config;
    },
  } : {}),
  // Allow phone testing through this computer's current LAN addresses, without a wildcard.
  allowedDevOrigins: Object.values(networkInterfaces()).flatMap((addresses) =>
    (addresses ?? []).filter((address) => address.family === "IPv4" && !address.internal)
      .map((address) => address.address),
  ),
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "same-origin" },
    ] }];
  },
};

export default nextConfig;
