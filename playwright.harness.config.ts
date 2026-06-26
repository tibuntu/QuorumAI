import { defineConfig } from "@playwright/test";

// Dedicated config for the agent-contract conformance harness. It boots the
// REAL app via `next dev` on an
// isolated port + throwaway SQLite DB so it never touches data/app.db, and
// drives a true over-the-wire push→review→pull round-trip. Run with:
//   DATABASE_URL="file:<abs>/data/harness.db" pnpm exec prisma migrate deploy
//   pnpm exec playwright test --config playwright.harness.config.ts
const PORT = process.env.HARNESS_PORT ?? "3100";
const BASE_URL = `http://localhost:${PORT}`;
const HARNESS_DB = process.env.HARNESS_DB_URL ?? "file:./data/harness.db";

export default defineConfig({
  testDir: "./tests/harness",
  timeout: 180_000,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: BASE_URL },
  webServer: {
    command: `pnpm exec next dev -p ${PORT}`,
    url: BASE_URL,
    timeout: 180_000,
    reuseExistingServer: false,
    env: {
      DATABASE_URL: HARNESS_DB,
      BETTER_AUTH_URL: BASE_URL,
      BASE_URL,
      REGISTRATION_ALLOWLIST: "example.com",
      DISABLE_RATE_LIMIT: "true",
      WEBHOOK_ALLOW_INSECURE: "true",
    },
  },
});
