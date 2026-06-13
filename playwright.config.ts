import { defineConfig } from "@playwright/test";

const PORT = process.env.PORT ?? "3000";
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  // A real bug fails all attempts (still red); a residual hydration/timing flake self-heals.
  retries: process.env.CI ? 2 : 0,
  use: { baseURL: BASE_URL },
  webServer: {
    command: `pnpm build && pnpm start -p ${PORT}`,
    url: BASE_URL,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: {
      DISABLE_RATE_LIMIT: "true",
      WEBHOOK_ALLOW_INSECURE: "true",
      OUTBOX_POLL_MS: "500",
      // Presence: context.close() never delivers the pagehide beacon, so the
      // roster test exercises TTL eviction — keep heartbeat << TTL and the
      // whole eviction window inside the test's 10s assertion timeout.
      NEXT_PUBLIC_PRESENCE_HEARTBEAT_MS: "1000",
      PRESENCE_TTL_MS: "4000",
      PRESENCE_SWEEP_MS: "1000",
    },
  },
});
