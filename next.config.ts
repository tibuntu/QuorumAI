import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // NOTE: `output: "standalone"` is (re)introduced in the Integration & packaging
  // plan, together with the `node .next/standalone/server.js` run command and
  // static/public asset copying. It is intentionally omitted here so `next start`
  // behaves correctly for dev/e2e/CI in the Foundation milestone.
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-better-sqlite3", "better-sqlite3"],
};

export default nextConfig;
